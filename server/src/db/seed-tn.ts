/**
 * Loads the Tamil Nadu knowledge base into the AI Knowledge Configuration.
 *
 * Writes through the same tables the configuration UI reads and writes, so
 * every entry loaded here can afterwards be edited, deactivated or deleted from
 * the screen. Nothing is hard-coded into application logic.
 *
 * Re-runnable: entries are matched by name and updated rather than duplicated,
 * so a second run refreshes rather than doubling the knowledge base.
 *
 * Every record is loaded with verification_status = 'UNVERIFIED'. These entries
 * carry the NAME and subject area of real Acts, not verified statutory text.
 * An administrator must confirm each against the Gazette and record the source
 * before it is relied upon.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initSchema, tx, addColumnIfMissing } from '../core/db.js';
import { hashPassword } from '../core/auth.js';
import { TN_ACTS, TN_DEPARTMENTS, TN_AUTHORITIES, TN_SUBJECTS } from './tn-knowledge.js';
import {
  TAMIL_ACT_KEYWORDS, TAMIL_DEPARTMENT_KEYWORDS, TAMIL_SUBJECT_KEYWORDS,
} from './tamil-keywords.js';
import {
  ACT_NAMES_TA, DEPARTMENT_NAMES_TA, AUTHORITY_NAMES_TA, SUBJECT_NAMES_TA,
} from './tamil-names.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function migrate() {
  initSchema();
  db.exec(readFileSync(resolve(__dirname, 'knowledge-schema.sql'), 'utf8'));

  // Fields required by the knowledge structure:
  // Act -> Issue -> Section -> Department -> Authority -> Jurisdiction ->
  // Action -> Priority -> Required Documents -> Source -> Verification Status.
  addColumnIfMissing('kb_act', 'required_documents', 'TEXT');
  addColumnIfMissing('kb_act', 'source_url', 'TEXT');
  addColumnIfMissing('kb_act', 'gazette_reference', 'TEXT');
  addColumnIfMissing('kb_act', 'notification_date', 'TEXT');
  addColumnIfMissing('kb_act', 'verification_status', "TEXT NOT NULL DEFAULT 'UNVERIFIED'");
  addColumnIfMissing('kb_act', 'recommended_action', 'TEXT');
  addColumnIfMissing('kb_act', 'priority', 'TEXT');
  addColumnIfMissing('kb_department', 'source_url', 'TEXT');
  addColumnIfMissing('kb_department', 'verification_status', "TEXT NOT NULL DEFAULT 'UNVERIFIED'");
  addColumnIfMissing('kb_authority', 'source_url', 'TEXT');
  addColumnIfMissing('kb_authority', 'verification_status', "TEXT NOT NULL DEFAULT 'UNVERIFIED'");
  addColumnIfMissing('kb_section', 'required_documents', 'TEXT');
  addColumnIfMissing('kb_section', 'recommended_action', 'TEXT');

  // The analysis is produced in Tamil and English. Storing the whole result as
  // JSON keeps the two languages together and lets the shape evolve without a
  // migration for every new field.
  addColumnIfMissing('cp_analysis', 'result_json', 'TEXT');

  /*
   * Tamil names for every knowledge record.
   *
   * An officer reading the configuration in Tamil needs the Act and department
   * names in Tamil too - showing a Tamil interface with English-only records
   * would be half a translation. Kept as separate columns so the English name
   * remains the stable identifier while the Tamil name is what is displayed.
   */
  addColumnIfMissing('kb_act', 'short_name_ta', 'TEXT');
  addColumnIfMissing('kb_act', 'full_title_ta', 'TEXT');
  addColumnIfMissing('kb_act', 'applies_when_ta', 'TEXT');
  addColumnIfMissing('kb_department', 'name_ta', 'TEXT');
  addColumnIfMissing('kb_department', 'responsibilities_ta', 'TEXT');
  addColumnIfMissing('kb_authority', 'designation_ta', 'TEXT');
  addColumnIfMissing('kb_authority', 'office_name_ta', 'TEXT');
  addColumnIfMissing('kb_subject', 'name_ta', 'TEXT');
  addColumnIfMissing('kb_section', 'heading_ta', 'TEXT');

  // Which script OCR actually found, so the officer can see at a glance
  // whether a Tamil document was read with the Tamil model.
  addColumnIfMissing('cp_document', 'ocr_scripts', 'TEXT');
}

