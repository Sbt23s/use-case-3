/**
 * Text-to-speech using the browser speech synthesis engine.
 *
 * Runs entirely on the officer's device - no audio is uploaded and no external
 * service is called. Voice availability varies by operating system, so the
 * caller is told honestly which languages this machine can actually speak
 * rather than offering a button that silently does nothing.
 */

export interface TtsSupport {
  supported: boolean;
  reason?: string;
}

export function ttsSupport(): TtsSupport {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return {
      supported: false,
      reason: 'This browser does not provide a speech engine. The text can still be read on screen.',
    };
  }
  return { supported: true };
}

/**
 * Voices load asynchronously in most browsers, so the first call can return an
 * empty list. This waits briefly for them.
 */
export function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve([]); return; }

    const existing = window.speechSynthesis.getVoices();
    if (existing.length) { resolve(existing); return; }

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.onvoiceschanged = null;
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.onvoiceschanged = done;
    setTimeout(done, timeoutMs);
  });
}

/**
 * Names that identify a female voice across the common platforms.
 *
 * Voice metadata does not carry a gender field, so the name is the only signal
 * available. This list covers the female voices shipped by Windows, macOS,
 * Android and Chrome for the languages used here.
 */
const FEMALE_NAMES = [
  // Windows
  'heera', 'kalpana', 'zira', 'susan', 'linda', 'hazel', 'catherine', 'sapna', 'swara',
  // macOS / iOS
  'samantha', 'karen', 'moira', 'tessa', 'veena', 'fiona', 'victoria', 'allison',
  'ava', 'vani', 'lekha', 'sangeeta', 'kanya',
  // Android / Chrome
  'google uk english female', 'google us english',
  // Generic markers some engines use
  'female', 'woman',
];

/** Checked first, so a male name is never mistaken for a female one. */
const MALE_NAMES = [
  'david', 'mark', 'ravi', 'hemant', 'george', 'daniel', 'alex', 'fred',
  'thomas', 'oliver', 'james', 'rishi', 'valluvar', 'male', 'man',
];

function looksFemale(voice: SpeechSynthesisVoice): boolean {
  const n = voice.name.toLowerCase();
  if (MALE_NAMES.some((m) => n.includes(m))) return false;
  return FEMALE_NAMES.some((f) => n.includes(f));
}

/**
 * Pick the best available voice for a language.
 *
 * A female voice is preferred, and an exact language match is preferred over a
 * base-language one. Where no female voice is installed for the language, any
 * matching voice is used rather than falling silent - the caller is told which
 * was chosen so it can say so honestly.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
  opts: { preferFemale?: boolean } = { preferFemale: true },
): SpeechSynthesisVoice | null {
  const want = lang.toLowerCase();
  const base = want.split('-')[0];

  const exact = voices.filter((v) => v.lang.toLowerCase() === want);
  const sameBase = voices.filter((v) => v.lang.toLowerCase().startsWith(base));

  if (opts.preferFemale !== false) {
    const femaleExact = exact.find(looksFemale);
    if (femaleExact) return femaleExact;
    const femaleBase = sameBase.find(looksFemale);
    if (femaleBase) return femaleBase;
  }

  return exact[0] ?? sameBase[0] ?? null;
}

/** Whether the chosen voice for a language is a female one. */
export async function voiceInfo(lang: string): Promise<{
  found: boolean; name: string | null; female: boolean;
}> {
  const voices = await loadVoices();
  const v = pickVoice(voices, lang);
  return { found: !!v, name: v?.name ?? null, female: v ? looksFemale(v) : false };
}

export async function hasVoiceFor(lang: string): Promise<boolean> {
  const voices = await loadVoices();
  return pickVoice(voices, lang) !== null;
}

export interface SpeakHandle {
  stop: () => void;
}

