/**
 * Act verification against official government sources.
 *
 * The knowledge base holds the NAMES of Tamil Nadu and central Acts, but a name
 * is not a legal authority. Until an entry has been matched to a page on an
 * official domain, it carries verification_status = 'UNVERIFIED' and the
 * officer sees "Requires Officer Verification" beside it.
 *
 * This service closes that gap for real: it searches the official-domain
 * allowlist (indiacode.nic.in, tn.gov.in, egazette.gov.in and the rest), and
 * where it finds a page that genuinely corresponds to the Act, it records the
 * URL, the title it matched, and the date it was checked.
 *
 * WHAT IT DOES NOT DO, deliberately:
 *
 *   - It does not invent a citation. If no official page is found, the entry
 *     stays UNVERIFIED and says so. A wrong source is worse than no source.
 *   - It does not mark an entry VERIFIED on a weak match. A title has to
 *     correspond on the distinctive words of the Act's name AND its year
 *     before the status moves, and even then the status is AUTO_VERIFIED, not
 *     VERIFIED - a machine match is evidence for an officer, not a substitute
 *     for one. Only an officer can set VERIFIED.
 *   - It does not fetch statutory TEXT and present it as the section. The
 *     knowledge base holds no section text; claiming otherwise would be the
 *     exact hallucination this system is built to prevent.
 */
import { db } from './db.js';
import { searchOfficialSources } from './search.js';

export type VerifyOutcome =
  | { status: 'AUTO_VERIFIED'; url: string; title: string; note: string }
  | { status: 'UNVERIFIED'; note: string };

/** Words that carry no distinguishing power when matching an Act title. */
const STOP = new Set([
  'act', 'the', 'of', 'and', 'for', 'to', 'in', 'a', 'an', 'or', 'on', 'by',
  'tamil', 'nadu', 'india', 'indian', 'central', 'state', 'government',
  'rules', 'regulation', 'regulations', 'amendment', 'framework', 'applicable',
  'current', 'bodies', 'general',
]);

function significantWords(name: string): string[] {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d{4}$/.test(w));
}

function yearOf(name: string, year?: number | null): string | null {
  if (year && year > 1800 && year < 2100) return String(year);
  const m = String(name || '').match(/\b(1[89]\d{2}|20\d{2})\b/);
  return m ? m[1] : null;
}

/**
 * Decide whether a search result really is this Act.
 *
 * Requires most of the distinctive words to be present, and - where the Act
 * has a year - that year to appear too. "Tamil Nadu Land Encroachment Act,
 * 1905" must not be confirmed by a page about the Land Acquisition Act, 2013.
 */
function matches(
  actName: string,
  year: number | null,
  candidateText: string,
): { ok: boolean; ratio: number } {
  const words = significantWords(actName);
  if (!words.length) return { ok: false, ratio: 0 };

  const hay = String(candidateText || '').toLowerCase();
  const hits = words.filter((w) => hay.includes(w)).length;
  const ratio = hits / words.length;

  const y = yearOf(actName, year);
  const yearOk = !y || hay.includes(y);

  // Two thirds of the distinctive words, and the year when there is one.
  return { ok: ratio >= 0.67 && yearOk, ratio };
}

/**
 * Verify a single Act row against official sources.
 *
 * Returns the outcome and, when a match is found, writes the provenance back
 * to the row. Never throws: a search failure is reported as UNVERIFIED with
 * the reason, because the caller is usually verifying many rows at once.
 */