/** Permissions used by the two POC roles. */
const PERMISSIONS: [string, string][] = [
  ['PETITION_CREATE', 'Submit a petition'],
  ['PETITION_VIEW', 'View petitions'],
  ['DOCUMENT_UPLOAD', 'Upload documents'],
  ['DOCUMENT_VIEW', 'View documents'],
  ['DOCUMENT_DOWNLOAD', 'Download documents'],
  ['AI_ANALYZE', 'Run AI analysis and use the Copilot'],
  ['AI_RECOMMEND', 'Request AI recommendations'],
  ['AI_REVIEW', 'Verify AI recommendations'],
  ['KNOWLEDGE_MANAGE', 'Manage the AI Knowledge Configuration'],
  ['ADMIN_CONFIGURE', 'Configure the system'],
  ['AUDIT_VIEW', 'View the audit log'],
];

function seedUsers() {
  const insPerm = db.prepare('INSERT OR IGNORE INTO permission (code, description) VALUES (?, ?)');
  for (const [code, desc] of PERMISSIONS) insPerm.run(code, desc);

  // The citizen can submit and track their own petition, and nothing else.
  db.prepare(
    "INSERT OR IGNORE INTO role (code, name, description) VALUES " +
    "('CITIZEN', 'Citizen', 'Submits petitions and tracks their own case')",
  ).run();

  const citizenPerms = ['PETITION_CREATE', 'PETITION_VIEW', 'DOCUMENT_UPLOAD', 'DOCUMENT_VIEW'];

  const grievancePerms = [
    'PETITION_VIEW', 'DOCUMENT_VIEW', 'DOCUMENT_DOWNLOAD', 'DOCUMENT_UPLOAD',
    'AI_ANALYZE', 'AI_RECOMMEND', 'AI_REVIEW', 'KNOWLEDGE_MANAGE',
    'ADMIN_CONFIGURE', 'AUDIT_VIEW',
  ];

  db.prepare(
    "INSERT OR IGNORE INTO role (code, name, description) VALUES " +
    "('GRIEVANCE_OFFICER', 'Government Grievance Officer', " +
    "'Reviews citizen petitions with AI assistance and manages the AI knowledge base')",
  ).run();

  const link = db.prepare(
    'INSERT OR IGNORE INTO role_permission (role_id, permission_id) ' +
    'SELECT r.id, p.id FROM role r, permission p WHERE r.code = ? AND p.code = ?',
  );
  for (const perm of citizenPerms) link.run('CITIZEN', perm);
  for (const perm of grievancePerms) link.run('GRIEVANCE_OFFICER', perm);

  // The demo credentials endpoint serves only while this is on.
  db.prepare(
    "INSERT OR IGNORE INTO system_config (key, value, description) " +
    "VALUES ('DEMO_MODE', 'true', 'Demo credentials are listed on the sign-in screen')",
  ).run();

  const insUser = db.prepare(
    'INSERT OR IGNORE INTO app_user (username, full_name, password_hash, password_salt) VALUES (?, ?, ?, ?)',
  );
  // Keep the stored password in step with the seed, so re-running it repairs
  // an account whose password has drifted.
  const updPassword = db.prepare(
    'UPDATE app_user SET password_hash = ?, password_salt = ? WHERE username = ?',
  );
  const linkRole = db.prepare(
    'INSERT OR IGNORE INTO user_role (user_id, role_id) SELECT ?, id FROM role WHERE code = ?',
  );

  for (const [username, password, fullName, role] of [
    ['citizen1', 'Citizen@123', 'Lakshmi Ammal', 'CITIZEN'],
    ['gro', 'Officer@123', 'A. Kavitha, Grievance Officer', 'GRIEVANCE_OFFICER'],
  ] as const) {
    const { hash, salt } = hashPassword(password);
    insUser.run(username, fullName, hash, salt);
    updPassword.run(hash, salt, username);
    const u = db.prepare('SELECT id FROM app_user WHERE username = ?').get(username) as any;
    if (u) linkRole.run(u.id, role);
  }
}

