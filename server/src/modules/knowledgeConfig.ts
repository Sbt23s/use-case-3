import { Router } from 'express';
import { z } from 'zod';
import { db } from '../core/db.js';
import { audit } from '../core/audit.js';
import { authenticate, requirePermission } from '../core/auth.js';
import { verifyAct, verifyActs } from '../core/actVerify.js';
import { publish } from '../core/realtime.js';

/**
 * AI Knowledge Configuration.
 *
 * Acts, Sections, Departments, Authorities and Subjects are managed here and
 * nowhere else. Nothing in the application hard-codes a legal reference or a
 * government office: the analyzer and the copilot can only name rows that were
 * entered through these endpoints.
 *
 * Adding a new Act or Department therefore needs no code change and no
 * redeployment.
 */
export const kbRouter = Router();
kbRouter.use(authenticate);

const MANAGE = 'KNOWLEDGE_MANAGE';

/** Deactivating is preferred to deleting, but both are supported. */
function softOrHardDelete(table: string, id: number, hard: boolean): boolean {
  if (hard) {
    const r = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return r.changes > 0;
  }
  const r = db.prepare(`UPDATE ${table} SET active = 0 WHERE id = ?`).run(id);
  return r.changes > 0;
}

function search(table: string, q: string | undefined, fields: string[], extra = '') {
  if (!q) {
    return db.prepare(`SELECT * FROM ${table} ${extra} ORDER BY id DESC`).all();
  }
  const where = fields.map((f) => `IFNULL(${f}, '') LIKE ?`).join(' OR ');
  const params = fields.map(() => `%${q}%`);
  const glue = extra ? `${extra} AND (${where})` : `WHERE ${where}`;
  return db.prepare(`SELECT * FROM ${table} ${glue} ORDER BY id DESC`).all(...params);
}

// ============================================================ ACTS
const ActSchema = z.object({
  short_name: z.string().min(1),
  full_title: z.string().min(1),
  act_type: z.enum(['ACT', 'RULE', 'GO', 'CIRCULAR', 'POLICY']).default('ACT'),
  act_number: z.string().optional(),
  year: z.number().int().optional(),
  jurisdiction: z.string().optional(),
  summary: z.string().optional(),
  applies_when: z.string().optional(),
  keywords: z.string().optional(),
  source_reference: z.string().optional(),
  is_demo: z.boolean().default(true),
  active: z.boolean().default(true),
});

kbRouter.get('/acts', (req, res) => {
  const q = (req.query as any).q as string | undefined;
  const rows = search('kb_act', q,
    ['short_name', 'full_title', 'act_number', 'keywords', 'summary', 'applies_when']) as any[];
  for (const r of rows) {
    r.section_count = (db.prepare(
      'SELECT COUNT(*) n FROM kb_section WHERE act_id = ?',
    ).get(r.id) as any).n;
    r.departments = db.prepare(
      'SELECT d.id, d.name FROM kb_department d JOIN kb_department_act da ON da.department_id = d.id WHERE da.act_id = ?',
    ).all(r.id);
  }
  res.json(rows);
});

