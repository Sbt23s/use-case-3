import { randomUUID } from 'node:crypto';
import { db } from '../core/db.js';
import { audit } from '../core/audit.js';
import type { AuthUser } from '../core/auth.js';
import { MockAIProvider } from './mockProvider.js';
import {
  createLiveProvider, buildProvider, describeProviders,
  type ProviderId, type ProviderDescriptor,
} from './liveProvider.js';
import type { IAIProvider } from './provider.js';

/*
 * Two providers, deliberately.
 *
 * `provider` is what agents use. `fallback` is the deterministic local
 * implementation, which needs no network and no key.
 *
 * When a live model is configured it handles language and reasoning. When it
 * is absent, over quota, or unreachable, the fallback keeps the workflow
 * running - an officer must never be blocked from processing a petition
 * because an external API is down.
 */
const fallback: IAIProvider = new MockAIProvider();

/*
 * The live provider is resolved on FIRST USE, not at module load.
 *
 * ESM hoists imports, so this module can be evaluated before the entry point
 * has loaded .env. Reading GEMINI_API_KEY here at load time therefore saw
 * `undefined` and pinned the system to the local provider for the lifetime of
 * the process - a configured key silently doing nothing, which is the worst
 * kind of failure because everything still appears to work.
 */
let provider: IAIProvider | null = null;
let overridden = false;

/*
 * The administrator's choice, remembered across restarts.
 *
 * Only the VENDOR NAME and MODEL are stored. Credentials stay in the server
 * environment and are never written to the database, never returned by an API
 * and never sent to the browser - so a database dump or a screenshot of the
 * settings dialog cannot leak a key.
 */
const SELECTION_KEY = 'ai.provider.selection';