/** Prompt templates for the POC AI tasks. */
const PROMPTS: [string, string, string, string, string][] = [
  ['Petition Analysis', 'PETITION_ANALYSIS', '1.0',
    'Analyse a citizen petition against the configured government knowledge base.',
    'Read the petition and any attached documents. Identify the applicable Act, ' +
    'department and authority ONLY from the configured knowledge base - never name one ' +
    'that is not configured. State plainly when nothing matches. Report confidence ' +
    'honestly. Every output is a recommendation requiring officer verification.'],
  ['Officer Copilot', 'COPILOT', '1.0',
    'Answer officer questions about a petition from the case record and configured knowledge.',
    'Answer only from this petition and the configured knowledge base. Never invent an Act, ' +
    'section, department or officer. If the answer is not available from those sources, say ' +
    'so and suggest consulting the appropriate authority.'],
  ['Document Extraction', 'DOCUMENT_EXTRACT', '1.0',
    'Extract text from an uploaded petition document.',
    'Extract the text as written. Report the recognition confidence. Do not interpret, ' +
    'correct or complete the content.'],
];

function seedPrompts() {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO prompt_template (name, task, version, purpose, system_instructions, active) ' +
    'VALUES (?, ?, ?, ?, ?, 1)',
  );
  for (const [name, task, version, purpose, instructions] of PROMPTS) {
    ins.run(name, task, version, purpose, instructions);
  }
}

