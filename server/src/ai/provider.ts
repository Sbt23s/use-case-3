/**
 * AI provider abstraction. The application depends only on this interface;
 * no module imports a vendor SDK directly.
 */
export interface AICompletion {
  text: string;
  model: string;
  latencyMs: number;
  raw?: unknown;
}

export interface GenerateOptions {
  system: string;
  user: string;
  /** JSON Schema the model is asked to satisfy, when structured output is required. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

export interface IAIProvider {
  readonly name: string;
  readonly model: string;
  readonly available: boolean;

  generateText(o: GenerateOptions): Promise<AICompletion>;
  generateStructuredOutput<T = unknown>(o: GenerateOptions): Promise<{ data: T } & AICompletion>;
  summarize(text: string, instruction?: string): Promise<AICompletion>;
  classify(text: string, labels: string[]): Promise<AICompletion>;
  translate(text: string, to: string): Promise<AICompletion>;
  extract(text: string, fields: string[]): Promise<AICompletion>;
  embed(texts: string[]): Promise<number[][]>;
  transcribe(audioRef: string): Promise<AICompletion>;
}

export class AIUnavailableError extends Error {
  constructor(msg = 'AI provider unavailable') { super(msg); }
}
