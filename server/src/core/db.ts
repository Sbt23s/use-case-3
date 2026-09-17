import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';
import { seed100Acts } from '../db/tn-100-acts.js';
import { seedExpandedActs } from '../db/tn-expanded-acts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const DB_PATH = process.env.DB_PATH ?? resolve(DATA_DIR, 'gov.db');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -20000');
db.pragma('temp_store = MEMORY');
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
  addColumnIfMissing('kb_act', 'rules', 'TEXT');
  addColumnIfMissing('kb_act', 'section', 'TEXT');
  addColumnIfMissing('kb_act', 'authority', 'TEXT');
  addColumnIfMissing('kb_act', 'petition_type', 'TEXT');
  addColumnIfMissing('kb_act', 'keywords_ta', 'TEXT');
  addColumnIfMissing('kb_act', 'workflow', 'TEXT');
  addColumnIfMissing('kb_act', 'official_source', 'TEXT');
  addColumnIfMissing('kb_act', 'last_verified_date', 'TEXT');
  addColumnIfMissing('kb_act', 'short_name_ta', 'TEXT');
  addColumnIfMissing('kb_act', 'full_title_ta', 'TEXT');
  addColumnIfMissing('kb_act', 'applies_when_ta', 'TEXT');
  addColumnIfMissing('kb_act', 'verification_status', "TEXT NOT NULL DEFAULT 'VERIFIED'");
  addColumnIfMissing('kb_department', 'name_ta', 'TEXT');
  addColumnIfMissing('kb_department', 'responsibilities_ta', 'TEXT');
  addColumnIfMissing('kb_section', 'heading_ta', 'TEXT');

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
    CREATE INDEX IF NOT EXISTS ix_cp_origin_created
      ON cp_petition(origin, created_at DESC);
    CREATE INDEX IF NOT EXISTS ix_cp_analysis_status
      ON cp_petition(analysis_status);
    CREATE INDEX IF NOT EXISTS ix_cp_verified
      ON cp_petition(officer_verified);
    CREATE INDEX IF NOT EXISTS ix_cpana_petition_id
      ON cp_analysis(petition_id, id DESC);
    CREATE INDEX IF NOT EXISTS ix_cpdoc_petition_id
      ON cp_document(petition_id);
    UPDATE app_user SET full_name = 'A. Kavitha' WHERE username = 'gro';
  `);

  // Ensure default Grievance Officer demo account exists and has the correct password
  try {
    const groUser = db.prepare("SELECT id FROM app_user WHERE username = 'gro'").get() as any;
    if (!groUser) {
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync('Officer@123', salt, 64).toString('hex');
      db.prepare("INSERT INTO app_user (username, full_name, password_hash, password_salt, active) VALUES ('gro', 'A. Kavitha', ?, ?, 1)").run(hash, salt);
    }
    db.prepare("INSERT OR IGNORE INTO role (code, name, description) VALUES ('GRIEVANCE_OFFICER', 'Grievance Officer', 'Grievance Officer Role')").run();
    db.prepare("INSERT OR IGNORE INTO user_role (user_id, role_id) SELECT u.id, r.id FROM app_user u, role r WHERE u.username = 'gro' AND r.code = 'GRIEVANCE_OFFICER'").run();
  } catch (e) {
    console.error('[db] ensure gro user error:', e);
  }

  try {
    seed100Acts(db);
  } catch (e) {
    console.error('[db] seed100Acts error:', e);
  }

  try {
    seedExpandedActs(db);
  } catch (e) {
    console.error('[db] seedExpandedActs error:', e);
  }
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
