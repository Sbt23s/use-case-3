import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, tx } from '../core/db.js';
import { audit } from '../core/audit.js';
import { authenticate, requirePermission, loadUser, verifyStreamToken } from '../core/auth.js';
import { planExtraction, extractInline, extractDeferred, availableLanguages, availableEngines } from '../core/ocr.js';
import {
  runTask, providerStatus, listProviders, selectProvider, testProvider,
} from '../ai/gateway.js';
import type { ProviderId } from '../ai/liveProvider.js';
import { extractPetitionerDetails } from '../core/petitionerExtract.js';
import { searchStatus } from '../core/search.js';
import { renderManyInLanguage } from '../core/kbTranslate.js';
import { translateText, detectLang as detectTextLang } from '../core/translate.js';
import { displayName as translitDisplayName, displayAddress as translitDisplayAddress } from '../core/translit.js';
import { translateApiStatus } from '../core/translateApi.js';
import {
  WORKFLOW_STAGES, currentStage, isStage, stageIndex,
} from '../core/workflowStages.js';
import { runAnalysis } from '../ai/agents/analyzer.js';
import { runCopilot } from '../ai/agents/copilot.js';
import { runGlobalCopilot } from '../ai/agents/eGovCopilot.js';
import { publish, subscribe } from '../core/realtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Register custom SQLite function for instantaneous bilingual transliterated searching
try {
  db.function('translit_en', (str: string) => {
    if (!str) return '';
    return translitDisplayName(str, 'en');
  });
} catch {
  // function already registered
}
const UPLOAD_DIR = resolve(__dirname, '../../data/uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

export const cpRouter = Router();

// ---------------------------------------------------------------- uploads
const ALLOWED = new Set([
  'application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      cb(new Error(`File type ${file.mimetype} is not permitted`));
      return;
    }
    cb(null, true);
  },
});

/** Reject a file whose content contradicts its declared type. */
function verifyMagic(buf: Buffer, mime: string): boolean {
  if (mime === 'application/pdf') return buf.subarray(0, 5).toString() === '%PDF-';
  if (mime === 'image/png') return buf.subarray(1, 4).toString() === 'PNG';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return buf[0] === 0xff && buf[1] === 0xd8;
  return true;
}

/**
 * Does this look like a filename rather than a description of the contents?
 *
 * "AP-2026-6850AB.pdf" tells an officer nothing and must not be fed to the
 * analyser as though it were the subject of the grievance.
 */
function looksLikeFilename(s: string): boolean {
  return /\.(pdf|docx?|jpe?g|png|txt)$/i.test(String(s || '').trim());
}

/**
 * Is the recorded subject a stand-in rather than a real one?
 *
 * A Copilot upload has no subject to enter, so the row is created with the
 * filename or a generic marker. Either may be replaced by the subject line the
 * document itself states. Anything an officer typed is left alone.
 */
const PLACEHOLDER_SUBJECTS = new Set([
  'uploaded document', 'document', 'petition', 'untitled', '-', '--',
]);

function isPlaceholderSubject(s: unknown): boolean {
  const v = String(s ?? '').trim();
  if (!v) return true;
  return looksLikeFilename(v) || PLACEHOLDER_SUBJECTS.has(v.toLowerCase());
}

/**
 * Store an extraction result against a document, and read the petitioner's
 * particulars out of the text while we are there.
 *
 * One helper for every OCR completion path (citizen upload, officer upload,
 * Copilot) so the three cannot drift: whatever the route, a document that has
 * been read also has its name / phone / address / date extracted.
 *
 * The extraction is best-effort and never fatal - a document whose particulars
 * cannot be found is still fully analysed, and the fields simply come back
 * empty rather than guessed.
 */
/**
 * Placeholder values the intake forms use when the officer has not typed a
 * real name. These stand in for "not known yet", so a name read out of the
 * document may replace them.
 */
const PLACEHOLDER_NAMES = new Set([
  'citizen', 'unknown', 'n/a', 'na', '-', '--', 'petitioner',
  'uploaded document', 'document', 'test petitioner',
]);

const COMMON_NAME_MAP_TA: Record<string, string> = {
  'test petitioner': 'தேர்வு மனுதாரர்',
  'test': 'தேர்வு',
  'petitioner': 'மனுதாரர்',
  'citizen': 'குடிமகன்',
  'applicant': 'விண்ணப்பதாரர்',
  'unknown': 'தெரியாதவர்',
};

function isPlaceholderName(s: unknown): boolean {
  const v = String(s ?? '').trim().toLowerCase();
  return !v || PLACEHOLDER_NAMES.has(v);
}

function saveExtraction(docId: number, out: {
  status: string; text: string | null; engine: string;
  confidence?: number; note?: string; scripts?: string[];
}): void {
  let parsed: ReturnType<typeof extractPetitionerDetails> | null = null;
  let details: string | null = null;
  if (out.status === 'COMPLETED' && out.text) {
    try {
      parsed = extractPetitionerDetails(out.text);
      details = JSON.stringify(parsed);
    } catch {
      // A malformed document must not fail the upload.
      parsed = null;
      details = null;
    }
  }

  db.prepare(`
    UPDATE cp_document SET ocr_status = ?, extracted_text = ?, ocr_engine = ?,
      ocr_confidence = ?, ocr_note = ?, ocr_scripts = ?, extracted_details = ?
    WHERE id = ?
  `).run(
    out.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
    out.text, out.engine, out.confidence ?? null, out.note ?? null,
    out.scripts?.length ? out.scripts.join(', ') : null,
    details, docId,
  );

  /*
   * Adopt the particulars read from the document into the petition record -
   * but ONLY where the officer left a placeholder.
   *
   * An officer uploading a scan has no name to type yet, so the intake form
   * sends "Citizen". That placeholder then sat in the record and hid the real
   * name the backend had extracted, which is what an officer saw on screen.
   *
   * A value a person actually entered is never overwritten: a machine reading
   * of handwriting must not silently replace a human's entry. The extracted
   * value also remains on the document with its evidence, so the officer can
   * always see where the name came from and correct it.
   */
  // The deferred path (PDF, image, Word) comes through here, so the
  // document's language is recorded here as well as on the inline path.
  recordDocumentLanguage(docId, out.text);

  if (!parsed) return;
  adoptPetitionerDetails(docId, parsed, out.text);
}

/**
 * Read the petitioner's particulars from a document and adopt them.
 *
 * Split out of `saveExtraction` because the two extraction paths differ in
 * where the TEXT comes from, not in what should happen to it afterwards.
 * Deferred extraction (OCR, PDF rasterisation) writes its text later and calls
 * `saveExtraction`; inline extraction (a plain-text or already-digital file) has
 * the text at insert time and writes the OCR columns itself.
 *
 * The inline path therefore never ran this half, so a readable document yielded
 * no name, phone, address or date - the very fields the backend is required to
 * extract. It now runs for both.
 */
/**
 * Record which language the document is actually in.
 *
 * A Copilot upload is created with language 'auto' because nothing is known
 * before the file is read, and nothing set it afterwards - so a Tamil petition
 * sat in the database as 'auto' and the console rendered its analysis as
 * though the document were English.
 *
 * Decided by script census on the extracted text, which is the only evidence
 * available. Called from BOTH extraction paths: inline (plain text) and
 * deferred (PDF, image, Word), because a PDF took the deferred path and so
 * never reached the inline-only version of this check.
 */
function recordDocumentLanguage(docId: number, text: string | null): void {
  if (!text) return;
  try {
    const ta = (text.match(/[஀-௿]/g) || []).length;
    const en = (text.match(/[A-Za-z]/g) || []).length;
    if (ta + en <= 20) return;
    const lang = ta > en ? 'ta' : 'en';
    const doc = db.prepare('SELECT petition_id FROM cp_document WHERE id = ?').get(docId) as any;
    if (!doc) return;
    db.prepare(
      "UPDATE cp_petition SET language = ? WHERE id = ? AND (language IS NULL OR language = 'auto')",
    ).run(lang, doc.petition_id);
  } catch { /* language is a convenience; never fail the upload for it */ }
}

function extractAndAdopt(docId: number, text: string | null): void {
  if (!text) return;
  recordDocumentLanguage(docId, text);


  let parsed: ReturnType<typeof extractPetitionerDetails> | null = null;
  try {
    parsed = extractPetitionerDetails(text);
  } catch {
    return;  // A malformed document must not fail the upload.
  }
  if (!parsed) return;

  // Keep the evidence with the document, so an officer can see where each
  // value came from and correct it.
  try {
    db.prepare('UPDATE cp_document SET extracted_details = ? WHERE id = ?')
      .run(JSON.stringify(parsed), docId);
  } catch { /* the details are a convenience; never fail the upload for them */ }

  adoptPetitionerDetails(docId, parsed, text);
}

