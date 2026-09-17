import type { IAIProvider, GenerateOptions, AICompletion } from './provider.js';

/**
 * The vendor-neutral half of a live provider.
 *
 * Every capability this application needs - summarise, classify, translate,
 * extract - is a PROMPT, not a vendor feature. Only the transport differs
 * between Gemini, OpenAI, Grok and Ollama: the URL, the request shape, and how
 * each one reports an error.
 *
 * So the prompts live here, once, and a vendor subclass supplies `call()` and
 * nothing else. This matters beyond tidiness: the summariser's instruction is
 * the result of a real incident - a model once answered the checklist instead
 * of the petition, and "No added facts/legal references/conclusions? Yes." was
 * stored as the summary of a citizen's case. That wording is now enforced for
 * every vendor rather than being re-typed, and drifting, per provider.
 *
 * The guarantee that surrounds all of this is unchanged: a live model supplies
 * LANGUAGE AND REASONING only. Acts, sections, departments and authorities are
 * selected from the knowledge base by row id, so no provider - however it is
 * prompted, however it fails - can introduce a legal reference that a human did
 * not record.
 */
export abstract class BaseLiveProvider implements IAIProvider {
  abstract readonly name: string;
  abstract readonly model: string;
  abstract readonly available: boolean;

  /**
   * Send one request. The only method a vendor must implement.
   *
   * `json: true` asks for machine-readable output; a vendor that supports a
   * native JSON mode should use it, and one that does not should say so in the
   * prompt. Either way the caller tolerates a fenced code block.
   */
  protected abstract call(
    o: GenerateOptions,
    opts?: { json?: boolean; attempt?: number },
  ): Promise<AICompletion>;

  /** A human name for this vendor, used in error messages. */
  protected get label(): string { return this.name; }

  // ------------------------------------------------------------ capabilities
  async generateText(o: GenerateOptions): Promise<AICompletion> {
    return this.call(o);
  }

  async generateStructuredOutput<T>(o: GenerateOptions): Promise<{ data: T } & AICompletion> {
    const completion = await this.call(o, { json: true });
    try {
      // A model occasionally wraps JSON in a fenced block despite the MIME type.
      const cleaned = completion.text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      return { data: JSON.parse(cleaned) as T, ...completion };
    } catch {
      throw new Error(`${this.label} returned output that was not valid JSON.`);
    }
  }

  async summarize(text: string, instruction?: string): Promise<AICompletion> {
    return this.call({
      /*
       * The instruction is phrased as a role, not a checklist.
       *
       * A rule-by-rule prompt invited the model to answer the rules: one run
       * returned "No added facts/legal references/conclusions? Yes." which was
       * then stored as the summary of a citizen's case. The constraints are
       * still stated, but the output format is pinned first and hard.
       */
      system:
        'Write the summary only. No preamble, no headings, no bullet points, no commentary '
        + 'on your own reasoning, and no restatement of these instructions. '
        + 'Two or three sentences of plain prose.\n\n'
        + 'You are summarising a citizen petition for a government grievance officer. '
        + 'Report only what the petitioner states. Do not assert that an allegation is '
        + 'established, and do not add facts, legal references or conclusions of your own. '
        + 'Summarise in the language the petition is written in - Tamil for a Tamil '
        + 'petition, English for an English one.',
      user: instruction ? `${instruction}\n\n${text}` : text,
      temperature: 0.1,
      maxTokens: 600,
    });
  }

  async classify(text: string, labels: string[]): Promise<AICompletion> {
    return this.call({
      system:
        'Classify the text into exactly one of the given labels. ' +
        'Reply with the label only, nothing else. ' +
        'If none fits, reply with the single word UNCLASSIFIED.',
      user: `Labels: ${labels.join(' | ')}\n\nText:\n${text}`,
      temperature: 0,
      maxTokens: 40,
    });
  }

