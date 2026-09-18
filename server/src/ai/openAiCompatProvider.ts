import type { GenerateOptions, AICompletion } from './provider.js';
import { BaseLiveProvider, shouldRetry, RETRY_DELAYS, sleep } from './baseProvider.js';

/**
 * One transport for every vendor that speaks the OpenAI chat-completions API.
 *
 * OpenAI, xAI (Grok) and Ollama all accept `POST /chat/completions` with the
 * same body and return the same envelope. They differ only in base URL, whether
 * a key is required, and which JSON mode they support - so they are one class
 * with three configurations rather than three near-identical files that would
 * drift apart the first time one of them needed a fix.
 *
 * Ollama is the reason `available` does not simply test for a key: a local
 * model needs no credential, and requiring one would have made the offline
 * option impossible to select.
 */

export type CompatVendor = 'openai' | 'grok' | 'groq' | 'ollama' | 'nvidia';

interface VendorSpec {
  /** Base URL, without a trailing slash. */
  baseUrl: string;
  defaultModel: string;
  /** Whether an API key is required for this vendor to work at all. */
  needsKey: boolean;
  /** Human name, used in error messages an officer or administrator reads. */
  label: string;
  /**
   * Native JSON mode.
   *
   * OpenAI and Grok honour `response_format`. Ollama's OpenAI-compatible layer
   * accepts `format: json` instead, and older builds ignore both - so for
   * Ollama the instruction is carried in the prompt, which always works.
   */
  jsonMode: 'response_format' | 'prompt';
}

const VENDORS: Record<CompatVendor, VendorSpec> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    needsKey: true,
    label: 'OpenAI',
    jsonMode: 'response_format',
  },
  grok: {
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-latest',
    needsKey: true,
    label: 'Grok',
    jsonMode: 'response_format',
  },
  /*
   * Groq - a fast-inference service, and NOT the same thing as Grok (xAI).
   *
   * The two names differ by one letter and are constantly confused; a Groq key
   * (gsk_...) sent to xAI's endpoint returns "Incorrect API key", which reads
   * like a bad key rather than the wrong provider. Both are listed separately
   * so the console can say which one an administrator actually configured.
   */
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    // High-performance live models on Groq
    defaultModel: 'openai/gpt-oss-120b',
    needsKey: true,
    label: 'Groq',
    jsonMode: 'response_format',
  },
  /*
   * NVIDIA NIM - one OpenAI-compatible endpoint serving many open models
   * (Llama, DeepSeek, GLM, GPT-OSS). The MODEL is what selects between them,
   * so this is a single vendor with a model field rather than four entries.
   */
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    // Verified working against the live endpoint. NVIDIA retires model ids
    // (llama-3.3-70b now answers 410 Gone), so the default is one that was
    // actually tested rather than the newest name seen in documentation.
    defaultModel: 'openai/gpt-oss-20b',
    needsKey: true,
    label: 'NVIDIA NIM',
    jsonMode: 'prompt',
  },
  ollama: {
    // The OpenAI-compatible surface of a local Ollama daemon.
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.1',
    needsKey: false,
    label: 'Ollama',
    jsonMode: 'prompt',
  },
};

const GROQ_MODEL_FALLBACKS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3.8-27b'];

export class OpenAiCompatProvider extends BaseLiveProvider {
  readonly name: string;
  readonly model: string;
  readonly available: boolean;
  private readonly spec: VendorSpec;
  private readonly baseUrl: string;

  constructor(
    private vendor: CompatVendor,
    private apiKey: string,
    model?: string,
    private timeoutMs = 45000,
    baseUrl?: string,
  ) {
    super();
    this.spec = VENDORS[vendor];
    this.name = vendor === 'openai' ? 'openai'
      : vendor === 'grok' ? 'xai-grok'
        : vendor === 'groq' ? 'groq'
          : vendor === 'nvidia' ? 'nvidia-nim'
            : 'ollama';
    this.model = model || this.spec.defaultModel;
    this.baseUrl = (baseUrl || this.spec.baseUrl).replace(/\/+$/, '');
    // A local model needs no key; a hosted one is unusable without it.
    this.available = this.spec.needsKey ? !!apiKey : true;
  }

  protected get label(): string { return this.spec.label; }