/** Copy extracted particulars onto the petition, where the officer left blanks. */
function adoptPetitionerDetails(
  docId: number,
  parsed: NonNullable<ReturnType<typeof extractPetitionerDetails>>,
  /** The document's text, used only as a last resort for the subject. */
  docText?: string | null,
): void {
  const doc = db.prepare('SELECT petition_id FROM cp_document WHERE id = ?').get(docId) as any;
  if (!doc) return;
  const pet = db.prepare(
    'SELECT citizen_name, citizen_phone, citizen_address, subject FROM cp_petition WHERE id = ?',
  ).get(doc.petition_id) as any;
  if (!pet) return;

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (parsed.name?.value && isPlaceholderName(pet.citizen_name)) {
    sets.push('citizen_name = ?');
    vals.push(parsed.name.value);
  }
  if (parsed.phone?.value && !String(pet.citizen_phone ?? '').trim()) {
    sets.push('citizen_phone = ?');
    vals.push(parsed.phone.value);
  }
  if (parsed.address?.value && !String(pet.citizen_address ?? '').trim()) {
    sets.push('citizen_address = ?');
    vals.push(parsed.address.value);
  }

  /*
   * The petition's own subject line, where the record has only a filename.
   *
   * A Copilot upload has no subject to enter, so the row was created with the
   * document's name ("AP-2026-6D6AC6.pdf"). That told an officer nothing, and
   * it gave the ANALYSER nothing to classify - the Act and department were
   * being inferred from body text alone while the petition's own statement of
   * what it was about sat unread in the document.
   *
   * A subject an officer actually typed is never overwritten.
   */
  if (parsed.subject?.value && isPlaceholderSubject(pet.subject)) {
    sets.push('subject = ?');
    vals.push(parsed.subject.value);
  } else if (isPlaceholderSubject(pet.subject) && docText) {
    /*
     * No labelled subject line, so use the document's first real line.
     *
     * Not every document is a formal letter with "பொருள்:" on it - a
     * photographed complaint often opens straight with the grievance. Those
     * petitions kept the label "Uploaded document" as their subject, which
     * tells an officer scanning the list nothing at all.
     *
     * The letter's addressing lines are skipped, because "From," or "To,"
     * is no better than the label it replaces.
     */
    const SCAFFOLD =
      /^(?:from|to|sir|madam|respected|அனுப்புநர்|ப[பெொ]*றுநர்|மதிப்பிற்குரிய|ஐயா|அய்யா)\s*[,:：.]?\s*$/i;
    const first = String(docText)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^---\s*Page\s+\d+\s*---$/i.test(l))
      .find((l) => l.length > 8 && !SCAFFOLD.test(l));
    if (first) {
      sets.push('subject = ?');
      vals.push(first.slice(0, 220));
    }
  }

  if (!sets.length) return;

  db.prepare(
    `UPDATE cp_petition SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
  ).run(...vals, doc.petition_id);

  // The dashboard row shows the citizen name and subject, so it must refresh.
  publish('petition:update', {
    id: doc.petition_id,
    citizen_name: parsed.name?.value,
    subject: parsed.subject?.value,
  });
}

function nextReference(): string {
  const year = new Date().getFullYear();
  const row = db.prepare(
    "SELECT reference_no FROM cp_petition WHERE reference_no LIKE ? ORDER BY id DESC LIMIT 1",
  ).get(`CP-${year}-%`) as any;
  const last = row ? Number(String(row.reference_no).split('-').pop()) : 0;
  return `CP-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

// =================================================== REAL-TIME STREAM
/**
 * Server-sent events.
 *
 * The officer dashboard must reflect a new petition the moment it is submitted.
 * SSE is the right fit: one-directional, survives proxies, and reconnects by
 * itself - no polling and no socket infrastructure for a POC.
 *
 * The token arrives as a query parameter because EventSource cannot set
 * headers. It is still verified exactly as any other request.
 */
cpRouter.get('/stream', (req, res) => {
  const token = (req.query as any).token as string | undefined;
  if (!token) { res.status(401).json({ error: 'Authentication required' }); return; }

  const userId = verifyStreamToken(token);
  if (userId === null) { res.status(401).json({ error: 'Invalid or expired token' }); return; }
  const user = loadUser(userId);
  if (!user) { res.status(401).json({ error: 'User not found' }); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const unsubscribe = subscribe(user, (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  });

  // Proxies drop idle connections; a periodic comment keeps it alive.
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => { clearInterval(keepAlive); unsubscribe(); });
});

// Everything below requires a normal authenticated session.
cpRouter.use(authenticate);

// =================================================== CITIZEN: SUBMIT
const SubmitSchema = z.object({
  citizen_name: z.string().min(1),
  citizen_phone: z.string().optional(),
  citizen_address: z.string().optional(),
  subject: z.string().min(3),
  description: z.string().min(3),
  language: z.string().default('en'),
});

cpRouter.post('/petitions', requirePermission('PETITION_CREATE'), (req, res) => {
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  const user = req.user!;

  const result = tx(() => {
    const reference = nextReference();
    const r = db.prepare(`
      INSERT INTO cp_petition (reference_no, citizen_user_id, citizen_name, citizen_phone,
        citizen_address, subject, description, language, status, analysis_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', 'PENDING')
    `).run(reference, user.id, d.citizen_name, d.citizen_phone ?? null,
      d.citizen_address ?? null, d.subject, d.description, d.language);
    return { id: Number(r.lastInsertRowid), reference };
  });

  audit(req, user, {
    action: 'CP_PETITION_SUBMITTED', entityType: 'cp_petition', entityId: result.id,
    newValue: { reference: result.reference, subject: d.subject },
  });

  // The officer dashboard updates immediately - this is the real-time path.
  publish('petition:new', {
    id: result.id, reference_no: result.reference,
    citizen_name: d.citizen_name, subject: d.subject,
    status: 'SUBMITTED', analysis_status: 'PENDING',
    created_at: new Date().toISOString(),
  });

  res.status(201).json({ petitionId: result.id, referenceNo: result.reference });
});

// =================================================== OFFICER: UPLOAD PETITION
/**
 * Officer-driven petition intake.
 *
 * An officer receives a physical letter or fax, digitises it, and uploads it
 * here. The system:
 *   1. Creates the petition record immediately (citizen details filled by the
 *      officer on behalf of the citizen).
 *   2. Stores and OCR-processes any attached document.
 *   3. Automatically runs AI analysis once OCR completes.
 *
 * This replaces the Citizen role for submission purposes. The petition appears
 * in the incoming table instantly (via SSE), then transitions through
 * SUBMITTED → ANALYSING → ANALYSED in real time without any further clicks.
 */
cpRouter.post(
  '/petitions/officer-upload',
  requirePermission('AI_ANALYZE'),
  upload.single('file'),
  async (req, res) => {
    // Parse form fields — multipart sends everything as strings.
    const raw = {
      citizen_name: req.body.citizen_name,
      citizen_phone: req.body.citizen_phone || undefined,
      citizen_address: req.body.citizen_address || undefined,
      subject: req.body.subject,
      description: req.body.description,
      language: req.body.language || 'en',
    };

    const parsed = SubmitSchema.safeParse(raw);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    const officer = req.user!;

    // ---- 1. Create petition ----
    const result = tx(() => {
      const reference = nextReference();
      const r = db.prepare(`
        INSERT INTO cp_petition (reference_no, citizen_user_id, citizen_name, citizen_phone,
          citizen_address, subject, description, language, status, analysis_status,
          uploaded_by_officer)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', 'PENDING', 1)
      `).run(reference, officer.id, d.citizen_name, d.citizen_phone ?? null,
        d.citizen_address ?? null, d.subject, d.description, d.language);
      return { id: Number(r.lastInsertRowid), reference };
    });

    audit(req, officer, {
      action: 'CP_PETITION_OFFICER_UPLOAD', entityType: 'cp_petition', entityId: result.id,
      newValue: { reference: result.reference, subject: d.subject, has_file: !!req.file },
    });

    publish('petition:new', {
      id: result.id, reference_no: result.reference,
      citizen_name: d.citizen_name, subject: d.subject,
      status: 'SUBMITTED', analysis_status: 'PENDING',
      uploaded_by_officer: 1,
      created_at: new Date().toISOString(),
    });

    // Return the petition ID immediately so the UI can redirect.
    res.status(201).json({ petitionId: result.id, referenceNo: result.reference });

    // ---- 2. Process file + auto-analyse (all async, after response) ----
    void (async () => {
      const petitionId = result.id;
      let docId: number | null = null;

      // ---- 2a. Save & OCR the uploaded file ----
      if (req.file) {
        const file = req.file;

        if (!verifyMagic(file.buffer, file.mimetype)) {
          // Log the rejection but don't crash — analysis will still run on text fields.
          audit(req, officer, {
            action: 'CP_DOCUMENT_REJECTED', entityType: 'cp_petition', entityId: petitionId,
            newValue: { reason: 'Magic bytes mismatch', name: file.originalname },
          });
        } else {
          const storedName = `${randomUUID()}${extname(file.originalname) || ''}`;
          writeFileSync(resolve(UPLOAD_DIR, storedName), file.buffer);
          const checksum = createHash('sha256').update(file.buffer).digest('hex');

          const plan = planExtraction(file.mimetype);
          const inline = plan === 'INLINE' ? extractInline(file.buffer, file.mimetype) : null;

          const docTitle = req.body.doc_title || file.originalname;
          const docRow = db.prepare(`
            INSERT INTO cp_document (petition_id, title, file_name, storage_path, mime_type,
              size_bytes, checksum, ocr_status, ocr_engine, extracted_text, ocr_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(petitionId, docTitle, file.originalname, storedName,
            file.mimetype, file.size, checksum,
            plan === 'INLINE' ? inline!.status : plan === 'DEFERRED' ? 'PENDING' : 'FAILED',
            inline?.engine ?? null, inline?.text ?? null, inline?.note ?? null);

          docId = Number(docRow.lastInsertRowid);

          // A readable document carries the petitioner's particulars now; a
          // scanned one yields them later, when OCR finishes.
          if (plan === 'INLINE' && inline?.status === 'COMPLETED') {
            extractAndAdopt(docId, inline.text);
          }

          audit(req, officer, {
            action: 'CP_DOCUMENT_UPLOADED', entityType: 'cp_document', entityId: docId,
            newValue: { petition: result.reference, title: docTitle },
          });

          // ---- 2b. Run deferred OCR and WAIT for it ----
          if (plan === 'DEFERRED') {
            db.prepare("UPDATE cp_document SET ocr_status = 'PROCESSING' WHERE id = ?").run(docId);
            publish('document:ocr', { petitionId, documentId: docId, status: 'PROCESSING' });
            try {
              const out = await extractDeferred(file.buffer, file.mimetype);
              saveExtraction(docId, out);
              publish('document:ocr', {
                petitionId, documentId: docId,
                status: out.status, engine: out.engine,
                confidence: out.confidence, chars: out.text?.length ?? 0,
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              db.prepare("UPDATE cp_document SET ocr_status = 'FAILED', ocr_note = ? WHERE id = ?")
                .run(msg, docId);
              publish('document:ocr', { petitionId, documentId: docId, status: 'FAILED', error: msg });
            }
          }
        }
      }

      // ---- 3. Auto-run AI analysis ----
      db.prepare("UPDATE cp_petition SET analysis_status = 'PROCESSING', status = 'ANALYSING' WHERE id = ?")
        .run(petitionId);
      publish('petition:update', { id: petitionId, analysis_status: 'PROCESSING', status: 'ANALYSING' });

      try {
        const result2 = await runTask(
          { task: 'PETITION_ANALYSIS', entityType: 'cp_petition', entityId: petitionId, user: officer },
          (prov) => runAnalysis(prov, petitionId),
        );
        const a = result2.data;

        const ins = db.prepare(`
          INSERT INTO cp_analysis (petition_id, ai_request_id, summary, main_issue, petitioner_request,
            important_facts, act_id, section_id, act_reason, act_confidence,
            department_id, department_reason, department_confidence,
            authority_id, authority_reason, next_action, priority, priority_reason,
            overall_confidence, missing_information, requires_verification, result_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `).run(petitionId, result2.requestId,
          a.summary.en, a.main_issue.en, a.petitioner_request.en,
          JSON.stringify(a.important_facts),
          a.act.id, a.act.section_id, a.act.reason.en, a.act.confidence,
          a.department.id, a.department.reason.en, a.department.confidence,
          a.authority.id, a.authority.reason.en, a.next_action.en, a.priority, a.priority_reason.en,
          a.overall_confidence, JSON.stringify(a.missing_information),
          JSON.stringify(a));

        db.prepare("UPDATE cp_petition SET analysis_status = 'COMPLETED', status = 'ANALYSED', updated_at = datetime('now') WHERE id = ?")
          .run(petitionId);

        audit(null, officer, {
          action: 'CP_ANALYSIS_COMPLETED', entityType: 'cp_petition', entityId: petitionId,
          newValue: {
            act: a.act.short_name, department: a.department.name,
            authority: a.authority.designation, confidence: a.overall_confidence,
          },
        });

        publish('petition:update', {
          id: petitionId, analysis_status: 'COMPLETED', status: 'ANALYSED',
          suggested_act: a.act.short_name, suggested_department: a.department.name,
          confidence: a.overall_confidence, priority: a.priority,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        db.prepare("UPDATE cp_petition SET analysis_status = 'FAILED', status = 'SUBMITTED' WHERE id = ?")
          .run(petitionId);
        publish('petition:update', { id: petitionId, analysis_status: 'FAILED', status: 'SUBMITTED' });
        console.error('[officer-upload] Auto-analysis failed for petition', petitionId, msg);
      }
    })();
  },
);


cpRouter.post('/petitions/:id/documents', requirePermission('DOCUMENT_UPLOAD'),
  upload.single('file'), async (req, res) => {
    const id = Number(req.params.id);
    const p = db.prepare('SELECT * FROM cp_petition WHERE id = ?').get(id) as any;
    if (!p) { res.status(404).json({ error: 'Petition not found' }); return; }

    // A citizen may only attach to their own petition.
    const isOfficer = req.user!.permissions.includes('AI_ANALYZE');
    if (!isOfficer && p.citizen_user_id !== req.user!.id) {
      res.status(403).json({ error: 'You may only attach documents to your own petition' });
      return;
    }

    const file = req.file;
    if (!file) { res.status(400).json({ error: 'A file is required' }); return; }

    if (!verifyMagic(file.buffer, file.mimetype)) {
      audit(req, req.user!, {
        action: 'CP_DOCUMENT_REJECTED', entityType: 'cp_petition', entityId: id,
        newValue: { reason: 'Content does not match declared type', name: file.originalname },
      });
      res.status(400).json({ error: 'The file content does not match its declared type and was rejected.' });
      return;
    }

    const storedName = `${randomUUID()}${extname(file.originalname) || ''}`;
    writeFileSync(resolve(UPLOAD_DIR, storedName), file.buffer);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    const plan = planExtraction(file.mimetype);
    const inline = plan === 'INLINE' ? extractInline(file.buffer, file.mimetype) : null;

    const r = db.prepare(`
      INSERT INTO cp_document (petition_id, title, file_name, storage_path, mime_type,
        size_bytes, checksum, ocr_status, ocr_engine, extracted_text, ocr_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.body.title || file.originalname, file.originalname, storedName,
      file.mimetype, file.size, checksum,
      plan === 'INLINE' ? inline!.status : plan === 'DEFERRED' ? 'PENDING' : 'FAILED',
      inline?.engine ?? null, inline?.text ?? null, inline?.note ?? null);

    const docId = Number(r.lastInsertRowid);

    if (plan === 'INLINE' && inline?.status === 'COMPLETED') {
      extractAndAdopt(docId, inline.text);
    }

    audit(req, req.user!, {
      action: 'CP_DOCUMENT_UPLOADED', entityType: 'cp_document', entityId: docId,
      newValue: { petition: p.reference_no, title: file.originalname },
    });

    res.status(201).json({
      documentId: docId,
      ocr_status: plan === 'INLINE' ? inline!.status : plan === 'DEFERRED' ? 'PENDING' : 'FAILED',
      extracted_chars: inline?.text?.length ?? 0,
      note: plan === 'DEFERRED' ? 'Text extraction is running and will appear shortly.' : inline?.note ?? null,
    });

    // OCR runs after the response so the upload is never held up by it.
    if (plan === 'DEFERRED') {
      void (async () => {
        db.prepare("UPDATE cp_document SET ocr_status = 'PROCESSING' WHERE id = ?").run(docId);
        publish('document:ocr', { petitionId: id, documentId: docId, status: 'PROCESSING' });
        try {
          const out = await extractDeferred(file.buffer, file.mimetype);
          saveExtraction(docId, out);
          publish('document:ocr', {
            petitionId: id, documentId: docId,
            status: out.status, engine: out.engine,
            confidence: out.confidence, chars: out.text?.length ?? 0,
            scripts: out.scripts ?? [],
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          db.prepare("UPDATE cp_document SET ocr_status = 'FAILED', ocr_note = ? WHERE id = ?")
            .run(msg, docId);
          publish('document:ocr', { petitionId: id, documentId: docId, status: 'FAILED', error: msg });
        }
      })();
    }
  });

cpRouter.get('/documents/:id/file', (req, res) => {
  const doc = db.prepare('SELECT * FROM cp_document WHERE id = ?').get(Number(req.params.id)) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  const p = db.prepare('SELECT * FROM cp_petition WHERE id = ?').get(doc.petition_id) as any;

  const isOfficer = req.user!.permissions?.includes('AI_ANALYZE')
    || req.user!.permissions?.includes('MANAGE_PETITIONS')
    || req.user!.permissions?.includes('DOCUMENT_DOWNLOAD')
    || req.user!.permissions?.includes('DOCUMENT_VIEW')
    || req.user!.permissions?.includes('PETITION_VIEW')
    || req.user!.roles?.includes('GRIEVANCE_OFFICER')
    || req.user!.roles?.includes('ADMIN')
    || req.user!.roles?.includes('OFFICER');
  if (!isOfficer && p && p.citizen_user_id !== req.user!.id) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const path = resolve(UPLOAD_DIR, doc.storage_path);
  if (!existsSync(path)) { res.status(404).json({ error: 'File is missing from storage' }); return; }

  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${doc.file_name.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(readFileSync(path));
});

// =================================================== OCR MANUAL CORRECTION
/**
 * Officer manually corrects the OCR-extracted text.
 *
 * The corrected text is stored separately from the raw OCR output so both
 * are preserved and auditable. The AI analyser will prefer the corrected
 * text when it is present.
 */
cpRouter.patch('/documents/:id/ocr', requirePermission('AI_ANALYZE'), (req, res) => {
  const docId = Number(req.params.id);
  const doc = db.prepare('SELECT * FROM cp_document WHERE id = ?').get(docId) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }

  const S = z.object({ corrected_text: z.string().min(1).max(100000) });
  const parsed = S.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'corrected_text is required', issues: parsed.error.issues });
    return;
  }

  db.prepare(`
    UPDATE cp_document
    SET ocr_corrected_text = ?, ocr_corrected_source = 'OFFICER',
        ocr_corrected_by = ?, ocr_corrected_at = datetime('now')
    WHERE id = ?
  `).run(parsed.data.corrected_text, req.user!.id, docId);

  audit(req, req.user!, {
    action: 'CP_OCR_CORRECTED', entityType: 'cp_document', entityId: docId,
    newValue: { source: 'OFFICER', chars: parsed.data.corrected_text.length },
  });

  publish('document:ocr', {
    petitionId: doc.petition_id, documentId: docId,
    status: 'CORRECTED', source: 'OFFICER',
  });

  res.json({ ok: true });
});

// =================================================== OCR AI AUTO-CORRECT
/**
 * AI-assisted OCR correction.
 *
 * Sends the raw OCR text to the AI provider and asks it to reconstruct the
 * most likely intended text. The result is stored as the corrected text and
 * the officer can edit it further with the manual route above.
 */
cpRouter.post('/documents/:id/ocr-correct-ai', requirePermission('AI_ANALYZE'), async (req, res) => {
  const docId = Number(req.params.id);
  const doc = db.prepare('SELECT * FROM cp_document WHERE id = ?').get(docId) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }

  // Always start from the raw OCR output, not a previous correction.
  // Using the corrected text as input would accumulate correction headers on
  // every click and cannot improve on already-corrected content.
  const rawText = (doc.extracted_text || '').trim();
  if (!rawText) {
    res.status(400).json({ error: 'No raw OCR text is available. Upload and wait for OCR to complete first.' });
    return;
  }

  try {
    const result = await runTask(
      {
        task: 'OCR_CORRECT',
        entityType: 'cp_document', entityId: docId,
        user: req.user!,
        inputRef: `doc:${docId}`,
      },
      async (provider) => {
        const completion = await provider.generateText({
          system: `You are an expert OCR post-processor for Tamil Nadu government documents.
Your only job is to reconstruct the most plausible original text from garbled OCR output.
Rules:
- Fix broken words, run-together words, and character substitutions (0→O, 1→l, 5→S etc.)
- Preserve Tamil script characters exactly — never transliterate or omit them
- Preserve all dates, reference numbers, amounts, and survey numbers exactly
- Do NOT add, invent or summarise content
- Do NOT add any commentary or explanation — output ONLY the corrected text
- Output the corrected text as plain text, preserving paragraph structure`,
          user: `Correct this OCR output from a scanned Tamil Nadu government document:\n\n${rawText}`,
        });
        return { data: completion.text.trim(), confidence: 0.75, sources: [] };
      },
    );

    const correctedText = result.data as string;

    db.prepare(`
      UPDATE cp_document
      SET ocr_corrected_text = ?, ocr_corrected_source = 'AI_ASSIST',
          ocr_corrected_by = ?, ocr_corrected_at = datetime('now')
      WHERE id = ?
    `).run(correctedText, req.user!.id, docId);

    audit(req, req.user!, {
      action: 'CP_OCR_AI_CORRECTED', entityType: 'cp_document', entityId: docId,
      newValue: { chars: correctedText.length },
    });

    publish('document:ocr', {
      petitionId: doc.petition_id, documentId: docId,
      status: 'CORRECTED', source: 'AI_ASSIST',
    });

    res.json({ ok: true, corrected_text: correctedText });
  } catch (e) {
    res.status(503).json({
      error: 'AI correction is unavailable.',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

// =================================================== OCR RE-RUN
/**
 * Re-run OCR on a stored document image using the officer's choice of engine.
 *
 * Replaces the raw OCR output (extracted_text, confidence, engine columns).
 * Any existing officer correction is cleared because the underlying text
 * has changed — the officer should review and re-correct if needed.
 *
 * The request returns immediately (202 Accepted) and the job runs in the
 * background; the existing SSE / polling path notifies the UI when done.
 */
cpRouter.post('/documents/:id/ocr-rerun', requirePermission('AI_ANALYZE'), async (req, res) => {
  const docId = Number(req.params.id);
  const doc = db.prepare('SELECT * FROM cp_document WHERE id = ?').get(docId) as any;
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }

  const supportedMime = doc.mime_type?.startsWith('image/') || doc.mime_type === 'application/pdf';
  if (!supportedMime) {
    res.status(400).json({ error: 'OCR re-run is only available for image and PDF documents.' });
    return;
  }

  const S = z.object({ engine: z.enum(['tesseract', 'paddle']).default('tesseract') });
  const parsed = S.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: 'engine must be "tesseract" or "paddle"' }); return; }
  const { engine } = parsed.data;

  const filePath = resolve(UPLOAD_DIR, doc.storage_path);
  if (!existsSync(filePath)) { res.status(404).json({ error: 'File is missing from storage' }); return; }

  const user = req.user!;

  db.prepare("UPDATE cp_document SET ocr_status = 'PROCESSING' WHERE id = ?").run(docId);
  publish('document:ocr', { petitionId: doc.petition_id, documentId: docId, status: 'PROCESSING', engine });

  res.status(202).json({ ok: true, message: `OCR re-run started with ${engine} engine.` });

  // Run OCR after response so the upload is never held up.
  void (async () => {
    try {
      const buf = readFileSync(filePath);
      let out;
      if (engine === 'paddle') {
        const { extractWithPaddle } = await import('../core/paddle.js');
        out = await extractWithPaddle(buf, doc.mime_type);
      } else {
        out = await extractDeferred(buf, doc.mime_type);
      }

      // Clearing the previous correction because the underlying text changed.
      db.prepare(`
        UPDATE cp_document
        SET ocr_status = ?, extracted_text = ?, ocr_engine = ?,
            ocr_confidence = ?, ocr_note = ?, ocr_scripts = ?,
            ocr_corrected_text = NULL, ocr_corrected_source = NULL,
            ocr_corrected_by = NULL, ocr_corrected_at = NULL
        WHERE id = ?
      `).run(
        out.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        out.text ?? null, out.engine,
        out.confidence ?? null, out.note ?? null,
        out.scripts?.length ? out.scripts.join(', ') : null,
        docId,
      );

      audit(null, user, {
        action: 'CP_OCR_RERUN', entityType: 'cp_document', entityId: docId,
        newValue: { engine, status: out.status, confidence: out.confidence },
      });

      publish('document:ocr', {
        petitionId: doc.petition_id, documentId: docId,
        status: out.status, engine: out.engine,
        confidence: out.confidence, chars: out.text?.length ?? 0,
        scripts: out.scripts ?? [],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      db.prepare("UPDATE cp_document SET ocr_status = 'FAILED', ocr_note = ? WHERE id = ?")
        .run(msg, docId);
      publish('document:ocr', { petitionId: doc.petition_id, documentId: docId, status: 'FAILED', error: msg });
    }
  })();
});

cpRouter.get('/petitions', requirePermission('PETITION_VIEW'), async (req, res) => {
  const user = req.user!;
  const isOfficer = user.permissions.includes('AI_ANALYZE');
  const { q, status, page: pageStr, limit: limitStr } = req.query as Record<string, string>;

  const where: string[] = [];
  const params: unknown[] = [];
  // Documents analysed through the e-Gov Copilot are a working tool, not
  // incoming grievances, so they never appear in the petition queue.
  where.push("IFNULL(p.origin, 'PETITION') = 'PETITION'");
  if (!isOfficer) { where.push('p.citizen_user_id = ?'); params.push(user.id); }
  if (q) {
    const cleanQ = q.trim();
    const noHash = cleanQ.startsWith('#') ? cleanQ.slice(1).trim() : cleanQ;
    const term = `%${cleanQ}%`;
    const noHashTerm = `%${noHash}%`;

    where.push(`(
      p.reference_no LIKE ?
      OR p.subject LIKE ?
      OR p.citizen_name LIKE ?
      OR translit_en(p.citizen_name) LIKE ?
      OR p.citizen_phone LIKE ?
      OR CAST(p.id AS TEXT) LIKE ?
      OR p.status LIKE ?
      OR p.analysis_status LIKE ?
      OR dept.name LIKE ?
      OR dept.name_ta LIKE ?
      OR act.short_name LIKE ?
      OR act.short_name_ta LIKE ?
      OR a.main_issue LIKE ?
      OR a.result_json LIKE ?
      OR tc.translated LIKE ?
    )`);
    params.push(
      noHashTerm, // p.reference_no
      term,       // p.subject
      term,       // p.citizen_name
      term,       // translit_en(p.citizen_name)
      term,       // p.citizen_phone
      noHashTerm, // p.id
      term,       // p.status
      term,       // p.analysis_status
      term,       // dept.name
      term,       // dept.name_ta
      term,       // act.short_name
      term,       // act.short_name_ta
      term,       // a.main_issue
      term,       // a.result_json
      term,       // tc.translated
    );
  }
  if (status) { where.push('p.status = ?'); params.push(status); }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // 1. Fast indexed count of total matching petitions
  const countRow = db.prepare(`
    SELECT COUNT(DISTINCT p.id) AS total
    FROM cp_petition p
    LEFT JOIN (
      SELECT a1.petition_id, a1.department_id, a1.act_id, a1.main_issue, a1.result_json
      FROM cp_analysis a1
      INNER JOIN (
        SELECT petition_id, MAX(id) AS max_id
        FROM cp_analysis
        GROUP BY petition_id
      ) a2 ON a1.id = a2.max_id
    ) a ON a.petition_id = p.id
    LEFT JOIN kb_department dept ON dept.id = a.department_id
    LEFT JOIN kb_act act ON act.id = a.act_id
    LEFT JOIN translation_cache tc ON tc.source_text = p.subject
    ${whereClause}
  `).get(...params) as any;
  const total = countRow?.total ?? 0;

  // 2. Pagination parameters (defaults to 25 items per page)
  const hasPagination = pageStr !== undefined || limitStr !== undefined;
  const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);
  const limit = limitStr === 'all'
    ? total
    : Math.min(100, Math.max(1, parseInt(limitStr || (hasPagination ? '25' : '50'), 10) || 25));
  const offset = (page - 1) * limit;

  // 3. Main query for the requested slice only
  const paginationSql = limitStr === 'all' ? '' : 'LIMIT ? OFFSET ?';
  const queryParams = limitStr === 'all' ? params : [...params, limit, offset];

  const rows = db.prepare(`
    SELECT p.*,
      COALESCE(doc.doc_count, 0) AS document_count,
      a.overall_confidence AS confidence,
      dept.name AS suggested_department,
      dept.name_ta AS suggested_department_ta,
      act.short_name AS suggested_act,
      act.short_name_ta AS suggested_act_ta,
      a.priority AS priority
    FROM cp_petition p
    LEFT JOIN (
      SELECT petition_id, COUNT(*) AS doc_count
      FROM cp_document
      GROUP BY petition_id
    ) doc ON doc.petition_id = p.id
    LEFT JOIN (
      SELECT a1.petition_id, a1.overall_confidence, a1.priority, a1.department_id, a1.act_id, a1.main_issue, a1.result_json
      FROM cp_analysis a1
      INNER JOIN (
        SELECT petition_id, MAX(id) AS max_id
        FROM cp_analysis
        GROUP BY petition_id
      ) a2 ON a1.id = a2.max_id
    ) a ON a.petition_id = p.id
    LEFT JOIN kb_department dept ON dept.id = a.department_id
    LEFT JOIN kb_act act ON act.id = a.act_id
    LEFT JOIN translation_cache tc ON tc.source_text = p.subject
    ${whereClause}
    GROUP BY p.id
    ORDER BY p.created_at DESC, p.id DESC
    ${paginationSql}
  `).all(...queryParams);

  /*
   * Render the citizen's own words in the language the officer selected.
   * Runs in-memory in ~1ms without blocking on hundreds of external requests.
   */
  const lang = (req.query as any).lang === 'ta' ? 'ta' : (req.query as any).lang === 'en' ? 'en' : null;
  if (lang && rows.length) {
    try {
      // 1. In-memory Knowledge Base mapping for subjects (0ms)
      const out = renderManyInLanguage(rows.map((r: any) => r.subject ?? ''), lang);
      rows.forEach((r: any, i: number) => {
        r.subject_display = out[i].text;
        r.subject_translated = out[i].translated;
      });

      // 2. Transliterate citizen names and addresses instantaneously in memory (0ms)
      rows.forEach((r: any) => {
        if (r.citizen_name) {
          r.citizen_name_display = translitDisplayName(r.citizen_name, lang);
        }
        if (r.citizen_address) {
          r.citizen_address_display = translitDisplayAddress(r.citizen_address, lang);
        }
      });

      // 3. Fallback AI translation for subjects that could not be mapped via KB
      // Cap at most 5 un-cached subjects to guarantee ultra-fast response (<150ms)
      const pending: number[] = [];
      rows.forEach((r: any, i: number) => {
        const text = String(r.subject_display ?? '');
        if (text.length > 2 && detectTextLang(text) !== lang) pending.push(i);
      });

      if (pending.length) {
        const toTranslate = pending.slice(0, 5);
        const done = await Promise.all(
          toTranslate.map((i) => translateText(String((rows[i] as any).subject_display ?? ''), lang)),
        );
        toTranslate.forEach((rowIndex, k) => {
          const t = done[k];
          if (t.machine) {
            (rows[rowIndex] as any).subject_display = t.text;
            (rows[rowIndex] as any).subject_translated = true;
          }
        });
      }
    } catch {
      // Rendering must never stop the list from loading.
    }
  }

  res.json({ total, page, limit, rows });
});

cpRouter.get('/petitions/:id', requirePermission('PETITION_VIEW'), async (req, res) => {
  const id = Number(req.params.id);
  const viewLang = req.query.lang === 'ta' ? 'ta' : req.query.lang === 'en' ? 'en' : undefined;
  const p = db.prepare('SELECT * FROM cp_petition WHERE id = ?').get(id) as any;
  if (!p) { res.status(404).json({ error: 'Petition not found' }); return; }

  const isOfficer = req.user!.permissions.includes('AI_ANALYZE');
  if (!isOfficer && p.citizen_user_id !== req.user!.id) {
    res.status(403).json({ error: 'You do not have access to this petition' });
    return;
  }

  const documents = db.prepare(
    'SELECT * FROM cp_document WHERE petition_id = ? ORDER BY id',
  ).all(id) as any[];

  /*
   * Particulars the backend read out of the documents.
   *
   * The first document that yielded a given field wins, so a petition with
   * several attachments still produces one coherent set. Each field keeps the
   * snippet it came from, so the officer can verify it against the scan rather
   * than taking the extraction on trust.
   */
  const extracted: Record<string, any> = {};
  for (const doc of documents) {
    if (!doc.extracted_details) continue;
    try {
      const parsed = JSON.parse(doc.extracted_details);
      doc.extracted_details = parsed;
      for (const [field, val] of Object.entries(parsed)) {
        if (val && !extracted[field]) {
          extracted[field] = { ...(val as any), document_id: doc.id };
        }
      }
    } catch {
      doc.extracted_details = null;
    }
  }

  const analysis = db.prepare(
    'SELECT * FROM cp_analysis WHERE petition_id = ? ORDER BY id DESC LIMIT 1',
  ).get(id) as any;

  // Resolve the knowledge references so the UI shows names, not ids.
  let act = null, section = null, department = null, authority = null;
  if (analysis) {
    if (analysis.act_id) act = db.prepare('SELECT * FROM kb_act WHERE id = ?').get(analysis.act_id);
    if (analysis.section_id) section = db.prepare('SELECT * FROM kb_section WHERE id = ?').get(analysis.section_id);
    if (analysis.department_id) department = db.prepare('SELECT * FROM kb_department WHERE id = ?').get(analysis.department_id);
    if (analysis.authority_id) authority = db.prepare('SELECT * FROM kb_authority WHERE id = ?').get(analysis.authority_id);
    analysis.important_facts = JSON.parse(analysis.important_facts || '[]');
    analysis.missing_information = JSON.parse(analysis.missing_information || '[]');
    // The bilingual result is the authoritative view; the columns are a summary.
    try {
      analysis.full = analysis.result_json ? JSON.parse(analysis.result_json) : null;
    } catch { analysis.full = null; }
  }

  // Citizens do not see the officer's internal notes.
  const petition = isOfficer ? p : { ...p, officer_notes: undefined };

  /*
   * Render the analysis in the language the officer is reading.
   *
   * The analyser stores every field as an {en, ta} pair, but where the text is
   * the PETITIONER'S OWN WORDS it echoes the same string into both halves -
   * deliberately, because a case record must carry what the citizen actually
   * wrote, not a machine paraphrase of it.
   *
   * That is right for the record and wrong for the screen: an officer reading
   * the English console saw a Tamil summary, a Tamil main issue and Tamil
   * facts. So the DISPLAY halves are translated on demand here, while the
   * stored analysis is left exactly as it was.
   *
   * WHAT IS NEVER TRANSLATED. Only narrative prose is sent: summaries, issues,
   * requests and facts. Names, phone numbers, addresses, dates, reference
   * numbers, Act titles and department names are excluded - they come from the
   * knowledge base already bilingual, or are identifiers that must read the
   * same in both languages.
   */
  if (viewLang) {
    if (analysis?.full) {
      try {
        await renderAnalysisInLanguage(analysis.full, viewLang);
      } catch {
        // A failed translation must never stop the petition from loading.
      }
    }

    if (petition.subject && detectTextLang(petition.subject) !== viewLang) {
      try {
        const tr = await translateText(petition.subject, viewLang);
        if (tr?.text) {
          petition.subject_display = tr.text;
          petition.subject_translated = tr.machine;
        }
      } catch { /* keep original */ }
    }
    if (petition.description && detectTextLang(petition.description) !== viewLang) {
      try {
        const tr = await translateText(petition.description, viewLang);
        if (tr?.text) {
          petition.description_display = tr.text;
        }
      } catch { /* keep original */ }
    }
    if (petition.citizen_name) {
      petition.citizen_name_display = translitDisplayName(petition.citizen_name, viewLang);
    }
    if (petition.citizen_address) {
      petition.citizen_address_display = translitDisplayAddress(petition.citizen_address, viewLang);
    }
  }

  res.json({
    petition,
    documents,
    /*
     * What the backend read from the documents. Kept separate from `petition`
     * so the UI can show both: what a person entered, and what the machine
     * read from the scan. Neither overwrites the other.
     */
    extracted_details: Object.keys(extracted).length ? extracted : null,
    analysis: isOfficer ? analysis : null,
    act, section, department, authority,
    copilot: isOfficer
      ? db.prepare('SELECT * FROM cp_copilot_message WHERE petition_id = ? ORDER BY id').all(id)
      : [],
  });
});

/**
 * Translate the narrative halves of an analysis into `lang`, in place.
 *
 * Only prose is touched. Every value is cached by source hash, so a petition
 * viewed repeatedly costs one translation per distinct sentence, ever.
 */
async function renderAnalysisInLanguage(full: any, lang: 'ta' | 'en'): Promise<void> {
  /*
   * The narrative fields, and only those.
   *
   * `act`, `department` and `authority` are deliberately absent: their names
   * come from the knowledge base in both languages already, and a machine
   * rendering of a statutory title would be worse than the recorded one.
   */
  const jobs: { get: () => any; set: (v: string) => void }[] = [];

  const add = (obj: any, key: string) => {
    const v = obj?.[key];
    if (!v || typeof v !== 'object' || typeof v[lang] !== 'string') return;
    jobs.push({ get: () => v[lang], set: (t: string) => { v[lang] = t; } });
  };

  for (const k of ['summary', 'main_issue', 'petitioner_request', 'next_action']) add(full, k);
  for (const list of ['important_facts', 'sub_issues', 'workflow', 'missing_information']) {
    for (const item of (full?.[list] ?? [])) {
      if (item && typeof item === 'object' && typeof item[lang] === 'string') {
        jobs.push({ get: () => item[lang], set: (t: string) => { item[lang] = t; } });
      }
    }
  }
  for (const step of (full?.reasoning_flow ?? [])) add(step, 'value');

  // Only the values that are in the WRONG language need a call.
  const pending = jobs.filter((j) => {
    const t = String(j.get() ?? '');
    return t.length > 2 && detectTextLang(t) !== lang;
  });
  if (pending.length) {
    const done = await Promise.all(pending.map((j) => translateText(String(j.get()), lang)));
    pending.forEach((j, i) => { if (done[i].machine) j.set(done[i].text); });
  }

  // Language harmonization for entity lists (people and places)
  if (lang === 'en') {
    for (const j of jobs) {
      let val = String(j.get() ?? '');
      if (/People named:\s*/i.test(val) && /[\u0B80-\u0BFF]/.test(val)) {
        val = val.replace(/People named:\s*(.+)$/i, (_m, names) => {
          return `People named: ${names.split(',').map((n: string) => translitDisplayName(n.trim(), 'en')).join(', ')}`;
        });
        j.set(val);
      }
      if (/Places mentioned:\s*/i.test(val) && /[\u0B80-\u0BFF]/.test(val)) {
        val = val.replace(/Places mentioned:\s*(.+)$/i, (_m, places) => {
          return `Places mentioned: ${places.split(',').map((p: string) => translitDisplayAddress(p.trim(), 'en')).join(', ')}`;
        });
        j.set(val);
      }
    }
    if (full.entities) {
      if (Array.isArray(full.entities.people)) {
        full.entities.people = full.entities.people.map((p: string) => translitDisplayName(p, 'en'));
      }
      if (Array.isArray(full.entities.places)) {
        full.entities.places = full.entities.places.map((p: string) => translitDisplayAddress(p, 'en'));
      }
    }
  } else if (lang === 'ta') {
    for (const j of jobs) {
      let val = String(j.get() ?? '');
      if (/குறிப்பிடப்பட்ட நபர்கள்:\s*/i.test(val) && /[A-Za-z]/.test(val)) {
        val = val.replace(/குறிப்பிடப்பட்ட நபர்கள்:\s*(.+)$/i, (_m, names) => {
          return `குறிப்பிடப்பட்ட நபர்கள்: ${names.split(',').map((n: string) => translitDisplayName(n.trim(), 'ta')).join(', ')}`;
        });
        j.set(val);
      }
      if (/குறிப்பிடப்பட்ட இடங்கள்:\s*/i.test(val) && /[A-Za-z]/.test(val)) {
        val = val.replace(/குறிப்பிடப்பட்ட இடங்கள்:\s*(.+)$/i, (_m, places) => {
          return `குறிப்பிடப்பட்ட இடங்கள்: ${places.split(',').map((p: string) => translitDisplayAddress(p.trim(), 'ta')).join(', ')}`;
        });
        j.set(val);
      }
    }
    if (full.entities) {
      if (Array.isArray(full.entities.people)) {
        full.entities.people = full.entities.people.map((p: string) => translitDisplayName(p, 'ta'));
      }
      if (Array.isArray(full.entities.places)) {
        full.entities.places = full.entities.places.map((p: string) => translitDisplayAddress(p, 'ta'));
      }
    }
  }
}

// =================================================== AI ANALYSIS
cpRouter.post('/petitions/:id/analyse', requirePermission('AI_ANALYZE'), async (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM cp_petition WHERE id = ?').get(id) as any;
  if (!p) { res.status(404).json({ error: 'Petition not found' }); return; }

  db.prepare("UPDATE cp_petition SET analysis_status = 'PROCESSING', status = 'ANALYSING' WHERE id = ?").run(id);
  publish('petition:update', { id, analysis_status: 'PROCESSING', status: 'ANALYSING' });

  try {
    const result = await runTask(
      { task: 'PETITION_ANALYSIS', petitionId: undefined, user: req.user!, entityType: 'cp_petition', entityId: id },
      (prov) => runAnalysis(prov, id),
    );
    const a = result.data;

    /*
     * The full bilingual result is stored as JSON, and the fields the dashboard
     * queries directly (act, department, priority, confidence) are also written
     * to columns so a list view does not have to parse every row.
     */
    const ins = db.prepare(`
      INSERT INTO cp_analysis (petition_id, ai_request_id, summary, main_issue, petitioner_request,
        important_facts, act_id, section_id, act_reason, act_confidence,
        department_id, department_reason, department_confidence,
        authority_id, authority_reason, next_action, priority, priority_reason,
        overall_confidence, missing_information, requires_verification, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, result.requestId,
      a.summary.en, a.main_issue.en, a.petitioner_request.en,
      JSON.stringify(a.important_facts),
      a.act.id, a.act.section_id, a.act.reason.en, a.act.confidence,
      a.department.id, a.department.reason.en, a.department.confidence,
      a.authority.id, a.authority.reason.en, a.next_action.en, a.priority, a.priority_reason.en,
      a.overall_confidence, JSON.stringify(a.missing_information),
      JSON.stringify(a));

    db.prepare("UPDATE cp_petition SET analysis_status = 'COMPLETED', status = 'ANALYSED', updated_at = datetime('now') WHERE id = ?").run(id);

    audit(req, req.user!, {
      action: 'CP_ANALYSIS_COMPLETED', entityType: 'cp_petition', entityId: id,
      newValue: {
        act: a.act.short_name, department: a.department.name,
        authority: a.authority.designation, confidence: a.overall_confidence,
      },
    });

    publish('petition:update', {
      id, analysis_status: 'COMPLETED', status: 'ANALYSED',
      suggested_act: a.act.short_name, suggested_department: a.department.name,
      confidence: a.overall_confidence, priority: a.priority,
    });

    res.json({
      analysisId: Number(ins.lastInsertRowid),
      ...a,
      disclaimer: 'AI Recommendation — Requires Officer Verification.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.prepare("UPDATE cp_petition SET analysis_status = 'FAILED' WHERE id = ?").run(id);
    publish('petition:update', { id, analysis_status: 'FAILED' });
    res.status(503).json({
      error: 'AI analysis is unavailable. The petition can still be processed manually.',
      detail: msg,
    });
  }
});

// =================================================== COPILOT
cpRouter.post('/petitions/:id/copilot', requirePermission('AI_ANALYZE'), async (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM cp_petition WHERE id = ?').get(id) as any;
  if (!p) { res.status(404).json({ error: 'Petition not found' }); return; }

  const S = z.object({ question: z.string().min(2).max(500) });
  const parsed = S.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'A question is required' }); return; }

  db.prepare(
    'INSERT INTO cp_copilot_message (petition_id, role, content, asked_by) VALUES (?, ?, ?, ?)',
  ).run(id, 'USER', parsed.data.question, req.user!.id);

  try {
    const result = await runTask(
      { task: 'COPILOT', user: req.user!, entityType: 'cp_petition', entityId: id, inputRef: parsed.data.question },
      (prov) => runCopilot(prov, id, parsed.data.question),
    );

    const ins = db.prepare(`
      INSERT INTO cp_copilot_message (petition_id, role, content, sources, confidence, asked_by)
      VALUES (?, 'ASSISTANT', ?, ?, ?, ?)
    `).run(id, result.data.answer, JSON.stringify(result.data.sources),
      result.data.confidence, req.user!.id);

    res.json({
      messageId: Number(ins.lastInsertRowid),
      ...result.data,
    });
  } catch (e) {
    res.status(503).json({
      error: 'The Copilot is unavailable.',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

// ======================================= E-GOV COPILOT: DOCUMENT ANALYSIS
/**
 * Analyse a document dropped into the e-Gov Copilot.
 *
 * REUSES THE PETITION PIPELINE EXACTLY. The document is stored as a petition
 * record marked origin = 'COPILOT', OCR runs through `extractDeferred`, and
 * `runAnalysis` produces the result - the same code path, the same knowledge
 * base, the same guarantee that an Act can only be named if it exists as a
 * row. Nothing here re-implements the analysis, so the two can never drift.
 *
 * A COPILOT record is excluded from the petition list and from every dashboard
 * count: it is a tool for reading a document, not a citizen's grievance.
 *
 * The response returns as soon as the file is stored. OCR and analysis run
 * after it and are reported on the realtime stream, so a scanned Tamil PDF
 * (which takes seconds) does not hold the request open.
 */
cpRouter.post(
  '/copilot/analyse-document',
  requirePermission('AI_ANALYZE'),
  upload.single('file'),
  async (req, res) => {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'A file is required' }); return; }

    if (!verifyMagic(file.buffer, file.mimetype)) {
      audit(req, req.user!, {
        action: 'CP_COPILOT_DOCUMENT_REJECTED', entityType: 'cp_document', entityId: 0,
        newValue: { reason: 'Content does not match declared type', name: file.originalname },
      });
      res.status(400).json({
        error: 'The file content does not match its declared type and was rejected.',
      });
      return;
    }

    const officer = req.user!;
    const title = String(req.body.title || file.originalname);

    const created = tx(() => {
      const reference = nextReference();
      const pr = db.prepare(`
        INSERT INTO cp_petition (reference_no, citizen_user_id, citizen_name, subject,
          description, language, status, analysis_status, uploaded_by_officer, origin)
        VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED', 'PENDING', 1, 'COPILOT')
      /*
       * The description is left empty on purpose.
       *
       * The analyser builds its summary from subject + description + document
       * text. Any placeholder wording put here ("Document submitted to the
       * Copilot…") would be read as if the citizen had written it and would
       * surface in the summary. The document's own text is the only content
       * that should be analysed.
       */
      /*
       * The petitioner is UNKNOWN until the document has been read.
       *
       * Seeding the uploading officer's name here made the officer look like
       * the petitioner, and - because a real person's name is not a
       * placeholder - it then blocked the name extracted from the document
       * from ever being adopted. "Citizen" is the honest value: it is replaced
       * the moment the document yields a real name.
       */
      `).run(reference, officer.id, 'Citizen',
        // Subject is the document's own name only when the officer supplied a
        // meaningful one; a raw filename ("AP-2026-6850AB.pdf") is not content
        // and would otherwise appear in the summary as though it were.
        looksLikeFilename(title) ? 'Uploaded document' : title,
        '', 'auto');

      const petitionId = Number(pr.lastInsertRowid);

      const storedName = `${randomUUID()}${extname(file.originalname) || ''}`;
      writeFileSync(resolve(UPLOAD_DIR, storedName), file.buffer);
      const checksum = createHash('sha256').update(file.buffer).digest('hex');

      const plan = planExtraction(file.mimetype);
      const inline = plan === 'INLINE' ? extractInline(file.buffer, file.mimetype) : null;

      const dr = db.prepare(`
        INSERT INTO cp_document (petition_id, title, file_name, storage_path, mime_type,
          size_bytes, checksum, ocr_status, ocr_engine, extracted_text, ocr_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(petitionId, title, file.originalname, storedName, file.mimetype,
        file.size, checksum,
        plan === 'INLINE' ? inline!.status : plan === 'DEFERRED' ? 'PENDING' : 'FAILED',
        inline?.engine ?? null, inline?.text ?? null, inline?.note ?? null);

      const documentId = Number(dr.lastInsertRowid);
      if (plan === 'INLINE' && inline?.status === 'COMPLETED') {
        extractAndAdopt(documentId, inline.text);
      }

      return { petitionId, reference, plan, inline, documentId };
    });

    audit(req, officer, {
      action: 'CP_COPILOT_DOCUMENT_UPLOADED', entityType: 'cp_document',
      entityId: created.documentId,
      newValue: { reference: created.reference, title, mime: file.mimetype },
    });

    if (created.plan === 'UNSUPPORTED') {
      res.status(400).json({
        error: `Text cannot be extracted from ${file.mimetype}.`,
        petitionId: created.petitionId,
      });
      return;
    }

    res.status(201).json({
      petitionId: created.petitionId,
      documentId: created.documentId,
      referenceNo: created.reference,
      ocr_status: created.plan === 'INLINE' ? created.inline!.status : 'PENDING',
      stage: created.plan === 'INLINE' ? 'ANALYSING' : 'EXTRACTING',
    });

    // ---- extraction, then analysis; both reported on the stream ----
    void (async () => {
      const pid = created.petitionId;
      const did = created.documentId;
      try {
        if (created.plan === 'DEFERRED') {
          db.prepare("UPDATE cp_document SET ocr_status = 'PROCESSING' WHERE id = ?").run(did);
          publish('copilot:progress', {
            petitionId: pid, stage: 'EXTRACTING',
            message: 'Reading the document (Tamil and English)…',
          });

          const out = await extractDeferred(file.buffer, file.mimetype);
          saveExtraction(did, out);

          publish('copilot:progress', {
            petitionId: pid, stage: 'EXTRACTED',
            status: out.status, engine: out.engine, confidence: out.confidence,
            scripts: out.scripts ?? [], chars: out.text?.length ?? 0,
            note: out.note ?? null,
          });

          // Nothing was read, so there is nothing to analyse. Say so rather
          // than running the analyser against an empty string and presenting
          // whatever it settles on.
          if (out.status !== 'COMPLETED' || !out.text) {
            /*
             * A Copilot document that could not be read leaves nothing worth
             * keeping: no text, no analysis, and a petition row that would sit
             * in the database for ever. The officer is told why and can upload
             * a readable copy, so the record is removed rather than
             * accumulating dead entries on every failed attempt.
             */
            publish('copilot:progress', {
              petitionId: pid, stage: 'FAILED',
              message: out.note ?? 'No text could be extracted from this document.',
            });
            // Remove the row and its document; the stored file goes too.
            try {
              const stored = db.prepare(
                'SELECT storage_path FROM cp_document WHERE id = ?',
              ).get(did) as any;
              db.prepare('DELETE FROM cp_document WHERE petition_id = ?').run(pid);
              db.prepare('DELETE FROM cp_petition WHERE id = ?').run(pid);
              if (stored?.storage_path) {
                const abs = resolve(UPLOAD_DIR, stored.storage_path);
                if (existsSync(abs)) unlinkSync(abs);
              }
            } catch {
              // Tidying is best-effort; the officer has already been told.
            }
            return;
          }
        }

        publish('copilot:progress', {
          petitionId: pid, stage: 'ANALYSING',
          message: 'Analysing against the configured knowledge base…',
        });

        db.prepare("UPDATE cp_petition SET analysis_status = 'PROCESSING' WHERE id = ?").run(pid);

        const result = await runTask(
          {
            task: 'PETITION_ANALYSIS', user: officer,
            entityType: 'cp_petition', entityId: pid,
          },
          (prov) => runAnalysis(prov, pid),
        );
        const a = result.data;

        db.prepare(`
          INSERT INTO cp_analysis (petition_id, ai_request_id, summary, main_issue,
            petitioner_request, important_facts, act_id, section_id, act_reason, act_confidence,
            department_id, department_reason, department_confidence,
            authority_id, authority_reason, next_action, priority, priority_reason,
            overall_confidence, missing_information, requires_verification, result_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `).run(pid, result.requestId,
          a.summary.en, a.main_issue.en, a.petitioner_request.en,
          JSON.stringify(a.important_facts),
          a.act.id, a.act.section_id, a.act.reason.en, a.act.confidence,
          a.department.id, a.department.reason.en, a.department.confidence,
          a.authority.id, a.authority.reason.en, a.next_action.en,
          a.priority, a.priority_reason.en, a.overall_confidence,
          JSON.stringify(a.missing_information), JSON.stringify(a));

        db.prepare(
          "UPDATE cp_petition SET analysis_status = 'COMPLETED', status = 'ANALYSED' WHERE id = ?",
        ).run(pid);

        publish('copilot:progress', {
          petitionId: pid, stage: 'COMPLETED',
          confidence: a.overall_confidence,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        db.prepare("UPDATE cp_petition SET analysis_status = 'FAILED' WHERE id = ?").run(pid);
        publish('copilot:progress', { petitionId: pid, stage: 'FAILED', message: msg });
      }
    })();
  },
);

/**
 * The result of a Copilot document analysis.
 *
 * Returns the extracted text alongside the full bilingual analysis so the page
 * can show what was actually read - an officer must be able to check the
 * analysis against the document's own words.
 */
cpRouter.get('/copilot/result/:id', requirePermission('AI_ANALYZE'), (req, res) => {
  const pid = Number(req.params.id);
  const p = db.prepare(
    "SELECT * FROM cp_petition WHERE id = ? AND origin = 'COPILOT'",
  ).get(pid) as any;
  if (!p) { res.status(404).json({ error: 'No such Copilot analysis' }); return; }

  const doc = db.prepare(
    'SELECT * FROM cp_document WHERE petition_id = ? ORDER BY id DESC LIMIT 1',
  ).get(pid) as any;
  const an = db.prepare(
    'SELECT * FROM cp_analysis WHERE petition_id = ? ORDER BY id DESC LIMIT 1',
  ).get(pid) as any;

  res.json({
    petitionId: pid,
    referenceNo: p.reference_no,
    title: doc?.title ?? null,
    analysis_status: p.analysis_status,
    document: doc ? {
      id: doc.id, file_name: doc.file_name, mime_type: doc.mime_type,
      ocr_status: doc.ocr_status, ocr_engine: doc.ocr_engine,
      ocr_confidence: doc.ocr_confidence, ocr_scripts: doc.ocr_scripts,
      ocr_note: doc.ocr_note,
      extracted_text: doc.ocr_corrected_text || doc.extracted_text || null,
      // The petitioner particulars the backend read out of this document.
      extracted_details: (() => {
        try { return doc.extracted_details ? JSON.parse(doc.extracted_details) : null; }
        catch { return null; }
      })(),
    } : null,
    analysis: an?.result_json ? JSON.parse(an.result_json) : null,
  });
});

// =================================================== CAPABILITY STATUS
/*
 * What the system can actually do right now.
 *
 * The officer is told plainly whether a live model and live search are in use,
 * so an answer produced by the local provider alone is never mistaken for one
 * grounded in a current official source.
 */
cpRouter.get('/ai-status', requirePermission('AI_ANALYZE'), async (_req, res) => {
  res.json({
    ai: providerStatus(),
    ocr: { languages: availableLanguages(), engines: await availableEngines() },
  });
});

cpRouter.get('/search-status', requirePermission('AI_ANALYZE'), (_req, res) => {
  res.json(searchStatus());
});

/*
 * Translate a piece of text on demand.
 *
 * Exposed so an officer can render a Tamil petition in English (and the
 * reverse) without re-running the analysis, and so the translation path can be
 * exercised directly when diagnosing a language problem.
 */
cpRouter.post('/translate', requirePermission('PETITION_VIEW'), async (req, res) => {
  const S = z.object({
    text: z.string().min(1).max(4000),
    to: z.enum(['ta', 'en']),
  });
  const parsed = S.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'text and target language are required' }); return; }

  const out = await translateText(parsed.data.text, parsed.data.to);
  res.json(out);
});

// =================================================== AI PROVIDER SETTINGS
/*
 * Which vendors exist, and which is in use.
 *
 * WHAT THIS DELIBERATELY DOES NOT RETURN: any API key, in any form, not even
 * masked. The response carries a vendor id, a label, a model name and a
 * boolean. Credentials live in the server environment and stay there - the
 * browser has no use for one, so it is never given one.
 */
cpRouter.get('/ai-providers', requirePermission('ADMIN_CONFIGURE'), (_req, res) => {
  res.json({
    providers: listProviders(),
    current: providerStatus(),
    /*
     * Which engine does TRANSLATION, which is a separate question from which
     * model answers. A dedicated service has its own quota, so translation
     * keeps working when the model is rate-limited - and an administrator
     * needs to see at a glance which one is in use.
     */
    translation: translateApiStatus(),
  });
});

const PROVIDER_ID = z.enum(['gemini', 'openai', 'grok', 'groq', 'nvidia', 'ollama']);

/** Choose the vendor that answers from now on. */
cpRouter.post('/ai-providers/select', requirePermission('ADMIN_CONFIGURE'), (req, res) => {
  const S = z.object({ id: PROVIDER_ID, model: z.string().max(80).optional() });
  const parsed = S.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'A provider id is required' }); return; }

  const out = selectProvider(parsed.data.id as ProviderId, parsed.data.model);
  if (!out.ok) { res.status(400).json({ error: out.error }); return; }

  audit(req, req.user!, {
    action: 'AI_PROVIDER_SELECTED', entityType: 'system_config', entityId: 0,
    newValue: { provider: parsed.data.id, model: parsed.data.model ?? null },
  });
  res.json(out.status);
});

/*
 * Prove a vendor answers, with a real request.
 *
 * A present key is not the same as a working one: revoked keys, exhausted
 * quotas and a stopped Ollama daemon all look configured. This is the only
 * honest way to answer "is it working?", so the dialog asks it explicitly
 * rather than inferring.
 */
cpRouter.post('/ai-providers/test', requirePermission('ADMIN_CONFIGURE'), async (req, res) => {
  const S = z.object({ id: PROVIDER_ID, model: z.string().max(80).optional() });
  const parsed = S.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'A provider id is required' }); return; }

  // A failed test is a RESULT, not a server error: 200 with ok:false, so the
  // dialog can show the reason instead of a generic network failure.
  res.json(await testProvider(parsed.data.id as ProviderId, parsed.data.model));
});

// =================================================== GLOBAL E-GOV COPILOT
/** The officer's conversation so far, so a reopened panel is not blank. */
cpRouter.get('/e-gov-chat', requirePermission('AI_ANALYZE'), (req, res) => {
  const rows = db.prepare(`
    SELECT id, role, content, sources, confidence, tools_used, confidence_tier, created_at
      FROM egov_chat_message
     WHERE asked_by = ?
     ORDER BY id DESC LIMIT 40
  `).all(req.user!.id) as any[];
  res.json({ messages: rows.reverse() });
});

/** Start a fresh conversation. The audit trail keeps the old one. */
cpRouter.delete('/e-gov-chat', requirePermission('AI_ANALYZE'), (req, res) => {
  const r = db.prepare('DELETE FROM egov_chat_message WHERE asked_by = ?').run(req.user!.id);
  audit(req, req.user!, {
    action: 'EGOV_CHAT_CLEARED', entityType: 'egov_chat', entityId: 0,
    oldValue: { messages: r.changes },
  });
  res.json({ cleared: r.changes });
});

/*
 * Migrate egov_chat_message to include tools_used and confidence_tier columns.
 * These were added in the Hermes-pattern upgrade; existing databases need them.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS egov_chat_message (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    sources         TEXT,
    confidence      REAL,
    tools_used      TEXT,
    confidence_tier TEXT,
    asked_by        INTEGER REFERENCES app_user(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ix_egov_chat_user ON egov_chat_message(asked_by, id);
`);
// Migrate existing rows — add columns if the table already existed without them
try { db.exec("ALTER TABLE egov_chat_message ADD COLUMN tools_used TEXT"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE egov_chat_message ADD COLUMN confidence_tier TEXT"); } catch { /* already exists */ }