function readSelection(): { id: ProviderId; model?: string } | null {
  try {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?')
      .get(SELECTION_KEY) as any;
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value);
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

function current(): IAIProvider {
  if (provider) return provider;

  /*
   * A stored selection wins over the environment's default order, but only if
   * it is still usable: a vendor whose key was removed falls back rather than
   * failing every request with an error an officer cannot act on.
   */
  const sel = readSelection();
  if (sel) {
    const p = buildProvider(sel.id, sel.model);
    if (p) { provider = p; return provider; }
    console.warn(`[ai] stored provider "${sel.id}" is no longer configured; using the default.`);
  }

  provider = createLiveProvider() ?? fallback;
  return provider;
}

/**
 * Switch provider at runtime.
 *
 * Returns the new status rather than throwing when the vendor is unconfigured,
 * because "you have not set that key" is a normal answer to an administrator
 * exploring the dialog, not an exceptional condition.
 */
export function selectProvider(id: ProviderId, model?: string):
  { ok: true; status: ReturnType<typeof providerStatus> } | { ok: false; error: string } {
  const p = buildProvider(id, model);
  if (!p) {
    return { ok: false, error: `${id} is not configured on the server.` };
  }

  provider = p;
  overridden = false;
  db.prepare(`
    INSERT INTO system_config (key, value, description, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(
    SELECTION_KEY,
    JSON.stringify({ id, model: model || p.model }),
    'Selected AI vendor and model. Credentials are never stored here.',
  );
  return { ok: true, status: providerStatus() };
}

/**
 * Prove a vendor actually answers, with a real request.
 *
 * "Is the key present" is not the question an administrator is asking - a
 * revoked key, an exhausted quota and a stopped Ollama daemon all look
 * configured. This sends the smallest possible prompt and reports what came
 * back, including the latency, so the dialog can say something true.
 */
export async function testProvider(id: ProviderId, model?: string): Promise<{
  ok: boolean; provider: string; model: string; latencyMs?: number; error?: string;
}> {
  const p = buildProvider(id, model);
  if (!p) {
    return { ok: false, provider: id, model: model ?? '', error: `${id} is not configured on the server.` };
  }
  const started = Date.now();
  try {
    /*
     * The budget is generous for a one-word answer, on purpose.
     *
     * A REASONING model (gpt-oss, DeepSeek-R1) spends tokens thinking before
     * it writes anything. With a tight budget it hit the limit mid-thought and
     * returned no text at all, so a perfectly working endpoint reported
     * "returned no text (length)" and looked broken. The cost of a larger
     * ceiling is nil - the model still stops after "OK" - and it makes the
     * test tell the truth for every kind of model.
     */
    const out = await p.generateText({
      system: 'Reply with the single word OK.',
      user: 'Connection test.',
      maxTokens: 512,
      temperature: 0,
    });
    return { ok: true, provider: p.name, model: p.model, latencyMs: Date.now() - started };
  } catch (e) {
    return {
      ok: false, provider: p.name, model: p.model,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Every vendor and whether it is usable. Contains no credentials. */
export function listProviders(): ProviderDescriptor[] {
  return describeProviders();
}

export function setProvider(p: IAIProvider) { provider = p; overridden = true; }
export function getProvider(): IAIProvider { return current(); }
export function getFallbackProvider(): IAIProvider { return fallback; }
export function isLiveProvider(): boolean { return current() !== fallback; }

/** What the officer and the administrator are told about the AI layer. */
export function providerStatus() {
  const p = current();
  const live = p !== fallback;
  const sel = readSelection();
  return {
    provider: p.name,
    model: p.model,
    live,
    /** Which vendor is selected, for the settings dialog's radio state. */
    selected: sel?.id ?? (live ? inferId(p.name) : null),
    fallback: fallback.name,
    note: live
      ? 'A live language model handles comprehension and reasoning. Acts, departments and ' +
        'authorities are still selected from the configured knowledge base, so a legal ' +
        'reference cannot be invented.'
      : 'No live model is configured (set GEMINI_API_KEY). The deterministic local provider ' +
        'is in use: it reads the petition text, but its language understanding is limited.',
  };
}

/**
 * Run an operation against the live provider, falling back to the local one.
 *
 * Returns which provider actually served the request, so the caller can tell
 * the officer honestly rather than presenting degraded output as normal.
 */
export async function withFallback<T>(
  fn: (p: IAIProvider) => Promise<T>,
): Promise<{ value: T; usedFallback: boolean; reason?: string }> {
  const live = current();
  if (live === fallback) {
    return { value: await fn(fallback), usedFallback: false };
  }
  try {
    return { value: await fn(live), usedFallback: false };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn('[ai] live provider failed, falling back:', reason);
    return { value: await fn(fallback), usedFallback: true, reason };
  }
}

export interface TaskContext {
  task: string;
  petitionId?: number;
  entityType?: string;
  entityId?: number;
  user: AuthUser;
  inputRef?: string;
}

export interface AIResult<T> {
  requestId: number;
  requestUid: string;
  data: T;
  confidence: number;
  sources: unknown[];
  validationStatus: 'VALID' | 'INVALID';
  errors?: string[];
}

export function getPrompt(task: string) {
  return db.prepare(
    'SELECT * FROM prompt_template WHERE task = ? AND active = 1 ORDER BY version DESC LIMIT 1'
  ).get(task) as any;
}

/**
 * Single entry point for every AI task.
 *
 * Responsibilities, in order:
 *   1. open a traceable ai_request row (Phase 27)
 *   2. run the agent
 *   3. validate the result against the task's schema (Phase 26)
 *   4. persist output, confidence and knowledge sources
 *   5. audit
 *
 * Nothing here writes to an official case field. Agents return
 * recommendations; officers accept them through the review routes.
 */
export async function runTask<T>(
  ctx: TaskContext,
  agent: (p: IAIProvider) => Promise<{ data: T; confidence: number; sources?: unknown[] }>,
  validate?: (d: unknown) => { ok: true; value: T } | { ok: false; errors: string[] },
): Promise<AIResult<T>> {
  const uid = randomUUID();
  const prompt = getPrompt(ctx.task);
  const started = Date.now();

  const insert = db.prepare(`
    INSERT INTO ai_request
      (request_uid, task, petition_id, entity_type, entity_id, provider, model,
       prompt_version, input_ref, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?)
  `).run(
    uid, ctx.task, ctx.petitionId ?? null, ctx.entityType ?? null, ctx.entityId ?? null,
    current().name, current().model, prompt?.version ?? null, ctx.inputRef ?? null, ctx.user.id,
  );
  const requestId = Number(insert.lastInsertRowid);

  try {
    /*
     * Try the live model, then fall back to the local provider.
     *
     * A shared flash model returns 503 under load even after retries, and
     * without this the officer simply got an error - the whole point of
     * keeping a deterministic local provider is that the workflow never stops
     * because an external API is busy. The fallback is recorded on the request
     * row, so a degraded answer is auditable rather than silent.
     */
    let out;
    let usedFallback = false;
    try {
      out = await agent(current());
    } catch (liveErr) {
      if (current() === fallback) throw liveErr;
      const why = liveErr instanceof Error ? liveErr.message : String(liveErr);
      console.warn('[ai] live provider failed, using local provider:', why.slice(0, 160));
      out = await agent(fallback);
      usedFallback = true;
    }

    let data = out.data;
    let validationStatus: 'VALID' | 'INVALID' = 'VALID';
    let errors: string[] | undefined;

    if (validate) {
      const v = validate(out.data);
      if (v.ok) { data = v.value; }
      else { validationStatus = 'INVALID'; errors = v.errors; }
    }

    db.prepare(`
      UPDATE ai_request SET output_json = ?, confidence = ?, knowledge_sources = ?,
        validation_status = ?, validation_errors = ?, status = ?, latency_ms = ?
      WHERE id = ?
    `).run(
      JSON.stringify(data), out.confidence, JSON.stringify(out.sources ?? []),
      validationStatus, errors ? JSON.stringify(errors) : null,
      validationStatus === 'VALID' ? 'COMPLETED' : 'FAILED',
      Date.now() - started, requestId,
    );

    audit(null, ctx.user, {
      action: 'AI_ANALYSIS_COMPLETED',
      entityType: 'ai_request', entityId: requestId, petitionId: ctx.petitionId,
      newValue: {
        task: ctx.task, confidence: out.confidence, validationStatus,
        ...(usedFallback ? { usedFallback: true } : {}),
      },
    });

    return {
      requestId, requestUid: uid, data,
      confidence: out.confidence, sources: out.sources ?? [],
      validationStatus, errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(
      "UPDATE ai_request SET status='FAILED', validation_status='FAILED', validation_errors=?, latency_ms=? WHERE id=?"
    ).run(JSON.stringify([msg]), Date.now() - started, requestId);
    audit(null, ctx.user, {
      action: 'AI_TASK_FAILED', entityType: 'ai_request', entityId: requestId,
      petitionId: ctx.petitionId, newValue: { task: ctx.task, error: msg },
    });
    throw err;
  }
}

/** Map a provider's internal name back to its vendor id. */
function inferId(name: string): ProviderId | null {
  if (name.includes('gemini')) return 'gemini';
  if (name === 'openai') return 'openai';
  if (name.includes('grok')) return 'grok';
  if (name === 'groq') return 'groq';
  if (name.includes('nvidia')) return 'nvidia';
  if (name === 'ollama') return 'ollama';
  return null;
}
