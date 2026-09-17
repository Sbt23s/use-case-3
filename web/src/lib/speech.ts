/**
 * Speech-to-text using the browser Web Speech API.
 *
 * Real recognition of real speech, running on the officer's own device. The
 * audio never leaves the machine, which is the right default for a citizen's
 * statement, and it needs no server dependency.
 *
 * Every transcript it produces is a DRAFT. The officer reads it back to the
 * speaker and corrects it before it is saved: the system must never treat a
 * machine transcript as the citizen's own words without that check.
 *
 * Availability is reported honestly - where the browser has no engine, the
 * caller shows the typed-entry path instead of pretending to listen.
 */

export interface SpeechSupport {
  supported: boolean;
  reason?: string;
}

type SpeechRecognitionCtor = new () => any;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupport(): SpeechSupport {
  if (!getCtor()) {
    return {
      supported: false,
      reason:
        'This browser does not provide a speech recognition engine. Chrome or Edge support it. ' +
        'The statement can be typed instead.',
    };
  }
  if (!window.isSecureContext) {
    return {
      supported: false,
      reason:
        'Microphone access requires a secure context (HTTPS or localhost). ' +
        'The statement can be typed instead.',
    };
  }
  return { supported: true };
}

/** BCP-47 tags. Official language support is a deployment configuration concern. */
export const SPEECH_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'bn-IN', label: 'Bengali' },
  { code: 'en-GB', label: 'English (UK)' },
];

export interface DictationHandlers {
  /** Stable text the engine has committed. */
  onFinal: (text: string) => void;
  /** In-flight text the engine may still revise. */
  onInterim: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export interface Dictation {
  stop: () => void;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone permission was refused. Allow microphone access, or type the statement.',
  'service-not-allowed': 'The browser blocked the speech service. The statement can be typed instead.',
  'no-speech': 'No speech was detected. Check the microphone and try again.',
  'audio-capture': 'No microphone was found. The statement can be typed instead.',
  network: 'The speech service could not be reached. The statement can be typed instead.',
  aborted: 'Recording stopped.',
};

/**
 * Start continuous dictation. Returns a handle whose stop() ends the session.
 *
 * The engine may fire `end` on its own (a pause, a timeout). While the caller
 * still wants to record, we restart it, so a long statement is not silently
 * truncated mid-sentence.
 */
export function startDictation(lang: string, h: DictationHandlers): Dictation {
  const Ctor = getCtor();
  if (!Ctor) {
    h.onError('No speech recognition engine is available in this browser.');
    h.onEnd();
    return { stop: () => {} };
  }

  let stopped = false;
  let rec: any = null;

  const build = () => {
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res[0]?.transcript ?? '';
        if (res.isFinal) h.onFinal(text.trim());
        else interim += text;
      }
      h.onInterim(interim.trim());
    };

    r.onerror = (e: any) => {
      const code = e?.error ?? 'unknown';
      // A pause between sentences is normal, not a failure worth surfacing.
      if (code === 'no-speech' && !stopped) return;
      h.onError(ERRORS[code] ?? `Speech recognition error: ${code}`);
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
        stopped = true;
      }
    };

    r.onend = () => {
      if (stopped) { h.onEnd(); return; }
      try { r.start(); } catch { stopped = true; h.onEnd(); }
    };

    return r;
  };

  try {
    rec = build();
    rec.start();
  } catch (e) {
    h.onError(e instanceof Error ? e.message : 'Could not start the microphone.');
    h.onEnd();
    return { stop: () => {} };
  }

  return {
    stop: () => {
      stopped = true;
      try { rec?.stop(); } catch { /* already stopped */ }
    },
  };
}