  protected async call(
    o: GenerateOptions,
    opts: { json?: boolean; attempt?: number; modelOverride?: string; triedModels?: string[] } = {},
  ): Promise<AICompletion> {
    if (!this.available) {
      throw new Error(`${this.spec.label} is not configured (missing API key).`);
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const activeModel = opts.modelOverride || this.model;

    try {
      const messages: { role: string; content: string }[] = [];
      if (o.system) messages.push({ role: 'system', content: o.system });

      /*
       * Where the vendor has no reliable JSON mode, the requirement goes in
       * the prompt. `generateStructuredOutput` strips code fences either way,
       * so a model that fences its output anyway is still parsed correctly.
       */
      const wantsPromptJson = opts.json && this.spec.jsonMode === 'prompt';
      messages.push({
        role: 'user',
        content: wantsPromptJson
          ? `${o.user}\n\nRespond with a single valid JSON object and nothing else.`
          : o.user,
      });

      const body: Record<string, unknown> = {
        model: activeModel,
        messages,
        temperature: o.temperature ?? 0.2,
        max_tokens: o.maxTokens ?? 2048,
      };
      if (opts.json && this.spec.jsonMode === 'response_format') {
        body.response_format = { type: 'json_object' };
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const attempt = opts.attempt ?? 0;

        // Groq automatic model fallback if a model hits rate limits or quota depletion (429)
        if (this.vendor === 'groq' && (res.status === 429 || res.status === 404)) {
          const tried = opts.triedModels ?? [activeModel];
          const nextModel = GROQ_MODEL_FALLBACKS.find((m) => !tried.includes(m));
          if (nextModel) {
            console.warn(`[groq] model ${activeModel} returned ${res.status}, automatically falling back to ${nextModel}`);
            return this.call(o, {
              ...opts,
              modelOverride: nextModel,
              triedModels: [...tried, nextModel],
              attempt: 0,
            });
          }
        }

        if (shouldRetry(res.status, detail, attempt)) {
          await sleep(RETRY_DELAYS[attempt]);
          return this.call(o, { ...opts, attempt: attempt + 1 });
        }
        /*
         * Distinguish the failures that need different responses: a quota
         * problem is temporary or billing-related, a key problem needs an
         * administrator, and a missing local model needs a `ollama pull`.
         */
        if (res.status === 429) {
          throw new Error(
            `${this.spec.label} rate limit or quota exceeded (429). ${detail.slice(0, 200)}`,
          );
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `${this.spec.label} rejected the API key (${res.status}). Check the server configuration.`,
          );
        }
        if (res.status === 404 && this.vendor === 'ollama') {
          throw new Error(
            `Ollama has no model named "${this.model}". Run: ollama pull ${this.model}`,
          );
        }
        throw new Error(`${this.spec.label} returned ${res.status}. ${detail.slice(0, 300)}`);
      }

      const json: any = await res.json();
      const choice = json?.choices?.[0];
      const text = String(choice?.message?.content ?? '').trim();

      if (!text) {
        const finish = choice?.finish_reason ?? 'no content';
        throw new Error(`${this.spec.label} returned no text (${finish}).`);
      }

      return { text, model: activeModel, latencyMs: Date.now() - started, raw: json };
    } catch (e) {
      /*
       * A local daemon that is not running produces a connection error rather
       * than an HTTP status. Saying "Ollama is not running" is far more useful
       * to whoever has to fix it than "fetch failed".
       */
      if (e instanceof Error && /fetch failed|ECONNREFUSED|other side closed/i.test(e.message)) {
        throw new Error(
          this.vendor === 'ollama'
            ? `Ollama is not reachable at ${this.baseUrl}. Is the daemon running?`
            : `${this.spec.label} is not reachable. Check network connectivity.`,
        );
      }
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`${this.spec.label} timed out after ${this.timeoutMs / 1000}s.`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Embeddings, where the vendor offers them.
   *
   * Grok has no embedding endpoint, so it inherits the base refusal rather
   * than pretending. OpenAI and Ollama both expose `/embeddings`.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (this.vendor === 'grok' || this.vendor === 'groq' || this.vendor === 'nvidia') {
      return super.embed(texts);
    }
    if (!this.available) throw new Error(`${this.spec.label} is not configured.`);

    const model = this.vendor === 'openai'
      ? (process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small')
      : (process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`${this.spec.label} embedding returned ${res.status}.`);
    }
    const json: any = await res.json();
    return (json?.data ?? []).map((d: any) => d?.embedding ?? []);
  }

  /** The models this vendor currently offers, for the settings dialog. */
  async listModels(): Promise<string[]> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(`${this.baseUrl}/models`, { headers });
    if (!res.ok) return [];
    const json: any = await res.json();
    return (json?.data ?? [])
      .map((m: any) => String(m?.id ?? ''))
      .filter(Boolean)
      .sort();
  }
}

export const COMPAT_VENDORS = VENDORS;
