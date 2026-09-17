/**
 * Ingest the Tamil Nadu petition-routing knowledge base.
 *
 * Reads the supplied reference PDF - issue type -> department -> Act -> section
 * - and writes it into kb_department, kb_act, kb_section and kb_subject, so the
 * analyser and the Copilot route from real published mappings rather than from
 * keyword guesswork.
 *
 * WHY THIS IS AN INGESTION AND NOT A SEED
 *
 * Nothing here is invented. Every department, Act and section number comes from
 * the document, and each row records where it came from, so an officer can
 * trace any recommendation back to its source. The document itself says the
 * section numbers are "the most commonly cited / typical sections... a routing
 * aid, not a legal opinion", so every Act is written with
 * verification_status = 'UNVERIFIED' and that caveat in its source_reference.
 * The system continues to say "Requires Officer Verification" on every match.
 *
 * Re-running is safe: rows are matched on their natural key and updated rather
 * than duplicated.
 */
import { existsSync } from 'node:fs';
import { parseRoutingPdf } from './parse-routing-pdf.js';
import { resolve } from 'node:path';
import { db, tx, initSchema } from '../core/db.js';
import { initTranslationCache } from '../core/translate.js';

// --------------------------------------------------------------- ingestion
function upsertDepartment(name: string, source: string): number {
  const found = db.prepare('SELECT id FROM kb_department WHERE name = ?').get(name) as any;
  if (found) return found.id;

  const code = name
    .replace(/\s*Department$/i, '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 12);

  const r = db.prepare(`
    INSERT INTO kb_department (code, name, responsibilities, verification_status, active)
    VALUES (?, ?, ?, 'UNVERIFIED', 1)
  `).run(`${code}-${Math.random().toString(36).slice(2, 5)}`, name, source);
  return Number(r.lastInsertRowid);
}

function upsertAct(name: string, source: string): number {
  const found = db.prepare('SELECT id FROM kb_act WHERE short_name = ?').get(name) as any;
  if (found) return found.id;

  const year = Number(name.match(/\b(1[89]\d{2}|20\d{2})\b/)?.[1] ?? 0) || null;
  const r = db.prepare(`
    INSERT INTO kb_act (short_name, full_title, act_type, year, jurisdiction,
      summary, verification_status, source_reference, active, is_demo)
    VALUES (?, ?, 'ACT', ?, 'STATE', ?, 'UNVERIFIED', ?, 1, 0)
  `).run(name, name, year, source, source);
  return Number(r.lastInsertRowid);
}

export async function ingestRoutingKb(pdfPath: string): Promise<{
  rows: number; departments: number; acts: number; sections: number; subjects: number;
}> {
  // Parsed by coordinate: the tables wrap every cell across several lines, so
  // reading the text layer as lines interleaves the four columns.
  const rows = await parseRoutingPdf(pdfPath);

  const SOURCE =
    'Tamil Nadu Government petition-routing knowledge base (supplied reference document, '
    + 'September 2026). Section numbers are the commonly cited sections for this issue type '
    + 'and are a routing aid, not a legal opinion - verify against the current bare Act.';

  let nDept = 0; let nAct = 0; let nSec = 0; let nSub = 0;

  tx(() => {
    for (const row of rows) {
      const deptId = upsertDepartment(row.department, SOURCE);
      if (deptId) nDept++;

      // An Act cell can name two Acts ("Registration Act, 1908 & Indian Stamp Act, 1899").
      const actNames = row.act
        .split(/\s+&\s+/)
        .map((a) => a.trim().replace(/\s*\(earlier[^)]*\)/i, '').trim())
        .filter((a) => a.length > 6);

      for (const actName of actNames) {
        const actId = upsertAct(actName, SOURCE);
        if (actId) nAct++;

        db.prepare(
          'INSERT OR IGNORE INTO kb_department_act (department_id, act_id) VALUES (?, ?)',
        ).run(deptId, actId);

        if (row.section) {
          const exists = db.prepare(
            'SELECT id FROM kb_section WHERE act_id = ? AND section_no = ?',
          ).get(actId, row.section) as any;
          if (!exists) {
            db.prepare(`
              INSERT INTO kb_section (act_id, section_no, heading, text, applies_when, keywords, active)
              VALUES (?, ?, ?, ?, ?, ?, 1)
            `).run(actId, row.section.slice(0, 200), row.issue.slice(0, 200), SOURCE, row.issue, row.issue);
            nSec++;
          }
        }
      }

      /*
       * The issue type becomes a subject, which is what routes a petition about
       * "patta not issued" to Revenue without anyone writing a keyword rule.
       */
      const subjectExists = db.prepare('SELECT id FROM kb_subject WHERE name = ?').get(row.issue) as any;
      if (!subjectExists) {
        const code = row.issue.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 36);
        db.prepare(`
          INSERT INTO kb_subject (code, name, description, default_department_id,
            default_priority, keywords, active)
          VALUES (?, ?, ?, ?, 'NORMAL', ?, 1)
        `).run(
          `${code}-${Math.random().toString(36).slice(2, 4)}`, row.issue, row.domain,
          deptId, row.issue,
        );
        nSub++;
      }
    }
  });

  return {
    rows: rows.length, departments: nDept, acts: nAct, sections: nSec, subjects: nSub,
  };
}

// ------------------------------------------------------------------- CLI
const isMain = process.argv[1]?.endsWith('ingest-routing-kb.ts')
  || process.argv[1]?.endsWith('ingest-routing-kb.js');

if (isMain) {
  const arg = process.argv[2];
  if (!arg || !existsSync(arg)) {
    console.error('Usage: tsx src/db/ingest-routing-kb.ts <knowledge-base.pdf>');
    process.exit(1);
  }
  initSchema();
  initTranslationCache();
  const out = await ingestRoutingKb(resolve(arg));
  console.log('ingested:', JSON.stringify(out));
  process.exit(0);
}
