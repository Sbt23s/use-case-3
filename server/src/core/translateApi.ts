/**
 * A dedicated translation service, used in preference to the language model.
 *
 * WHY A SEPARATE PATH. The LLM translates well but it is the same shared quota
 * the analyser and the Copilot draw on, it is slower than a purpose-built
 * endpoint, and when it is rate-limited every translation silently falls back
 * to the source language - which is how a Tamil console ends up showing
 * English. A translation API has its own quota and its own latency budget, so
 * the two failure modes stop being coupled.
 *
 * WHAT IT SUPPORTS. Any service that accepts a JSON POST of
 * `{ text, source, target }` (or the common variants) and returns the
 * translation in a predictable field. That covers the usual shapes:
 *
 *   Google Cloud Translation v2   { q, source, target }      -> data.translations[0].translatedText
 *   DeepL                         { text, source_lang, ... } -> translations[0].text
 *   LibreTranslate                { q, source, target }      -> translatedText
 *   Most hosted wrappers          { text, source, target }   -> translation | translatedText | result
 *
 * The response reader tries each known field rather than assuming one, so a
 * new provider usually needs only a URL and a key.
 *
 * NOTHING IS CONFIGURED BY DEFAULT. With no URL and no key this module reports
 * itself unavailable and the caller uses the language model exactly as before,
 * so a deployment that has not set it up is unaffected.
 */

export interface TranslateApiResult {
  text: string;
  /** Which provider produced it, for the audit trail. */
  provider: string;
}

/** Read the configuration fresh each time, so a restart is enough to change it. */
function config() {
  return {
    url: (process.env.TRANSLATE_API_URL || '').trim(),
    key: (process.env.TRANSLATE_API_KEY || '').trim(),
    /**
     * How the key is sent. Services differ, and sending it the wrong way looks
     * exactly like an invalid key, so it is explicit rather than guessed.
     *   bearer  Authorization: Bearer <key>     (most hosted APIs)
     *   header  <TRANSLATE_API_KEY_HEADER>: <key>
     *   query   ?key=<key>                      (Google Cloud Translation v2)
     *   body    { api_key: <key> }              (LibreTranslate)
     */
    auth: (process.env.TRANSLATE_API_AUTH || 'bearer').trim().toLowerCase(),
    keyHeader: (process.env.TRANSLATE_API_KEY_HEADER || 'X-API-Key').trim(),
    timeoutMs: Number(process.env.TRANSLATE_API_TIMEOUT_MS || 12000),
  };
}

export function isTranslateApiConfigured(): boolean {
  const c = config();
  return !!c.url && !!c.key;
}

/** What the settings dialog is told. Never includes the key itself. */
export function translateApiStatus() {
  const c = config();
  return {
    configured: isTranslateApiConfigured(),
    url: c.url ? new URL(c.url).host : null,
    auth: c.auth,
    note: isTranslateApiConfigured()
      ? undefined
      : 'Set TRANSLATE_API_URL and TRANSLATE_API_KEY in the server environment to use a '
        + 'dedicated translation service. Without it, translation uses the selected AI model.',
  };
}

/**
 * Pull the translated string out of whatever shape the service returned.
 *
 * Written as a search rather than a fixed path because the field name is the
 * one thing providers never agree on, and a wrong guess would look like an
 * empty translation rather than a configuration mistake.
 */
function readTranslation(body: any): string | null {
  if (!body) return null;
  if (typeof body === 'string') return body.trim() || null;

  const direct = body.translatedText ?? body.translated_text ?? body.translation ?? body.result ?? body.text
    ?? body.output ?? body.data?.translatedText ?? body.data?.translated_text ?? body.data?.translation;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  // Google Cloud Translation v2
  const g = body.data?.translations?.[0]?.translatedText ?? body.data?.translations?.[0]?.translated_text;
  if (typeof g === 'string' && g.trim()) return g.trim();

  // DeepL
  const d = body.translations?.[0]?.text ?? body.translations?.[0]?.translated_text;
  if (typeof d === 'string' && d.trim()) return d.trim();

  return null;
}

/**
 * Translate one string. Returns null when the service is not configured or the
 * call fails, so the caller can fall back rather than surface an error.
 */
export async function translateViaApi(
  text: string,
  target: 'ta' | 'en',
  source: 'ta' | 'en',
): Promise<TranslateApiResult | null> {
  const c = config();
  if (!c.url || !c.key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), c.timeoutMs);

  try {
    const url = new URL(c.url);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const body: Record<string, unknown> = {
      // The same value under each common name, so one shape fits most services.
      text, q: text,
      source, source_lang: source.toUpperCase(), source_language: source,
      target, target_lang: target.toUpperCase(), target_language: target,
      format: 'text',
    };

    if (c.auth === 'bearer') headers.Authorization = `Bearer ${c.key}`;
    else if (c.auth === 'header') headers[c.keyHeader] = c.key;
    else if (c.auth === 'query') url.searchParams.set('key', c.key);
    else if (c.auth === 'body') body.api_key = c.key;

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Logged, not thrown: a translation failure must never break a page.
      console.warn(`[translate-api] ${res.status} ${detail.slice(0, 160)}`);
      return null;
    }

    const parsed = await res.json().catch(() => null);
    const out = readTranslation(parsed);
    if (!out) {
      console.warn('[translate-api] response had no recognisable translation field');
      return null;
    }
    return { text: out, provider: `translate-api:${url.host}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[translate-api] call failed:', msg.slice(0, 160));
    return null;
  } finally {
    clearTimeout(timer);
  }
}