export interface SpeakOptions {
  lang: string;
  rate?: number;
  pitch?: number;
  /** Defaults to true - a female voice is used where one is available. */
  preferFemale?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/**
 * Speak text. Long passages are split into sentence-sized utterances because
 * several browsers truncate or stall on a single very long one.
 */
export async function speak(text: string, opts: SpeakOptions): Promise<SpeakHandle> {
  const clean = text
    .replace(/[*_#`]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!clean) {
    opts.onEnd?.();
    return { stop: () => {} };
  }

  window.speechSynthesis.cancel();

  const voices = await loadVoices();
  const voice = pickVoice(voices, opts.lang, { preferFemale: opts.preferFemale !== false });

  if (!voice) {
    opts.onError?.(
      `No ${opts.lang.startsWith('ta') ? 'Tamil' : opts.lang} voice is installed on this device. ` +
      'The text is shown on screen and can be read there.',
    );
    opts.onEnd?.();
    return { stop: () => {} };
  }

  // Split on sentence ends, keeping chunks under a length most engines handle.
  const chunks: string[] = [];
  let current = '';
  for (const part of clean.split(/(?<=[.!?।])\s+/)) {
    if ((current + part).length > 200 && current) { chunks.push(current.trim()); current = ''; }
    current += `${part} `;
  }
  if (current.trim()) chunks.push(current.trim());

  let index = 0;
  let stopped = false;
  opts.onStart?.();

  const speakNext = () => {
    if (stopped || index >= chunks.length) {
      if (!stopped) opts.onEnd?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(chunks[index++]);
    u.voice = voice;
    u.lang = voice.lang;
    /*
     * Slightly slower and slightly higher than default.
     *
     * An officer is listening to legal recommendations they may act on, so
     * clarity matters more than speed; the small pitch lift keeps a synthetic
     * voice from sounding flat over a long passage.
     */
    u.rate = opts.rate ?? 0.92;
    u.pitch = opts.pitch ?? 1.08;
    u.onend = speakNext;
    u.onerror = (e) => {
      // 'interrupted' and 'canceled' are what a deliberate stop looks like.
      const err = (e as any)?.error;
      if (err === 'interrupted' || err === 'canceled') return;
      opts.onError?.(`Speech failed: ${err ?? 'unknown error'}`);
      opts.onEnd?.();
    };
    window.speechSynthesis.speak(u);
  };
  speakNext();

  return {
    stop: () => {
      stopped = true;
      window.speechSynthesis.cancel();
      opts.onEnd?.();
    },
  };
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

/**
 * Build the spoken script for an analysis result.
 *
 * Reads the recommendation and, crucially, the verification requirement - an
 * officer listening rather than reading must still be told this is a suggestion
 * awaiting their judgement.
 */
/** Priority is a fixed enum, so reading it in Tamil is a lookup. */
const PRIORITY_TA: Record<string, string> = {
  HIGH: 'உயர்', NORMAL: 'இயல்பு', LOW: 'குறைவு',
};

export function buildSpeech(a: any, lang: 'en' | 'ta'): string {
  if (!a) return '';

  /*
   * The analysis is bilingual: each field is { en, ta }. Read the requested
   * language, falling back to English where a Tamil rendering is not available
   * (the petitioner's own words are never machine-translated, so some fields
   * carry the source text in both).
   */
  const pick = (b: any): string => {
    if (!b) return '';
    if (typeof b === 'string') return b;
    return strip(b[lang] || b.en || '');
  };

  if (lang === 'ta') {
    const L: string[] = [];
    L.push('மனு பகுப்பாய்வு முடிவு.');
    L.push(`சுருக்கம். ${pick(a.summary)}`);
    L.push(`முக்கிய பிரச்சினை. ${pick(a.main_issue)}`);
    L.push(`மனுதாரர் கோரிக்கை. ${pick(a.petitioner_request)}`);
    L.push(a.act?.short_name
      ? `பொருந்தக்கூடிய சட்டம். ${pick(a.act.short_name)}${a.act.section_no ? `, பிரிவு ${a.act.section_no}` : ''}. ` +
        `ஏன் பொருந்தும். ${pick(a.act.reason)}`
      : 'பொருந்தக்கூடிய சட்டம் கட்டமைக்கப்பட்ட அறிவுத் தளத்தில் காணப்படவில்லை.');
    L.push(a.department?.name
      ? `பரிந்துரைக்கப்பட்ட துறை. ${pick(a.department.name)}.`
      : 'துறை கண்டறியப்படவில்லை.');
    L.push(a.authority?.designation
      ? `பரிந்துரைக்கப்பட்ட அலுவலர். ${pick(a.authority.designation)}.`
      : 'அலுவலர் கண்டறியப்படவில்லை.');
    L.push(`பரிந்துரைக்கப்பட்ட நடவடிக்கை. ${pick(a.next_action)}`);
    if (a.workflow?.length) {
      // Numbered aloud, so a listener can follow the order of the steps.
      const steps = a.workflow
        .map((w: any, i: number) => `படி ${i + 1}. ${pick(w)}`)
        .join(' ');
      L.push(`அடுத்த படிகள். ${steps}`);
    }
    if (a.missing_information?.length) {
      L.push(`மனுதாரரிடமிருந்து தேவைப்படுவது. ${a.missing_information.map(pick).join(' ')}`);
    }
    L.push(`முன்னுரிமை. ${PRIORITY_TA[a.priority] ?? a.priority ?? ''}.`);
    L.push('இது AI பரிந்துரை மட்டுமே. அதிகாரி சரிபார்ப்பு தேவை.');
    return L.filter(Boolean).join(' ');
  }

  const L: string[] = [];
  L.push('Petition analysis result.');
  L.push(`Summary. ${pick(a.summary)}`);
  L.push(`Main issue. ${pick(a.main_issue)}`);
  L.push(`Petitioner request. ${pick(a.petitioner_request)}`);
  L.push(a.act?.short_name
    ? `Applicable Act. ${pick(a.act.short_name)}${a.act.section_no ? `, section ${a.act.section_no}` : ''}. ` +
      `Why it may apply. ${pick(a.act.reason)}`
    : 'No applicable Act was matched in the configured knowledge base.');
  L.push(a.department?.name
    ? `Recommended department. ${pick(a.department.name)}. ${pick(a.department.reason)}`
    : 'No department was matched.');
  L.push(a.authority?.designation
    ? `Recommended authority. ${pick(a.authority.designation)}.`
    : 'No authority was matched.');
  L.push(`Recommended action. ${pick(a.next_action)}`);
  if (a.workflow?.length) {
    const steps = a.workflow
      .map((w: any, i: number) => `Step ${i + 1}. ${pick(w)}`)
      .join(' ');
    L.push(`Next steps. ${steps}`);
  }
  if (a.missing_information?.length) {
    L.push(`Required from the petitioner. ${a.missing_information.map(pick).join(' ')}`);
  }
  L.push(`Priority. ${a.priority ?? ''}.`);
  L.push('This is an AI recommendation and requires officer verification.');
  return L.filter(Boolean).join(' ');
}

/** Remove the trailing verification marker so it is not read out repeatedly. */
function strip(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/Requires Officer Verification\.?/gi, '')
    .replace(/அதிகாரி சரிபார்ப்பு தேவை\.?/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