export async function verifyAct(actId: number): Promise<VerifyOutcome> {
  const row = db.prepare('SELECT * FROM kb_act WHERE id = ?').get(actId) as any;
  if (!row) return { status: 'UNVERIFIED', note: 'No such Act in the knowledge base.' };

  const name: string = row.full_title || row.short_name || '';
  if (!name.trim()) {
    return { status: 'UNVERIFIED', note: 'The entry has no name to search for.' };
  }

  const query = `"${row.short_name}" Act full text`;
  let outcome;
  try {
    outcome = await searchOfficialSources(query, 5);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 'UNVERIFIED', note: `Official-source search failed: ${msg}` };
  }

  if (!outcome.ok) {
    return {
      status: 'UNVERIFIED',
      note: outcome.note ?? 'Official-source search was unavailable.',
    };
  }

  for (const r of outcome.results) {
    // Match against the title and snippet; the fetched page body is noisy and
    // a keyword can appear in an unrelated navigation menu.
    const m = matches(row.short_name, row.year ?? null, `${r.title} ${r.snippet}`);
    if (!m.ok) continue;

    const checkedOn = new Date().toISOString().slice(0, 10);
    const note =
      `Matched an official source on ${r.source} (${Math.round(m.ratio * 100)}% of the ` +
      `distinctive title words). Checked ${checkedOn}. This is an automated match ` +
      'against an official domain, not a reading of the statutory text - an officer ' +
      'must still confirm the provision before it is relied upon.';

    db.prepare(`
      UPDATE kb_act
         SET source_url = ?, gazette_reference = ?, notification_date = ?,
             verification_status = 'AUTO_VERIFIED', source_reference = ?,
             updated_at = datetime('now')
       WHERE id = ?
    `).run(r.url, r.title.slice(0, 300), checkedOn, note, actId);

    return { status: 'AUTO_VERIFIED', url: r.url, title: r.title, note };
  }

  const note =
    outcome.results.length
      ? `Searched ${outcome.results.length} official page(s); none corresponded closely ` +
        'enough to this Act to be recorded as its source. The entry remains unverified.'
      : 'No official government page was found for this Act. The entry remains unverified.';

  db.prepare(
    "UPDATE kb_act SET source_reference = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(note, actId);

  return { status: 'UNVERIFIED', note };
}

/**
 * Verify many Acts, sequentially.
 *
 * Sequential on purpose: the default search provider is a scraper with no API
 * contract, and firing a hundred parallel requests at it would be both rude
 * and self-defeating. Callers run this in the background.
 */
export async function verifyActs(
  ids: number[],
  onProgress?: (done: number, total: number, id: number, outcome: VerifyOutcome) => void,
): Promise<{ verified: number; unverified: number; blocked: boolean; note?: string }> {
  let verified = 0;
  let unverified = 0;

  /*
   * THROTTLING, and why it is not optional.
   *
   * The default provider scrapes a public HTML endpoint. Running ninety-nine
   * verifications back to back got every request answered with 403 and marked
   * every Act unverified - a result that looks like "none of these Acts are
   * real" when it actually means "we were blocked". That failure mode is
   * exactly the kind of confidently-wrong output this system must not produce.
   *
   * So: a pause between requests, and a hard stop when the provider starts
   * refusing. Stopping and reporting honestly is better than grinding through
   * the remaining rows recording failures that say nothing about the Acts.
   */
  const GAP_MS = Number(process.env.ACT_VERIFY_GAP_MS ?? 2500);
  const BLOCK_LIMIT = 3;
  let consecutiveFailures = 0;

  for (let i = 0; i < ids.length; i++) {
    const outcome = await verifyAct(ids[i]);

    if (outcome.status === 'AUTO_VERIFIED') {
      verified++;
      consecutiveFailures = 0;
    } else {
      unverified++;
      // Distinguish "the search engine refused us" from "this Act was not
      // found". Only the former means the run itself is worthless.
      if (/returned 4\d\d|could not be reached|unavailable/i.test(outcome.note)) {
        consecutiveFailures++;
      } else {
        consecutiveFailures = 0;
      }
    }

    onProgress?.(i + 1, ids.length, ids[i], outcome);

    if (consecutiveFailures >= BLOCK_LIMIT) {
      return {
        verified, unverified, blocked: true,
        note:
          `The search provider stopped responding after ${i + 1} of ${ids.length} checks ` +
          '(it rate-limits bulk use). The Acts not yet checked were left untouched rather ' +
          'than marked unverified. Configure GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX ' +
          'for a search API that supports this volume, or verify entries individually.',
      };
    }

    if (i < ids.length - 1) {
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }

  return { verified, unverified, blocked: false };
}