  async translate(text: string, to: string): Promise<AICompletion> {
    const isToTamil = to.startsWith('ta');
    const target = isToTamil ? 'Tamil' : to.startsWith('en') ? 'English' : to;

    /*
     * Tamil Nadu Government Translation Guidelines
     *
     * A generic "translate this" prompt produced word-for-word renderings that
     * broke official terminology: "Petition" became "மனுவிண்ணப்பம்" (wrong;
     * it is "மனு"), "Act" became "செயல்" instead of "சட்டம்", and "Collector"
     * became "சேகரிப்பாளர்" instead of "ஆட்சியர்". Officers reading AI output
     * with wrong government terms lose trust in the entire system.
     *
     * The prompt below anchors the model to the actual administrative vocabulary
     * used in Tamil Nadu government offices and courts. It preserves all proper
     * nouns, survey numbers, reference numbers, and dates exactly, because a
     * machine rendering of a name or number that differs from the source could
     * corrupt a case record.
     */
    const govContext = isToTamil
      ? [
          'You are a certified Tamil Nadu government translator.',
          'Translate into formal administrative Tamil used in Tamil Nadu government offices.',
          '',
          'MANDATORY TERMINOLOGY (always use these exact Tamil terms):',
          '  Petition / Application → மனு',
          '  Petitioner / Applicant → மனுதாரர்',
          '  Department → துறை',
          '  Act → சட்டம்',
          '  Section → பிரிவு',
          '  Government Order / G.O. → அரசாணை',
          '  Collector → ஆட்சியர்',
          '  District → மாவட்டம்',
          '  Taluk → வட்டம்',
          '  Revenue Inspector → வருவாய் ஆய்வாளர்',
          '  Village Administrative Officer (VAO) → கிராம நிர்வாக அலுவலர்',
          '  Municipal Corporation → மாநகராட்சி',
          '  Municipality → நகராட்சி',
          '  Panchayat → பஞ்சாயத்து',
          '  Priority → முன்னுரிமை',
          '  Verification → சரிபார்ப்பு',
          '  Analysis → பகுப்பாய்வு',
          '  Workflow → பணிப்பாய்வு',
          '  Next action → அடுத்த நடவடிக்கை',
          '  Grievance → குறைதீர்ப்பு',
          '  Officer → அலுவலர்',
          '  Authority → அதிகாரி',
          '  Jurisdiction → அதிகார எல்லை',
          '',
          'RULES:',
          '1. Preserve ALL proper nouns (person names, place names, village names) exactly as written.',
          '2. Preserve ALL numbers, dates, survey numbers, door numbers, reference numbers, Act numbers.',
          '3. Preserve ALL reference codes (e.g. AP-2026-001, G.O.Ms.No.123) exactly.',
          '4. Do NOT translate English words that are widely used as-is in Tamil Nadu offices',
          '   (e.g. "application", "FIR", "NOC", "BPL", "OBC", "SC", "ST", "MLA", "MP").',
          '5. Use formal government register — not colloquial Tamil.',
          '6. Return ONLY the translated text. No explanations, no transliterations in brackets.',
        ].join('\n')
      : [
          'You are a certified Tamil Nadu government translator.',
          'Translate into formal administrative English used in Tamil Nadu government offices.',
          '',
          'MANDATORY TERMINOLOGY (always use these exact English terms):',
          '  மனு → Petition',
          '  மனுதாரர் → Petitioner',
          '  துறை → Department',
          '  சட்டம் → Act',
          '  பிரிவு → Section',
          '  அரசாணை → Government Order (G.O.)',
          '  ஆட்சியர் → Collector',
          '  மாவட்டம் → District',
          '  வட்டம் → Taluk',
          '  கிராம நிர்வாக அலுவலர் → Village Administrative Officer (VAO)',
          '  மாநகராட்சி → Municipal Corporation',
          '  நகராட்சி → Municipality',
          '  பஞ்சாயத்து → Panchayat',
          '  முன்னுரிமை → Priority',
          '  சரிபார்ப்பு → Verification',
          '  பகுப்பாய்வு → Analysis',
          '  குறைதீர்ப்பு → Grievance',
          '  அலுவலர் → Officer',
          '  அதிகாரி → Authority',
          '',
          'RULES:',
          '1. Preserve ALL proper nouns (person names, place names, village names) exactly as written.',
          '2. Preserve ALL numbers, dates, survey numbers, door numbers, reference numbers.',
          '3. Use formal government register — not casual English.',
          '4. Return ONLY the translated text. No explanations.',
        ].join('\n');

    return this.call({
      system: govContext,
      user: text,
      temperature: 0,
      maxTokens: 1500,
    });
  }

  async extract(text: string, fields: string[]): Promise<AICompletion> {
    return this.call({
      system:
        'Extract the requested fields from the text. Return a JSON object with exactly those keys. ' +
        'Use null for a field that is genuinely absent - never guess or infer a value.',
      user: `Fields: ${fields.join(', ')}\n\nText:\n${text}`,
      temperature: 0,
      maxTokens: 800,
    }, { json: true });
  }

  /**
   * Embeddings.
   *
   * Not every vendor here exposes an embedding endpoint, and the application
   * only uses embeddings for optional semantic ranking. A provider that cannot
   * embed says so rather than returning zero vectors, which would silently
   * rank every document as equally similar.
   */
  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(`${this.label} does not provide embeddings.`);
  }

  /**
   * Speech-to-text is not provided here.
   *
   * Returning a marker rather than a fabricated transcript: a case record must
   * never carry words the citizen did not say.
   */
  async transcribe(audioRef: string): Promise<AICompletion> {
    return {
      text: `[transcription-unavailable] No speech-to-text engine is configured for ${audioRef}.`,
      model: this.model,
      latencyMs: 0,
    };
  }
}

/**
 * Transient-failure policy, shared by every vendor.
 *
 * A shared model returns 503 ("currently overloaded") often enough that a
 * single attempt fails several times in a row, which reads to an officer as a
 * broken system. Three spaced retries clear almost all of them; beyond that the
 * error is genuine and is reported rather than hidden.
 */
export const MAX_RETRIES = 3;
export const RETRY_DELAYS = [800, 2000, 4500];

/**
 * Whether a failure is worth retrying.
 *
 * A 429 is either "too fast" or "out of quota for the day", and the two need
 * opposite handling. Retrying a daily-quota failure just delays every request
 * by seven seconds before failing anyway, which made the whole application feel
 * broken once a free tier ran out. The quota case is surfaced immediately so
 * the local fallback takes over.
 */
export function shouldRetry(status: number, detail: string, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) return false;
  if (status === 503 || status === 500 || status === 502) return true;
  if (status === 429) return !/quota|billing|insufficient_quota/i.test(detail);
  return false;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