cpRouter.post('/e-gov-chat', requirePermission('AI_ANALYZE'), async (req, res) => {
  const S = z.object({
    question: z.string().min(2).max(500),
    petitionId: z.number().int().positive().optional(),
    lang: z.enum(['ta', 'en']).optional(),
    conversationId: z.string().max(64).optional(),
  });
  const parsed = S.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'A question is required' }); return; }

  /*
   * Load conversation history BEFORE storing the new question, so the agent
   * sees the exchange up to this point. A follow-up like "which department?"
   * after "which Act applies?" resolves correctly against prior turns.
   */
  const history = (db.prepare(`
    SELECT role, content FROM egov_chat_message
     WHERE asked_by = ?
     ORDER BY id DESC LIMIT 8
  `).all(req.user!.id) as any[])
    .reverse()
    .map((m) => ({ role: m.role as 'USER' | 'ASSISTANT', content: String(m.content ?? '') }));

  db.prepare(
    'INSERT INTO egov_chat_message (role, content, asked_by) VALUES (?, ?, ?)',
  ).run('USER', parsed.data.question, req.user!.id);

  try {
    const result = await runTask(
      {
        task: 'GLOBAL_COPILOT', user: req.user!, entityType: 'egov_chat',
        entityId: parsed.data.petitionId ?? 0, inputRef: parsed.data.question,
      },
      (prov) => runGlobalCopilot(prov, parsed.data.question, parsed.data.petitionId, {
        history,
        lang: parsed.data.lang,
      }),
    );

    const ins = db.prepare(`
      INSERT INTO egov_chat_message (role, content, sources, confidence, tools_used, confidence_tier, asked_by)
      VALUES ('ASSISTANT', ?, ?, ?, ?, ?, ?)
    `).run(
      result.data.answer,
      JSON.stringify(result.data.sources),
      result.data.confidence,
      // `runTask` forwards only `data`, so the tool trail travels inside it.
      JSON.stringify(result.data.toolsUsed ?? []),
      result.data.confidenceTier ?? null,
      req.user!.id,
    );

    res.json({
      messageId: Number(ins.lastInsertRowid),
      ...result.data,
    });
  } catch (e) {
    res.status(503).json({
      error: 'The e-Gov Copilot is unavailable.',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

// =================================================== TRANSLATE TEXT (on-demand)
/*
 * On-demand government translation for officer use.
 *
 * Separate from the internal translation cache used by the analysis pipeline.
 * This endpoint lets the officer translate a petition subject or body text
 * directly from the UI, using the upgraded government-terminology translation
 * prompt from baseProvider.ts.
 */
cpRouter.post('/translate-text', requirePermission('AI_ANALYZE'), async (req, res) => {
  const S = z.object({
    text: z.string().min(1).max(3000),
    to: z.enum(['ta', 'en']),
  });
  const parsed = S.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'text and to are required' }); return; }

  const { text, to } = parsed.data;
  try {
    const result = await translateText(text, to);
    res.json(result);
  } catch (e) {
    res.status(503).json({
      error: 'Translation unavailable.',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});



// =================================================== OFFICER ACTIONS
// =================================================== WORKFLOW STAGES
/*
 * The office procedure a petition moves through, and where this one has got to.
 *
 * The SEQUENCE is the office's standing procedure and is the same for every
 * case, so it is declared once in workflowStages.ts rather than inferred per
 * petition. What is per-petition is the POSITION, and that moves only when an
 * officer records it.
 */
cpRouter.get('/petitions/:id/workflow', requirePermission('PETITION_VIEW'), (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare(
    'SELECT workflow_stage, workflow_stage_at FROM cp_petition WHERE id = ?',
  ).get(id) as any;
  if (!p) { res.status(404).json({ error: 'Petition not found' }); return; }

  const history = db.prepare(`
    SELECT h.id, h.from_stage, h.to_stage, h.note, h.created_at, u.full_name AS changed_by
      FROM cp_workflow_history h
      LEFT JOIN app_user u ON u.id = h.changed_by
     WHERE h.petition_id = ?
     ORDER BY h.id
  `).all(id) as any[];

  res.json({
    stages: WORKFLOW_STAGES,
    current: currentStage(p.workflow_stage),
    /*
     * Whether any officer has actually recorded a movement.
     *
     * A petition with no history sits at the first stage because nothing has
     * happened yet, not because the first stage is complete - and the console
     * must show those two states differently.
     */
    started: !!p.workflow_stage,
    changed_at: p.workflow_stage_at ?? null,
    history,
  });
});

/** Record that the case has moved. Officer action only; never automatic. */
cpRouter.patch('/petitions/:id/workflow', requirePermission('AI_ANALYZE'), (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare(
    'SELECT workflow_stage FROM cp_petition WHERE id = ?',
  ).get(id) as any;
  if (!p) { res.status(404).json({ error: 'Petition not found' }); return; }

  const S = z.object({
    stage: z.string().min(2).max(40),
    note: z.string().max(500).optional(),
  });
  const parsed = S.safeParse(req.body);
  if (!parsed.success || !isStage(parsed.data.stage)) {
    res.status(400).json({ error: 'A valid workflow stage is required' });
    return;
  }

  const from = p.workflow_stage ?? null;
  const to = parsed.data.stage;
  if (from === to) {
    res.json({ current: to, unchanged: true });
    return;
  }

  /*
   * Moving BACKWARDS is allowed, and recorded.
   *
   * A case genuinely returns to an earlier desk - a Collector sends a file
   * back for a fuller report - and refusing that would force officers to keep
   * the true position outside the system. The history row shows the direction,
   * so a correction is visible rather than hidden.
   */
  tx(() => {
    db.prepare(`
      UPDATE cp_petition
         SET workflow_stage = ?, workflow_stage_at = datetime('now'),
             updated_at = datetime('now')
       WHERE id = ?
    `).run(to, id);

    db.prepare(`
      INSERT INTO cp_workflow_history (petition_id, from_stage, to_stage, note, changed_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, from, to, parsed.data.note ?? null, req.user!.id);
  });

  audit(req, req.user!, {
    action: 'CP_WORKFLOW_STAGE_CHANGED', entityType: 'cp_petition', entityId: id,
    petitionId: id,
    oldValue: { stage: from },
    newValue: { stage: to, note: parsed.data.note ?? null },
  });

  // The dashboard and any open detail view follow the same live stream.
  publish('petition:update', { id, workflow_stage: to });

  res.json({
    current: to,
    previous: from,
    backwards: stageIndex(to) < stageIndex(from),
  });
});

cpRouter.patch('/petitions/:id', requirePermission('AI_ANALYZE'), (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM cp_petition WHERE id = ?').get(id) as any;
  if (!p) { res.status(404).json({ error: 'Petition not found' }); return; }

  const S = z.object({
    status: z.enum(['SUBMITTED', 'ANALYSED', 'UNDER_REVIEW', 'ACTIONED', 'CLOSED']).optional(),
    officer_notes: z.string().optional(),
    officer_verified: z.boolean().optional(),
  });
  const parsed = S.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed' }); return; }
  const d = parsed.data;

  const sets: string[] = []; const params: unknown[] = [];
  if (d.status) { sets.push('status = ?'); params.push(d.status); }
  if (d.officer_notes !== undefined) { sets.push('officer_notes = ?'); params.push(d.officer_notes); }
  if (d.officer_verified !== undefined) {
    sets.push('officer_verified = ?', 'verified_by = ?', "verified_at = datetime('now')");
    params.push(d.officer_verified ? 1 : 0, req.user!.id);
  }
  if (!sets.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  sets.push("updated_at = datetime('now')");

  db.prepare(`UPDATE cp_petition SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);

  audit(req, req.user!, {
    action: d.officer_verified ? 'CP_ANALYSIS_VERIFIED' : 'CP_PETITION_UPDATED',
    entityType: 'cp_petition', entityId: id,
    oldValue: { status: p.status }, newValue: d,
  });

  publish('petition:update', { id, ...d });
  res.json({ ok: true });
});

/** Which OCR engines and language models are available on this server. */
cpRouter.get('/ocr-engines', async (_req, res) => {
  try {
    const engines = await availableEngines();
    res.json({
      engines,
      note: [
        engines.tesseract.available
          ? `Tesseract: ${engines.tesseract.tamil ? 'Tamil+English' : 'English only'} model installed.`
          : 'Tesseract: no language models found.',
        engines.paddle.available
          ? `PaddleOCR: v${engines.paddle.version} available.`
          : 'PaddleOCR: not installed (pip install paddlepaddle paddleocr).',
      ].join(' '),
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not determine engine availability.' });
  }
});

/** @deprecated Use /ocr-engines instead. */
cpRouter.get('/ocr-languages', (_req, res) => {
  const a = availableLanguages();
  res.json({
    ...a,
    note: a.tamil
      ? 'Tamil and English documents are both read using the combined tam+eng model.'
      : 'The Tamil model is not installed. A Tamil document cannot be read correctly.',
  });
});


// =================================================== DASHBOARD STATS
cpRouter.get('/stats', requirePermission('PETITION_VIEW'), (req, res) => {
  const isOfficer = req.user!.permissions.includes('AI_ANALYZE');
  const base = "IFNULL(origin, 'PETITION') = 'PETITION'";
  const scope = isOfficer ? `WHERE ${base}` : `WHERE ${base} AND citizen_user_id = ?`;
  const params = isOfficer ? [] : [req.user!.id];

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN analysis_status = 'PENDING' THEN 1 ELSE 0 END) AS awaiting_analysis,
      SUM(CASE WHEN analysis_status = 'COMPLETED' THEN 1 ELSE 0 END) AS analysed,
      SUM(CASE WHEN officer_verified = 1 THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed
    FROM cp_petition
    ${scope}
  `).get(...params) as any;

  res.json({
    total: row?.total ?? 0,
    awaiting_analysis: row?.awaiting_analysis ?? 0,
    analysed: row?.analysed ?? 0,
    verified: row?.verified ?? 0,
    closed: row?.closed ?? 0,
  });
});