function seedKnowledge() {
  const SOURCE_NOTE =
    'Starter reference entry. Name and subject area only - statutory text is NOT included and has ' +
    'NOT been verified. Confirm against the Gazette or official publication and record the source ' +
    'before relying on this entry.';

  tx(() => {
    /*
     * Remove the earlier SAMPLE placeholder entries.
     *
     * They were written before the real Tamil Nadu reference data existed and
     * would otherwise compete with it - a petition about pension matched the
     * placeholder rather than the real framework entry.
     */
    const sampleActs = db.prepare(
      "SELECT id FROM kb_act WHERE short_name LIKE 'SAMPLE %'",
    ).all().map((r: any) => r.id);

    if (sampleActs.length) {
      const list = sampleActs.join(',');
      // Past analyses point at these Acts. Clear the references rather than
      // deleting the analysis - the petition record and its history stay
      // intact, and only the stale legal reference is removed.
      db.exec(`UPDATE cp_analysis SET act_id = NULL, section_id = NULL WHERE act_id IN (${list})`);
      db.exec(`DELETE FROM kb_section WHERE act_id IN (${list})`);
      db.exec(`DELETE FROM kb_department_act WHERE act_id IN (${list})`);
      db.exec(`DELETE FROM kb_act WHERE id IN (${list})`);
      console.log(`  removed ${sampleActs.length} earlier SAMPLE placeholder Act(s)`);
    }

    // ---------------- departments ----------------
    const upsertDept = db.prepare(`
      INSERT INTO kb_department (code, name, description, responsibilities, keywords, active, verification_status)
      VALUES (?, ?, ?, ?, ?, 1, 'UNVERIFIED')
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        responsibilities = excluded.responsibilities,
        keywords = excluded.keywords,
        updated_at = datetime('now')
    `);
    for (const d of TN_DEPARTMENTS) {
      const keywords = TAMIL_DEPARTMENT_KEYWORDS[d.code]
        ? `${d.keywords}, ${TAMIL_DEPARTMENT_KEYWORDS[d.code]}`
        : d.keywords;
      upsertDept.run(d.code, d.name, d.responsibilities, d.responsibilities, keywords);
    }

    const deptId = (code: string) =>
      (db.prepare('SELECT id FROM kb_department WHERE code = ?').get(code) as any)?.id ?? null;

    // ---------------- acts ----------------
    const findAct = db.prepare('SELECT id FROM kb_act WHERE short_name = ?');
    const insAct = db.prepare(`
      INSERT INTO kb_act (short_name, full_title, act_type, year, jurisdiction,
        applies_when, keywords, source_reference, required_documents, recommended_action,
        priority, is_demo, active, verification_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'UNVERIFIED')
    `);
    const updAct = db.prepare(`
      UPDATE kb_act SET full_title = ?, act_type = ?, year = ?, jurisdiction = ?,
        applies_when = ?, keywords = ?, source_reference = ?, required_documents = ?,
        recommended_action = ?, priority = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    const linkActDept = db.prepare(
      'INSERT OR IGNORE INTO kb_department_act (department_id, act_id) VALUES (?, ?)',
    );

    /*
     * Append the Tamil cues to the configured English keywords.
     *
     * Without these, a Tamil petition fell back to weak signals and matched the
     * wrong Act - a Tamil encroachment petition reached the Forest Act while
     * the same text in English correctly reached the Land Encroachment Act.
     * Both languages now match against the same record.
     */
    const withTamil = (english: string, tamil?: string) =>
      tamil ? `${english}, ${tamil}` : english;

    for (const a of TN_ACTS) {
      const existing = findAct.get(a.short_name) as any;
      const keywords = withTamil(a.keywords, TAMIL_ACT_KEYWORDS[a.short_name]);
      let actId: number;
      if (existing) {
        updAct.run(a.full_title, a.act_type, a.year, a.jurisdiction, a.applies_when,
          keywords, SOURCE_NOTE, a.required_documents ?? null,
          a.recommended_action ?? null, a.priority ?? null, existing.id);
        actId = existing.id;
      } else {
        const r = insAct.run(a.short_name, a.full_title, a.act_type, a.year, a.jurisdiction,
          a.applies_when, keywords, SOURCE_NOTE, a.required_documents ?? null,
          a.recommended_action ?? null, a.priority ?? null);
        actId = Number(r.lastInsertRowid);
      }
      for (const code of a.departments) {
        const id = deptId(code);
        if (id) linkActDept.run(id, actId);
      }
    }

    // ---------------- authorities ----------------
    const findAuth = db.prepare(
      "SELECT id FROM kb_authority WHERE designation = ? AND IFNULL(office_name, '') = ?",
    );
    const insAuth = db.prepare(`
      INSERT INTO kb_authority (designation, department_id, office_name, jurisdiction_level,
        jurisdiction_area, responsibilities, keywords, active, verification_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'UNVERIFIED')
    `);
    const updAuth = db.prepare(`
      UPDATE kb_authority SET department_id = ?, jurisdiction_level = ?, jurisdiction_area = ?,
        responsibilities = ?, keywords = ?, updated_at = datetime('now') WHERE id = ?
    `);

    for (const a of TN_AUTHORITIES) {
      const existing = findAuth.get(a.designation, a.office_name) as any;
      if (existing) {
        updAuth.run(deptId(a.department), a.level, a.area, a.responsibilities, a.keywords, existing.id);
      } else {
        insAuth.run(a.designation, deptId(a.department), a.office_name,
          a.level, a.area, a.responsibilities, a.keywords);
      }
    }

    // ---------------- subjects ----------------
    const upsertSubj = db.prepare(`
      INSERT INTO kb_subject (code, name, description, keywords, default_department_id, default_priority, active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name, description = excluded.description,
        keywords = excluded.keywords,
        default_department_id = excluded.default_department_id,
        default_priority = excluded.default_priority
    `);
    for (const s of TN_SUBJECTS) {
      const keywords = TAMIL_SUBJECT_KEYWORDS[s.code]
        ? `${s.keywords}, ${TAMIL_SUBJECT_KEYWORDS[s.code]}`
        : s.keywords;
      upsertSubj.run(s.code, s.name, s.description, keywords, deptId(s.department), s.priority);
    }

    /*
     * Tamil display names.
     *
     * Applied last, by English name, so it works whether a record was just
     * inserted or already existed. A record with no Tamil entry keeps its
     * English name in both views - that is honest, whereas inventing a Tamil
     * title for a statute that has no settled one would not be.
     */
    const updActTa = db.prepare(
      'UPDATE kb_act SET short_name_ta = ?, full_title_ta = ?, applies_when_ta = ? WHERE short_name = ?',
    );
    let actTa = 0;
    for (const [english, ta] of Object.entries(ACT_NAMES_TA)) {
      const r = updActTa.run(ta.short, ta.full ?? null, ta.applies ?? null, english);
      if (r.changes) actTa++;
    }

    const updDeptTa = db.prepare(
      'UPDATE kb_department SET name_ta = ?, responsibilities_ta = ? WHERE code = ?',
    );
    let deptTa = 0;
    for (const [code, ta] of Object.entries(DEPARTMENT_NAMES_TA)) {
      const r = updDeptTa.run(ta.name, ta.responsibilities ?? null, code);
      if (r.changes) deptTa++;
    }

    const updAuthTa = db.prepare(
      'UPDATE kb_authority SET designation_ta = ?, office_name_ta = ? WHERE designation = ?',
    );
    let authTa = 0;
    for (const [english, ta] of Object.entries(AUTHORITY_NAMES_TA)) {
      const r = updAuthTa.run(ta.designation, ta.office ?? null, english);
      if (r.changes) authTa++;
    }

    const updSubjTa = db.prepare('UPDATE kb_subject SET name_ta = ? WHERE code = ?');
    let subjTa = 0;
    for (const [code, name] of Object.entries(SUBJECT_NAMES_TA)) {
      const r = updSubjTa.run(name, code);
      if (r.changes) subjTa++;
    }

    console.log(`  Tamil names: ${actTa} acts, ${deptTa} departments, ` +
      `${authTa} authorities, ${subjTa} subjects`);
  });
}

function main() {
  migrate();
  seedUsers();
  seedPrompts();
  seedKnowledge();

  const n = (t: string, where = '') =>
    (db.prepare(`SELECT COUNT(*) n FROM ${t} ${where}`).get() as any).n;

  console.log('');
  console.log('Tamil Nadu AI Knowledge Configuration loaded');
  console.log('============================================');
  console.log(`  Acts / Laws / Frameworks : ${n('kb_act')}  (${n('kb_act', 'WHERE active = 1')} active)`);
  console.log(`  Departments              : ${n('kb_department')}  (${n('kb_department', 'WHERE active = 1')} active)`);
  console.log(`  Officers / Authorities   : ${n('kb_authority')}  (${n('kb_authority', 'WHERE active = 1')} active)`);
  console.log(`  Petition Subjects        : ${n('kb_subject')}`);
  console.log(`  Act - Department links   : ${n('kb_department_act')}`);
  console.log('');
  console.log(`  Verification status      : ${n('kb_act', "WHERE verification_status = 'UNVERIFIED'")} Acts UNVERIFIED`);
  console.log('');
  console.log('  These entries carry the NAME and subject area of real Acts.');
  console.log('  They do NOT contain verified statutory text. Confirm each entry');
  console.log('  against the Gazette and record the source before relying on it.');
  console.log('');
  console.log('Logins');
  console.log('  citizen1 / Citizen@123   Citizen');
  console.log('  gro      / Officer@123   Government Grievance Officer');
  console.log('');
  console.log('Open  http://localhost:5173/poc');
  console.log('');
}

main();
