import type { IAIProvider, GenerateOptions, AICompletion } from './provider.js';
import { OpenAiCompatProvider } from './openAiCompatProvider.js';
import { BaseLiveProvider, shouldRetry, RETRY_DELAYS, sleep } from './baseProvider.js';

/**
 * Live LLM provider (Google Gemini).
 *
 * Implements the same `IAIProvider` interface as the deterministic local
 * provider, so it is a drop-in replacement: no agent, route or UI changes when
 * it is enabled.
 *
 * It is used for LANGUAGE and REASONING - understanding Tamil or English
 * petitions, summarising, and turning retrieved sources into an answer. It is
 * NOT the source of legal facts: Acts, sections, departments and authorities
 * continue to be selected from the knowledge base by row id, so the guarantee
 * that the system cannot invent a legal reference remains structural rather
 * than a matter of prompt wording.
 *
 * Every call fails soft. When the API is unreachable, over quota, or slow, the
 * caller is told plainly and the petition continues to be processed with the
 * local provider.
 */

/*
 * The model this project is entitled to use.
 *
 * gemini-2.0-flash and gemini-2.5-flash both now return 404 for new keys -
 * "no longer available" - so a stale default would look like a broken API key.
 * Override with GEMINI_MODEL when the account is entitled to something else.
 */
const DEFAULT_MODEL = 'gemini-3.6-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiProvider extends BaseLiveProvider {
  readonly name = 'google-gemini';
  readonly model: string;
  readonly available: boolean;

  constructor(
    private apiKey: string,
    model = process.env.GEMINI_MODEL || DEFAULT_MODEL,
    private timeoutMs = 30000,
  ) {
    super();
    this.model = model;
    this.available = !!apiKey;
  }

  protected get label(): string { return 'Gemini'; }

  // ------------------------------------------------------------- transport
  protected async call(
    o: GenerateOptions,
    opts: { json?: boolean; attempt?: number } = {},
  ): Promise<AICompletion> {
    if (!this.available) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: o.user }] }],
        generationConfig: {
          temperature: o.temperature ?? 0.2,
          maxOutputTokens: o.maxTokens ?? 2048,
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
          ...(opts.json && o.schema ? { responseSchema: o.schema } : {}),
        },
        /*
         * Safety settings are left at their defaults deliberately.
         *
         * Petitions describe real harm - domestic violence, atrocity, threats -
         * and a blocked response would silently drop a citizen's grievance.
         * Gemini's defaults allow this material in an analytical context; if a
         * response is blocked, the error below says so rather than returning
         * an empty answer.
         */
      };

      if (o.system) {
        body.systemInstruction = { parts: [{ text: o.system }] };
      }

      const res = await fetch(
        `${API_BASE}/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        /*
         * 503 and 429 mean the model is busy, not that the request is wrong.
         * Failing on the first one made a working setup look broken.
         */
        /*
         * A 429 is either "too fast" or "out of quota for the day", and the
         * two need opposite handling. Retrying a daily-quota failure just
         * delays every request by seven seconds before failing anyway, which
         * made the whole application feel broken once the free tier ran out.
         * The quota case is surfaced immediately so the fallback takes over.
         */
        const attempt = opts.attempt ?? 0;
        if (shouldRetry(res.status, detail, attempt)) {
          // Back off progressively: the model is busy, not broken.
          await sleep(RETRY_DELAYS[attempt]);
          return this.call(o, { ...opts, attempt: attempt + 1 });
        }
        // Quota and key errors are worth distinguishing - one is temporary,
        // the other needs an administrator.
        if (res.status === 429) {
          throw new Error(`Gemini rate limit or quota exceeded (429). ${detail.slice(0, 200)}`);
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error(`Gemini rejected the API key (${res.status}). Check GEMINI_API_KEY.`);
        }
        throw new Error(`Gemini returned ${res.status}. ${detail.slice(0, 300)}`);
      }

      const json: any = await res.json();

      const blocked = json?.promptFeedback?.blockReason;
      if (blocked) {
        throw new Error(
          `Gemini declined to answer (${blocked}). The officer may read the petition directly.`,
        );
      }

      const candidate = json?.candidates?.[0];
      const text = (candidate?.content?.parts ?? [])
        .map((p: any) => p?.text ?? '')
        .join('')
        .trim();

      if (!text) {
        const finish = candidate?.finishReason ?? 'no content';
        throw new Error(`Gemini returned no text (${finish}).`);
      }

      return { text, model: this.model, latencyMs: Date.now() - started, raw: json };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Embeddings.
   *
   * Uses the dedicated embedding endpoint rather than the chat model.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.available) throw new Error('GEMINI_API_KEY is not configured.');

    const out: number[][] = [];
    for (const text of texts) {
      const res = await fetch(
        `${API_BASE}/text-embedding-004:embedContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'models/text-embedding-004',
            content: { parts: [{ text }] },
          }),
        },
      );
      if (!res.ok) throw new Error(`Gemini embedding returned ${res.status}.`);
      const json: any = await res.json();
      out.push(json?.embedding?.values ?? []);
    }
    return out;
  }

}

/**
 * Which vendors this deployment can use, and how each is configured.
 *
 * Keys are read from the environment ONLY. Nothing here is ever sent to the
 * browser: the settings dialog receives `configured: true/false` and a model
 * name, never a credential. That is why this function returns a descriptor
 * rather than the key itself.
 */
