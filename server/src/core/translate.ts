import { db, addColumnIfMissing } from './db.js';
import { getProvider, isLiveProvider } from '../ai/gateway.js';
import { translateViaApi, isTranslateApiConfigured } from './translateApi.js';

/**
 * On-demand translation of stored text.
 *
 * Used for CONTENT the officer chose to see in the other language - a citizen's
 * subject line, their description - so that selecting Tamil really does render
 * the whole screen in Tamil.
 *
 * TWO PROPERTIES THAT MATTER ON A CASE FILE
 *
 *   1. The original is never overwritten. A translation is stored beside it,
 *      keyed by source text and target language, and the record continues to
 *      carry exactly what the petitioner submitted. An officer quoting the file
 *      is quoting the citizen, not a machine.
 *
 *   2. A translation is marked as one. The API returns `machine: true` so the
 *      UI can label it, because text the petitioner never wrote must not be
 *      presented as their own words.
 *
 * Results are cached: the same subject line is translated once, not on every
 * page load, which keeps the list fast and the API bill small.
 */

export function initTranslationCache(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_hash TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      source_text TEXT NOT NULL,
      translated   TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (source_hash, target_lang)
    )
  `);
  addColumnIfMissing('translation_cache', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))");
}

/** A stable key for a piece of source text. */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return `${h}:${s.length}`;
}

const TAMIL = /[஀-௿]/;
const LATIN = /[A-Za-z]/;

/** Which language is this text already in? */
export function detectLang(text: string): 'ta' | 'en' | 'unknown' {
  const s = String(text ?? '');
  const ta = (s.match(/[஀-௿]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  if (!ta && !en) return 'unknown';
  return ta > en ? 'ta' : 'en';
}

export interface TranslationResult {
  text: string;
  /** True when this is a machine rendering rather than the original. */
  machine: boolean;
  /** Why a translation was not produced, when it was not. */
  note?: string;
}

/**
 * Render `text` in `target`, translating only when it is not already in it.
 *
 * Returns the original unchanged - with `machine: false` - when the text is
 * already in the target language, when it is too short to be meaningful, or
 * when no live model is configured. Never throws: a failed translation returns
 * the original, because a case list must render either way.
 */
export async function translateText(
  text: string,
  target: 'ta' | 'en',
): Promise<TranslationResult> {
  const src = String(text ?? '').trim();
  if (src.length < 2) return { text: src, machine: false };

  // Already in the requested language: nothing to do.
  if (detectLang(src) === target) return { text: src, machine: false };

  const key = hash(src);
  const hit = db.prepare(
    'SELECT translated FROM translation_cache WHERE source_hash = ? AND target_lang = ?',
  ).get(key, target) as any;
  if (hit?.translated) return { text: hit.translated, machine: true };

  /*
   * A DEDICATED TRANSLATION SERVICE TAKES PRECEDENCE.
   *
   * It has its own quota and its own latency budget, so translation no longer
   * fails whenever the language model is rate-limited - which is exactly how a
   * Tamil console ended up showing English subject lines. Where it is not
   * configured, or the call fails, the model below still handles it.
   */
  if (isTranslateApiConfigured()) {
    const api = await translateViaApi(src, target, target === 'ta' ? 'en' : 'ta');
    if (api && detectLang(api.text) === target) {
      db.prepare(`
        INSERT OR IGNORE INTO translation_cache (source_hash, target_lang, source_text, translated)
        VALUES (?, ?, ?, ?)
      `).run(key, target, src, api.text);
      return { text: api.text, machine: true };
    }
  }

  if (!isLiveProvider()) {
    return {
      text: src,
      machine: false,
      note: 'No live model is configured, so the original text is shown.',
    };
  }

  try {
    /*
     * One retry, because a shared model drops requests under parallel load.
     *
     * A petition page translates its summary, main issue, request and facts at
     * once. With a single attempt some of those calls timed out and their
     * fields silently stayed in the source language - so an English console
     * showed an English summary above a Tamil main issue, which looks like a
     * translation bug rather than a dropped request.
     *
     * The pause is short: the aim is to survive a momentary refusal, not to
     * wait out a genuine outage, which the caller handles by keeping the
     * original text.
     */
    let out;
    try {
      out = await getProvider().translate(src, target);
    } catch (err: any) {
      const errStr = String(err?.message || err);
      if (errStr.includes('429') || errStr.includes('quota') || errStr.includes('401') || errStr.includes('403')) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 600));
      out = await getProvider().translate(src, target);
    }
    const translated = String(out.text ?? '').trim();
    // A model that returns nothing, or returns the prompt, is not a translation.
    if (!translated || translated.length > src.length * 6) {
      return { text: src, machine: false, note: 'The translation was not usable.' };
    }

    /*
     * The result must actually be in the requested language.
     *
     * A misconfigured or misbehaving endpoint can return a diagnostic string,
     * an echo of the prompt, or an English apology - and because results are
     * cached by source hash, accepting one writes it into the case list for
     * good. A translation into Tamil that contains no Tamil is not a
     * translation, so it is refused and the citizen's own words are kept.
     */
    if (detectLang(translated) !== target) {
      return {
        text: src,
        machine: false,
        note: `The model did not return ${target === 'ta' ? 'Tamil' : 'English'}.`,
      };
    }

    db.prepare(`
      INSERT OR IGNORE INTO translation_cache (source_hash, target_lang, source_text, translated)
      VALUES (?, ?, ?, ?)
    `).run(key, target, src, translated);

    return { text: translated, machine: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { text: src, machine: false, note: `Translation unavailable (${msg.slice(0, 80)}).` };
  }
}

/** Translate several strings, reusing the cache and running them together. */
export async function translateMany(
  texts: string[],
  target: 'ta' | 'en',
): Promise<TranslationResult[]> {
  return Promise.all(texts.map((t) => translateText(t, target)));
}

export { TAMIL, LATIN };
