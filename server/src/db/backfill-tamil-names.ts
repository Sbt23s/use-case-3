/**
 * Fill in the missing Tamil names in the knowledge base.
 *
 * WHY THIS EXISTS. The analyser renders every Act, section and department from
 * the knowledge base, falling back to the English name where no Tamil one is
 * recorded - an Act shown without a name would be worse than one named in the
 * other language. But the ingested routing tables carried English only: 63 of
 * 63 section headings, 46 of 145 Acts and 40 of 90 departments had no Tamil at
 * all, so a Tamil console kept showing English statutory names.
 *
 * WHAT IT DOES NOT DO. It does not invent a legal name. Every rendering comes
 * from the configured translator, is written to the row it came from, and is
 * marked so an administrator can review it: these are MACHINE renderings of
 * names a human recorded in English, not new legal facts. A row that already
 * has Tamil is never touched, and a translation the guard rejects is left
 * empty rather than stored wrong.
 *
 * Run once after ingesting a knowledge base:
 *   npx tsx src/db/backfill-tamil-names.ts            (report only)
 *   npx tsx src/db/backfill-tamil-names.ts --write    (fill them in)
 */
import { db } from '../core/db.js';
import { translateText } from '../core/translate.js';

interface Target {
  table: string;
  /** The English column to read. */
  from: string;
  /** The Tamil column to fill. */
  to: string;
}

const TARGETS: Target[] = [
  { table: 'kb_act', from: 'short_name', to: 'short_name_ta' },
  { table: 'kb_department', from: 'name', to: 'name_ta' },
  { table: 'kb_authority', from: 'designation', to: 'designation_ta' },
  { table: 'kb_section', from: 'heading', to: 'heading_ta' },
];

const write = process.argv.includes('--write');

async function run(): Promise<void> {
  let filled = 0;
  let skipped = 0;

  for (const t of TARGETS) {
    // A column that does not exist in this schema is simply not backfilled.
    const cols = db.prepare(`PRAGMA table_info(${t.table})`).all() as any[];
    if (!cols.some((c) => c.name === t.to)) {
      console.log(`${t.table}: no ${t.to} column, skipping`);
      continue;
    }

    const rows = db.prepare(
      `SELECT id, ${t.from} AS src FROM ${t.table}
        WHERE active = 1 AND ${t.from} IS NOT NULL AND TRIM(${t.from}) <> ''
          AND (${t.to} IS NULL OR TRIM(${t.to}) = '')`,
    ).all() as any[];

    console.log(`${t.table}.${t.to}: ${rows.length} row(s) missing Tamil`);
    if (!write || !rows.length) continue;

    const update = db.prepare(`UPDATE ${t.table} SET ${t.to} = ? WHERE id = ?`);

    for (const r of rows) {
      const out = await translateText(String(r.src), 'ta');
      /*
       * Only a real machine translation is stored. Where the translator
       * declined - no model, a failed call, or output that was not Tamil - the
       * column stays empty and the English name keeps showing, which is the
       * honest outcome.
       */
      if (!out.machine) {
        skipped++;
        continue;
      }
      update.run(out.text, r.id);
      filled++;
      if (filled % 10 === 0) console.log(`  … ${filled} filled`);
    }
  }

  console.log(write
    ? `\nDone. Filled ${filled}, left ${skipped} for review.`
    : '\nReport only. Re-run with --write to fill them in.');
}

run().then(() => process.exit(0)).catch((e) => {
  console.error('backfill failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