export type ProviderId = 'gemini' | 'openai' | 'grok' | 'groq' | 'nvidia' | 'ollama';

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  /** True when this vendor has everything it needs to be selected. */
  configured: boolean;
  model: string;
  /**
   * Why it cannot be used, when it cannot.
   *
   * English prose, for server logs and API consumers. The console does NOT
   * render it - a Tamil UI would then show an English sentence - and uses
   * `envVar` with its own phrase book instead.
   */
  note?: string;
  /** The environment variable that enables this vendor. A fact, not prose. */
  envVar?: string;
}

function keyFor(id: ProviderId): string {
  switch (id) {
    case 'gemini': return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    case 'openai': return process.env.OPENAI_API_KEY || '';
    case 'grok':   return process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
    case 'groq':   return process.env.GROQ_API_KEY || '';
    case 'nvidia': return process.env.NVIDIA_API_KEY || '';
    case 'ollama': return '';
  }
}

function modelFor(id: ProviderId): string | undefined {
  switch (id) {
    case 'gemini': return process.env.GEMINI_MODEL || undefined;
    case 'openai': return process.env.OPENAI_MODEL || undefined;
    case 'grok':   return process.env.GROK_MODEL || undefined;
    case 'groq':   return process.env.GROQ_MODEL || undefined;
    case 'nvidia': return process.env.NVIDIA_MODEL || undefined;
    case 'ollama': return process.env.OLLAMA_MODEL || undefined;
  }
}

/** Build one vendor's provider, or null when it is not configured. */
export function buildProvider(id: ProviderId, model?: string): IAIProvider | null {
  const key = keyFor(id);
  const chosen = model || modelFor(id);

  if (id === 'gemini') {
    if (!key) return null;
    return new GeminiProvider(key, chosen || undefined);
  }

  /*
   * Ollama runs locally and needs no key, so it is always buildable. Whether
   * the daemon is actually running is a question only a real request can
   * answer - `testProvider` does that, and reports it plainly.
   */
  if (id === 'ollama') {
    return new OpenAiCompatProvider('ollama', '', chosen, 60000, process.env.OLLAMA_BASE_URL);
  }

  /*
   * NVIDIA's shared endpoint can be slow on a large open model, so it is given
   * a longer timeout than a hosted commercial API needs.
   */
  if (id === 'nvidia') {
    if (!key) return null;
    return new OpenAiCompatProvider('nvidia', key, chosen, 90000, process.env.NVIDIA_BASE_URL);
  }

  if (id === 'groq') {
    if (!key) return null;
    return new OpenAiCompatProvider('groq', key, chosen, 45000, process.env.GROQ_BASE_URL);
  }

  if (!key) return null;
  return new OpenAiCompatProvider(id, key, chosen);
}

/** Every vendor, with whether it is usable. Safe to send to the browser. */
export function describeProviders(): ProviderDescriptor[] {
  const labels: Record<ProviderId, string> = {
    gemini: 'Google Gemini', openai: 'OpenAI', grok: 'Grok (xAI)',
    groq: 'Groq', nvidia: 'NVIDIA NIM', ollama: 'Ollama (local)',
  };
  const envVar: Record<ProviderId, string> = {
    gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY',
    grok: 'GROK_API_KEY', groq: 'GROQ_API_KEY',
    nvidia: 'NVIDIA_API_KEY', ollama: '-',
  };

  return (['gemini', 'openai', 'grok', 'groq', 'nvidia', 'ollama'] as ProviderId[]).map((id) => {
    const p = buildProvider(id);
    return {
      id,
      label: labels[id],
      configured: !!p,
      model: p?.model ?? modelFor(id) ?? '',
      envVar: envVar[id],
      note: p
        ? (id === 'ollama'
          ? 'Runs locally. No key required; the daemon must be running.'
          : undefined)
        : `Set ${envVar[id]} in the server environment to enable this provider.`,
    };
  });
}

/**
 * Build the live provider from the environment, or return null when none is
 * configured. The caller then keeps the local provider - the system works
 * either way.
 *
 * AI_PROVIDER names the preferred vendor. Where it is unset the first
 * configured vendor is used, in the order below, so an existing deployment
 * that only has GEMINI_API_KEY keeps behaving exactly as it did.
 */
export function createLiveProvider(): IAIProvider | null {
  const preferred = (process.env.AI_PROVIDER || '').trim().toLowerCase() as ProviderId;
  const order: ProviderId[] = ['gemini', 'openai', 'grok', 'groq', 'nvidia', 'ollama'];

  if (preferred && order.includes(preferred)) {
    const p = buildProvider(preferred);
    if (p) return p;
    console.warn(`[ai] AI_PROVIDER=${preferred} is not configured; trying the others.`);
  }

  /*
   * Ollama is deliberately last and is NOT selected implicitly.
   *
   * It is always "buildable", so including it in the automatic search would
   * mean a deployment with no keys silently pointed at a daemon that is
   * probably not running - an error on every request instead of the local
   * provider's honest, working fallback. It must be chosen explicitly.
   */
  for (const id of ['gemini', 'openai', 'grok', 'groq', 'nvidia'] as ProviderId[]) {
    const p = buildProvider(id);
    if (p) return p;
  }
  return null;
}