kbRouter.post('/acts', requirePermission(MANAGE), (req, res) => {
  const parsed = ActSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const r = db.prepare(`
    INSERT INTO kb_act (short_name, full_title, act_type, act_number, year, jurisdiction,
      summary, applies_when, keywords, source_reference, is_demo, active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d.short_name, d.full_title, d.act_type, d.act_number ?? null, d.year ?? null,
    d.jurisdiction ?? null, d.summary ?? null, d.applies_when ?? null, d.keywords ?? null,
    d.source_reference ?? null, d.is_demo ? 1 : 0, d.active ? 1 : 0, req.user!.id);

  audit(req, req.user!, {
    action: 'KB_ACT_CREATED', entityType: 'kb_act', entityId: Number(r.lastInsertRowid),
    newValue: { short_name: d.short_name },
  });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

kbRouter.patch('/acts/:id', requirePermission(MANAGE), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM kb_act WHERE id = ?').get(id) as any;
  if (!existing) { res.status(404).json({ error: 'Act not found' }); return; }

  const parsed = ActSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues }); return; }
  const d = parsed.data;

  const sets: string[] = []; const params: unknown[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  if (!sets.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  sets.push("updated_at = datetime('now')");

  db.prepare(`UPDATE kb_act SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  audit(req, req.user!, {
    action: 'KB_ACT_UPDATED', entityType: 'kb_act', entityId: id,
    oldValue: { short_name: existing.short_name, active: existing.active }, newValue: d,
  });
  res.json({ ok: true });
});

kbRouter.delete('/acts/:id', requirePermission(MANAGE), (req, res) => {
  const id = Number(req.params.id);
  const hard = (req.query as any).hard === 'true';
  const existing = db.prepare('SELECT * FROM kb_act WHERE id = ?').get(id) as any;
  if (!existing) { res.status(404).json({ error: 'Act not found' }); return; }
  if (!softOrHardDelete('kb_act', id, hard)) { res.status(404).json({ error: 'Act not found' }); return; }

  audit(req, req.user!, {
    action: hard ? 'KB_ACT_DELETED' : 'KB_ACT_DEACTIVATED', entityType: 'kb_act', entityId: id,
    oldValue: { short_name: existing.short_name },
  });
  res.json({ ok: true, hard });
});

// ---- Verification against official sources ----
/*
 * Check an Act against live official government sources and record where it
 * was found. An entry that cannot be matched stays UNVERIFIED and says why -
 * the officer is never shown a citation the system could not substantiate.
 */
kbRouter.post('/acts/:id/verify', requirePermission(MANAGE), async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT short_name FROM kb_act WHERE id = ?').get(id) as any;
  if (!existing) { res.status(404).json({ error: 'Act not found' }); return; }

  try {
    const outcome = await verifyAct(id);
    audit(req, req.user!, {
      action: 'KB_ACT_VERIFY_ATTEMPTED', entityType: 'kb_act', entityId: id,
      newValue: { short_name: existing.short_name, status: outcome.status },
    });
    res.json(outcome);
  } catch (e) {
    res.status(503).json({
      error: 'Verification could not be carried out.',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

/*
 * Verify every active Act that has no recorded source yet.
 *
 * This runs against a rate-limited scraper by default, so it is sequential and
 * capped. The response returns immediately and progress is published on the
 * realtime stream; the officer is not left watching a blocked request.
 */
kbRouter.post('/acts/verify-all', requirePermission(MANAGE), (req, res) => {
  const limit = Math.min(Number((req.query as any).limit) || 25, 99);
  const rows = db.prepare(`
    SELECT id FROM kb_act
     WHERE active = 1
       AND (source_url IS NULL OR source_url = '')
     ORDER BY id LIMIT ?
  `).all(limit) as any[];

  const ids = rows.map((r) => r.id);
  if (!ids.length) {
    res.json({ started: false, note: 'Every active Act already has a recorded source.' });
    return;
  }

  audit(req, req.user!, {
    action: 'KB_ACT_VERIFY_BATCH_STARTED', entityType: 'kb_act', entityId: 0,
    newValue: { count: ids.length },
  });

  // Deliberately not awaited: the officer gets an immediate response and
  // watches progress on the stream.
  void verifyActs(ids, (done, total, id, outcome) => {
    publish('kb:verify-progress', { done, total, actId: id, status: outcome.status });
  }).then((summary) => {
    publish('kb:verify-done', summary);
  }).catch((e) => {
    publish('kb:verify-done', {
      error: e instanceof Error ? e.message : String(e),
    });
  });

  res.json({ started: true, count: ids.length });
});

// ---- Act ↔ Department administration link ----
kbRouter.post('/acts/:id/departments', requirePermission(MANAGE), (req, res) => {
  const actId = Number(req.params.id);
  const S = z.object({ department_ids: z.array(z.number().int().positive()) });
  const parsed = S.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'department_ids is required' }); return; }

  db.prepare('DELETE FROM kb_department_act WHERE act_id = ?').run(actId);
  const ins = db.prepare('INSERT OR IGNORE INTO kb_department_act (department_id, act_id) VALUES (?, ?)');
  for (const dId of parsed.data.department_ids) ins.run(dId, actId);

  audit(req, req.user!, {
    action: 'KB_ACT_DEPARTMENTS_SET', entityType: 'kb_act', entityId: actId,
    newValue: parsed.data,
  });
  res.json({ ok: true, linked: parsed.data.department_ids.length });
});

// ============================================================ SECTIONS
const SectionSchema = z.object({
  act_id: z.number().int().positive(),
  section_no: z.string().min(1),
  heading: z.string().optional(),
  text: z.string().min(1),
  applies_when: z.string().optional(),
  keywords: z.string().optional(),
  active: z.boolean().default(true),
});

kbRouter.get('/sections', (req, res) => {
  const actId = (req.query as any).act_id;
  const q = (req.query as any).q as string | undefined;
  if (actId) {
    res.json(db.prepare('SELECT * FROM kb_section WHERE act_id = ? ORDER BY id').all(Number(actId)));
    return;
  }
  res.json(search('kb_section', q, ['section_no', 'heading', 'text', 'keywords']));
});

kbRouter.post('/sections', requirePermission(MANAGE), (req, res) => {
  const parsed = SectionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const act = db.prepare('SELECT id FROM kb_act WHERE id = ?').get(d.act_id);
  if (!act) { res.status(400).json({ error: 'The specified Act does not exist' }); return; }

  const r = db.prepare(`
    INSERT INTO kb_section (act_id, section_no, heading, text, applies_when, keywords, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(d.act_id, d.section_no, d.heading ?? null, d.text,
    d.applies_when ?? null, d.keywords ?? null, d.active ? 1 : 0);

  audit(req, req.user!, {
    action: 'KB_SECTION_CREATED', entityType: 'kb_section', entityId: Number(r.lastInsertRowid),
    newValue: { act_id: d.act_id, section_no: d.section_no },
  });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

kbRouter.patch('/sections/:id', requirePermission(MANAGE), (req, res) => {
  const id = Number(req.params.id);
  const parsed = SectionSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed' }); return; }
  const sets: string[] = []; const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`); params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  if (!sets.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  const r = db.prepare(`UPDATE kb_section SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  if (!r.changes) { res.status(404).json({ error: 'Section not found' }); return; }
  audit(req, req.user!, { action: 'KB_SECTION_UPDATED', entityType: 'kb_section', entityId: id });
  res.json({ ok: true });
});

kbRouter.delete('/sections/:id', requirePermission(MANAGE), (req, res) => {
  const id = Number(req.params.id);
  const hard = (req.query as any).hard === 'true';
  if (!softOrHardDelete('kb_section', id, hard)) { res.status(404).json({ error: 'Section not found' }); return; }
  audit(req, req.user!, {
    action: hard ? 'KB_SECTION_DELETED' : 'KB_SECTION_DEACTIVATED',
    entityType: 'kb_section', entityId: id,
  });
  res.json({ ok: true, hard });
});

// ============================================================ DEPARTMENTS
const DeptSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  responsibilities: z.string().optional(),
  keywords: z.string().optional(),
  parent_id: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
});

kbRouter.get('/departments', (req, res) => {
  const q = (req.query as any).q as string | undefined;
  const rows = search('kb_department', q, ['code', 'name', 'description', 'responsibilities', 'keywords']) as any[];
  for (const r of rows) {
    r.authority_count = (db.prepare(
      'SELECT COUNT(*) n FROM kb_authority WHERE department_id = ?',
    ).get(r.id) as any).n;
    r.acts = db.prepare(
      'SELECT a.id, a.short_name FROM kb_act a JOIN kb_department_act da ON da.act_id = a.id WHERE da.department_id = ?',
    ).all(r.id);
  }
  res.json(rows);
});

kbRouter.post('/departments', requirePermission(MANAGE), (req, res) => {
  const parsed = DeptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const dup = db.prepare('SELECT id FROM kb_department WHERE code = ?').get(d.code);
  if (dup) { res.status(409).json({ error: `A department with code "${d.code}" already exists` }); return; }

  const r = db.prepare(`
    INSERT INTO kb_department (code, name, description, responsibilities, keywords, parent_id, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(d.code, d.name, d.description ?? null, d.responsibilities ?? null,
    d.keywords ?? null, d.parent_id ?? null, d.active ? 1 : 0);

  audit(req, req.user!, {
    action: 'KB_DEPARTMENT_CREATED', entityType: 'kb_department',
    entityId: Number(r.lastInsertRowid), newValue: { code: d.code, name: d.name },
  });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

kbRouter.patch('/departments/:id', requirePermission(MANAGE), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM kb_department WHERE id = ?').get(id) as any;
  if (!existing) { res.status(404).json({ error: 'Department not found' }); return; }

  const parsed = DeptSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed' }); return; }

  const sets: string[] = []; const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`); params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  if (!sets.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  sets.push("updated_at = datetime('now')");

  db.prepare(`UPDATE kb_department SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  audit(req, req.user!, {
    action: 'KB_DEPARTMENT_UPDATED', entityType: 'kb_department', entityId: id,
    oldValue: { name: existing.name, active: existing.active }, newValue: parsed.data,
  });
  res.json({ ok: true });
});

kbRouter.delete('/departments/:id', requirePermission(MANAGE), (req, res) => {
  const id = Number(req.params.id);
  const hard = (req.query as any).hard === 'true';
  const existing = db.prepare('SELECT * FROM kb_department WHERE id = ?').get(id) as any;
  if (!existing) { res.status(404).json({ error: 'Department not found' }); return; }
  softOrHardDelete('kb_department', id, hard);
  audit(req, req.user!, {
    action: hard ? 'KB_DEPARTMENT_DELETED' : 'KB_DEPARTMENT_DEACTIVATED',
    entityType: 'kb_department', entityId: id, oldValue: { name: existing.name },
  });
  res.json({ ok: true, hard });
});

// ============================================================ AUTHORITIES
const AuthSchema = z.object({
  designation: z.string().min(1),
  department_id: z.number().int().positive().nullable().optional(),
  office_name: z.string().optional(),
  jurisdiction_level: z.enum(['STATE', 'DISTRICT', 'TALUK', 'VILLAGE']).optional(),
  jurisdiction_area: z.string().optional(),
  responsibilities: z.string().optional(),
  contact_reference: z.string().optional(),
  keywords: z.string().optional(),
  active: z.boolean().default(true),
});

kbRouter.get('/authorities', (req, res) => {
  const q = (req.query as any).q as string | undefined;
  const deptId = (req.query as any).department_id;
  const extra = deptId ? `WHERE department_id = ${Number(deptId)}` : '';
  const rows = search('kb_authority', q,
    ['designation', 'office_name', 'responsibilities', 'keywords', 'jurisdiction_area'], extra) as any[];
  for (const r of rows) {
    r.department_name = r.department_id
      ? (db.prepare('SELECT name FROM kb_department WHERE id = ?').get(r.department_id) as any)?.name ?? null
      : null;
  }
  res.json(rows);
});

kbRouter.post('/authorities', requirePermission(MANAGE), (req, res) => {
  const parsed = AuthSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const r = db.prepare(`
    INSERT INTO kb_authority (designation, department_id, office_name, jurisdiction_level,
      jurisdiction_area, responsibilities, contact_reference, keywords, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d.designation, d.department_id ?? null, d.office_name ?? null,
    d.jurisdiction_level ?? null, d.jurisdiction_area ?? null, d.responsibilities ?? null,
    d.contact_reference ?? null, d.keywords ?? null, d.active ? 1 : 0);

  audit(req, req.user!, {
    action: 'KB_AUTHORITY_CREATED', entityType: 'kb_authority',
    entityId: Number(r.lastInsertRowid), newValue: { designation: d.designation },
  });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

kbRouter.patch('/authorities/:id', requirePermission(MANAGE), (req, res) => {
  const id = Number(req.params.id);
  const parsed = AuthSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed' }); return; }
  const sets: string[] = []; const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`); params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  if (!sets.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  sets.push("updated_at = datetime('now')");
  const r = db.prepare(`UPDATE kb_authority SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  if (!r.changes) { res.status(404).json({ error: 'Authority not found' }); return; }
  audit(req, req.user!, { action: 'KB_AUTHORITY_UPDATED', entityType: 'kb_authority', entityId: id });
  res.json({ ok: true });
});

kbRouter.delete('/authorities/:id', requirePermission(MANAGE), (req, res) => {
  const id = Number(req.params.id);
  const hard = (req.query as any).hard === 'true';
  if (!softOrHardDelete('kb_authority', id, hard)) { res.status(404).json({ error: 'Authority not found' }); return; }
  audit(req, req.user!, {
    action: hard ? 'KB_AUTHORITY_DELETED' : 'KB_AUTHORITY_DEACTIVATED',
    entityType: 'kb_authority', entityId: id,
  });
  res.json({ ok: true, hard });
});

// ============================================================ SUBJECTS
const SubjectSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  keywords: z.string().optional(),
  default_department_id: z.number().int().positive().nullable().optional(),
  default_priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  active: z.boolean().default(true),
});

kbRouter.get('/subjects', (req, res) => {
  const q = (req.query as any).q as string | undefined;
  const rows = search('kb_subject', q, ['code', 'name', 'description', 'keywords']) as any[];
  for (const r of rows) {
    r.department_name = r.default_department_id
      ? (db.prepare('SELECT name FROM kb_department WHERE id = ?').get(r.default_department_id) as any)?.name ?? null
      : null;
  }
  res.json(rows);
});

kbRouter.post('/subjects', requirePermission(MANAGE), (req, res) => {
  const parsed = SubjectSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const dup = db.prepare('SELECT id FROM kb_subject WHERE code = ?').get(d.code);
  if (dup) { res.status(409).json({ error: `A subject with code "${d.code}" already exists` }); return; }

  const r = db.prepare(`
    INSERT INTO kb_subject (code, name, description, keywords, default_department_id, default_priority, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(d.code, d.name, d.description ?? null, d.keywords ?? null,
    d.default_department_id ?? null, d.default_priority, d.active ? 1 : 0);

  audit(req, req.user!, {
    action: 'KB_SUBJECT_CREATED', entityType: 'kb_subject',
    entityId: Number(r.lastInsertRowid), newValue: { code: d.code },
  });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

kbRouter.patch('/subjects/:id', requirePermission(MANAGE), (req, res) => {
  const id = Number(req.params.id);
  const parsed = SubjectSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed' }); return; }
  const sets: string[] = []; const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`); params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  if (!sets.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  const r = db.prepare(`UPDATE kb_subject SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  if (!r.changes) { res.status(404).json({ error: 'Subject not found' }); return; }
  audit(req, req.user!, { action: 'KB_SUBJECT_UPDATED', entityType: 'kb_subject', entityId: id });
  res.json({ ok: true });
});

kbRouter.delete('/subjects/:id', requirePermission(MANAGE), (req, res) => {
  const id = Number(req.params.id);
  const hard = (req.query as any).hard === 'true';
  if (!softOrHardDelete('kb_subject', id, hard)) { res.status(404).json({ error: 'Subject not found' }); return; }
  audit(req, req.user!, {
    action: hard ? 'KB_SUBJECT_DELETED' : 'KB_SUBJECT_DEACTIVATED',
    entityType: 'kb_subject', entityId: id,
  });
  res.json({ ok: true, hard });
});

// ============================================================ OVERVIEW
kbRouter.get('/stats', (_req, res) => {
  const count = (t: string, activeOnly = false) =>
    (db.prepare(`SELECT COUNT(*) n FROM ${t}${activeOnly ? ' WHERE active = 1' : ''}`).get() as any).n;

  res.json({
    acts: { total: count('kb_act'), active: count('kb_act', true) },
    sections: { total: count('kb_section'), active: count('kb_section', true) },
    departments: { total: count('kb_department'), active: count('kb_department', true) },
    authorities: { total: count('kb_authority'), active: count('kb_authority', true) },
    subjects: { total: count('kb_subject'), active: count('kb_subject', true) },
    note:
      'The AI uses only ACTIVE entries. Deactivating an entry removes it from analysis ' +
      'immediately, without a code change or redeployment.',
  });
});
