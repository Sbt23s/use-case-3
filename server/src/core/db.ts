import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const DB_PATH = process.env.DB_PATH ?? resolve(DATA_DIR, 'gov.db');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  const sql = readFileSync(resolve(__dirname, '../db/schema.sql'), 'utf8');
  db.exec(sql);
  const kbSql = resolve(__dirname, '../db/knowledge-schema.sql');
  if (existsSync(kbSql)) db.exec(readFileSync(kbSql, 'utf8'));
  // Migrate existing databases: add columns added after initial deployment.
  addColumnIfMissing('cp_document', 'ocr_scripts', 'TEXT');
  addColumnIfMissing('cp_document', 'ocr_corrected_text', 'TEXT');
  addColumnIfMissing('cp_document', 'ocr_corrected_source', 'TEXT');
  addColumnIfMissing('cp_document', 'ocr_corrected_by', 'INTEGER');
  addColumnIfMissing('cp_document', 'ocr_corrected_at', 'TEXT');
  addColumnIfMissing('cp_analysis', 'result_json', 'TEXT');
  addColumnIfMissing('cp_petition', 'uploaded_by_officer', 'INTEGER NOT NULL DEFAULT 0');
  /*
   * Where a record came from.
   *
   * 'PETITION' is a real grievance and appears on the officer dashboard.
   * 'COPILOT' is a document an officer dropped into the e-Gov Copilot to have
   * it read and analysed - a working tool, not a citizen's case. Both run the
   * identical analysis pipeline, but a Copilot record must never be counted as
   * an incoming petition or appear in the queue.
   */
  addColumnIfMissing('cp_petition', 'origin', "TEXT NOT NULL DEFAULT 'PETITION'");
  /*
   * Petitioner particulars the backend read out of the document itself
   * (name, phone, address, date), stored as JSON with the evidence for each.
   *
   * Kept on the DOCUMENT, not written into cp_petition's citizen_* columns:
   * those hold what a person entered, and a machine reading of a scan must
   * never silently overwrite them. The officer sees both.
   */
  addColumnIfMissing('cp_document', 'extracted_details', 'TEXT');
  // Tamil rendering of an Act's required-documents list.
  addColumnIfMissing('kb_act', 'required_documents_ta', 'TEXT');

  /*
   * Where the file has got to in the office procedure.
   *
   * Separate from `status`, which records the AI pipeline's state. The two
   * answer different questions - status says whether the analysis has run,
   * stage says which desk the case is on - and a real petition is routinely
   * both "analysed" and "awaiting hearing" at once.
   *
   * Null until an officer records the first movement, so an existing petition
   * is not silently presented as having progressed.
   */
  addColumnIfMissing('cp_petition', 'workflow_stage', 'TEXT');
  addColumnIfMissing('cp_petition', 'workflow_stage_at', 'TEXT');

  /*
   * Every stage change, with who recorded it.
   *
   * The current stage alone cannot answer "when did this reach the Collector,
   * and who sent it there?", which is exactly what is asked when a case is
   * queried. Rows are never updated or deleted - moving a case back records a
   * further row, so the trail shows the correction rather than hiding it.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS cp_workflow_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      petition_id  INTEGER NOT NULL REFERENCES cp_petition(id) ON DELETE CASCADE,
      from_stage   TEXT,
      to_stage     TEXT NOT NULL,
      note         TEXT,
      changed_by   INTEGER REFERENCES app_user(id),
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ix_wf_history_petition
      ON cp_workflow_history(petition_id, id);
  `);
}

/** Run fn inside a transaction. */
export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}

/**
 * Add a column only if it is missing.
 *
 * SQLite has no "ADD COLUMN IF NOT EXISTS", so re-running a migration would
 * otherwise throw. Checking pragma first keeps the seed safely repeatable.
 */
export function addColumnIfMissing(table: string, column: string, definition: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}
