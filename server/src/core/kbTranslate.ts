import { db } from './db.js';

/**
 * Knowledge-base translation (RAG).
 *
 * Renders a petition subject in the selected language by RETRIEVING the closest
 * matching entry from the knowledge base and using its recorded translation,
 * rather than asking a language model to translate free text.
 *
 * WHY RETRIEVAL AND NOT AN LLM CALL
 *
 *   - It is correct where it matters. "patta not transferred" maps to the
 *     configured subject "Patta / land ownership record dispute", whose Tamil
 *     name a human recorded. A model asked to translate the phrase cold would
 *     produce something plausible but not the department's own wording.
 *   - It costs nothing and cannot fail. The list renders the same whether or
 *     not a model is configured, in quota, or reachable.
 *   - It is auditable. Every rendering names the knowledge-base row it came
 *     from, so an officer can see why a subject reads the way it does.
 *
 * WHAT IT DOES NOT DO. It does not attempt to translate arbitrary prose. Where
 * no knowledge-base entry matches closely enough, the original is returned
 * unchanged and marked as untranslated - a list showing the citizen's own words
 * is honest, whereas a machine paraphrase of a grievance is not.
 */

export interface KbRendering {
  text: string;
  /** True when a knowledge-base translation was used. */
  translated: boolean;
  /** The knowledge-base entry this came from, for the audit trail. */
  source?: string;
}

const TAMIL = /[஀-௿]/;

export function detectLang(text: string): 'ta' | 'en' | 'unknown' {
  const s = String(text ?? '');
  const ta = (s.match(/[஀-௿]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  if (!ta && !en) return 'unknown';
  return ta > en ? 'ta' : 'en';
}

/** Words that carry no matching power. */
const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'is', 'not', 'for', 'and', 'or', 'my',
  'at', 'on', 'by', 'has', 'have', 'been', 'was', 'were', 'it', 'this', 'that',
  'petition', 'complaint', 'issue', 'problem', 'please', 'sir', 'madam',
]);

function terms(s: string): string[] {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9஀-௿\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * A crude English stem.
 *
 * Enough to pair "registered"/"register" and "inaction"/"action", without the
 * weight of a real stemmer. It is only ever used to compare two words, so an
 * imperfect stem costs nothing as long as it is applied consistently.
 */
function englishStem(w: string): string {
  return w
    .replace(/(?:ation|ations)$/, 'ate')
    .replace(/(?:ing|ings)$/, '')
    .replace(/(?:ed|es|s)$/, '')
    .replace(/(?:ment|ments)$/, '')
    .replace(/^(?:in|un|non)(?=[a-z]{4})/, '');
}

interface Pair { en: string; ta: string; label: string }

let cache: Pair[] | null = null;
let cachedAt = 0;
const renderCache = new Map<string, KbRendering>();

/**
 * Every bilingual pair the knowledge base holds.
 *
 * Subjects first - they are written as petition issue types and so match a
 * citizen's wording most closely - then departments and Acts, which catch a
 * subject line that names one directly.
 */
function pairs(): Pair[] {
  // Refresh every few minutes so newly configured entries are picked up
  // without a restart.
  if (cache && Date.now() - cachedAt < 5 * 60_000) return cache;

  const out: Pair[] = [];
  const add = (en: unknown, ta: unknown, label: string) => {
    const e = String(en ?? '').trim();
    const t = String(ta ?? '').trim();
    if (e.length > 2 && t.length > 1 && e !== t) out.push({ en: e, ta: t, label });
  };

  for (const r of db.prepare(
    "SELECT name, name_ta FROM kb_subject WHERE active = 1",
  ).all() as any[]) add(r.name, r.name_ta, 'subject');

  for (const r of db.prepare(
    "SELECT name, name_ta FROM kb_department WHERE active = 1",
  ).all() as any[]) add(r.name, r.name_ta, 'department');

  for (const r of db.prepare(
    "SELECT short_name, short_name_ta FROM kb_act WHERE active = 1",
  ).all() as any[]) add(r.short_name, r.short_name_ta, 'Act');

  cache = out;
  cachedAt = Date.now();
  return out;
}

/** Drop the cache so a knowledge-base edit takes effect immediately. */
export function invalidateKbTranslations(): void {
  cache = null;
  renderCache.clear();
}

/**
 * Render `text` in `target` using the knowledge base.
 *
 * Returns the original unchanged when it is already in the target language or
 * when nothing matches well enough to be trustworthy.
 */
export function renderInLanguage(text: string, target: 'ta' | 'en'): KbRendering {
  const src = String(text ?? '').trim();
  if (src.length < 3) return { text: src, translated: false };
  if (detectLang(src) === target) return { text: src, translated: false };

  const cacheKey = `${target}:${src}`;
  const cached = renderCache.get(cacheKey);
  if (cached) return cached;

  const from = target === 'ta' ? 'en' : 'ta';
  const srcTerms = terms(src);
  if (!srcTerms.length) return { text: src, translated: false };

  let best: { pair: Pair; score: number } | null = null;

  for (const pair of pairs()) {
    const candidate = pair[from];
    const candTerms = terms(candidate);
    if (!candTerms.length) continue;

    /*
     * How much of the knowledge-base entry appears in the subject, and how
     * much of the subject is accounted for by the entry.
     *
     * Tamil is agglutinative: "காவல்துறை" (police department) contains
     * "காவல்", and "மின்சாரம்" contains "மின்". Exact token equality therefore
     * misses matches that are obviously right, so a Tamil term also counts
     * when one contains the other. Latin words still require a whole-token
     * match, where substring matching would be far too loose ("act" inside
     * "action").
     */
    const shared = candTerms.filter((w) => {
      if (srcTerms.includes(w)) return true;

      // Tamil: agglutinative, so containment either way counts.
      if (TAMIL.test(w)) {
        if (w.length < 4) return false;
        return srcTerms.some((s2) => (
          TAMIL.test(s2) && s2.length >= 4 && (s2.includes(w) || w.includes(s2))
        ));
      }

      /*
       * English: compare stems, so "registered" matches "register" and
       * "inaction" matches "action". Whole-word equality alone missed
       * obviously-right pairs like "police inaction" and "police refusing to
       * register". Stems below four characters are too generic to compare.
       */
      const stem = englishStem(w);
      if (stem.length < 4) return false;
      return srcTerms.some((s2) => !TAMIL.test(s2) && englishStem(s2) === stem);
    }).length;
    if (!shared) continue;

    const coverage = shared / candTerms.length;
    const precision = shared / srcTerms.length;
    const score = coverage * 0.6 + precision * 0.4;

    if (!best || score > best.score) best = { pair, score };
  }

  /*
   * The threshold is deliberately high. A weak match would relabel a citizen's
   * grievance as a different issue type, which is worse than leaving it in the
   * language they wrote it in.
   */
  if (!best || best.score < 0.5) {
    const res: KbRendering = { text: src, translated: false };
    renderCache.set(cacheKey, res);
    return res;
  }

  const res: KbRendering = {
    text: best.pair[target],
    translated: true,
    source: `${best.pair.label}: ${best.pair[from]}`,
  };
  renderCache.set(cacheKey, res);
  return res;
}

export function renderManyInLanguage(texts: string[], target: 'ta' | 'en'): KbRendering[] {
  return texts.map((t) => renderInLanguage(t, target));
}

export { TAMIL };
