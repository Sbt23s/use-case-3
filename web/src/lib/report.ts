import type { jsPDF } from 'jspdf';
import { transliterate, hasTamil } from './translit';

/**
 * Official analysis report.
 *
 * Produces a print-ready A4 document in the shape of a government letter:
 * emblem centred in the header, department line, a ruled title block, then the
 * particulars, the classification, the recommended action and the workflow,
 * each in a labelled section. Page numbers and a verification footer appear on
 * every sheet.
 *
 * LANGUAGE. The report is produced in the language the console is set to, in
 * full: labels, headings, values and the footer. A Tamil console produces a
 * Tamil report with no English in it, and an English console the reverse.
 *
 * Tamil needs a real Unicode font - jsPDF's built-in fonts are Latin-1 and
 * would draw Tamil as blank boxes. Noto Sans Tamil (SIL Open Font License) is
 * therefore fetched at download time and embedded in the file. It is loaded
 * ONLY when a Tamil report is requested, so an English download costs nothing,
 * and it is cached after the first use. If the font cannot be fetched the
 * report is still produced, transliterated into Latin, and says so on its face
 * - a report that silently lost the petitioner's name would be worse.
 *
 * THE EMBLEM. No official emblem file ships with this build, so the header
 * draws a neutral placeholder mark. Dropping a real file at
 * `web/public/gov-emblem.png` replaces it automatically - an approximation of a
 * state emblem is not something to invent.
 */

export type ReportLang = 'ta' | 'en';

/**
 * Every fixed string the report prints, in both languages.
 *
 * Kept here rather than read from the console's phrase book because a report is
 * a document that outlives the session that produced it: its wording should not
 * change when a UI label is reworded.
 */
const L: Record<string, { en: string; ta: string }> = {
  govt:        { en: 'GOVERNMENT OF TAMIL NADU', ta: 'தமிழ்நாடு அரசு' },
  dept:        { en: 'Grievance Redressal - Office of the Grievance Officer',
                 ta: 'குறைதீர்ப்பு - குறைதீர்ப்பு அலுவலர் அலுவலகம்' },
  title:       { en: 'PETITION ANALYSIS REPORT', ta: 'மனு பகுப்பாய்வு அறிக்கை' },
  portal:      { en: 'Grievance Management Portal', ta: 'குறைதீர்ப்பு மேலாண்மை வாயில்' },
  portalSub:   { en: 'AI-Assisted Grievance Processing - Officer Console',
                 ta: 'AI உதவியுடன் குறைதீர்ப்பு செயலாக்கம் - அலுவலர் பணியகம்' },
  generated:   { en: 'Generated', ta: 'உருவாக்கப்பட்டது' },
  confidence:  { en: 'AI confidence', ta: 'AI நம்பகத்தன்மை' },
  notStated:   { en: 'Not stated in the document', ta: 'ஆவணத்தில் குறிப்பிடப்படவில்லை' },
  translit:    { en: '(transliterated)', ta: '(ஒலிபெயர்ப்பு)' },
  fromDoc:     { en: '(read from the document)', ta: '(ஆவணத்திலிருந்து படிக்கப்பட்டது)' },
  readWith:    { en: 'Text read with', ta: 'உரை படிக்கப்பட்ட நம்பகத்தன்மை' },
  aiSummary:   { en: 'AI summary', ta: 'AI சுருக்கம்' },
  noSummary:   { en: 'No summary was produced.', ta: 'சுருக்கம் உருவாக்கப்படவில்லை.' },
  matter:      { en: 'Matter', ta: 'விவகாரம்' },
  request:     { en: 'Petitioner request', ta: 'மனுதாரர் கோரிக்கை' },
  classify:    { en: 'Government classification', ta: 'அரசு வகைப்பாடு' },
  actRule:     { en: 'Act / Rule', ta: 'சட்டம் / விதி' },
  notIdentVerify: {
    en: 'Not identified - requires officer verification',
    ta: 'அடையாளம் காணப்படவில்லை - அதிகாரி சரிபார்ப்பு தேவை',
  },
  notDetermined: { en: 'Could not be determined', ta: 'தீர்மானிக்க முடியவில்லை' },
  priorityWhy: { en: 'Priority reason', ta: 'முன்னுரிமைக் காரணம்' },
  recWorkflow: { en: 'Recommended workflow', ta: 'பரிந்துரைக்கப்பட்ட நடைமுறை' },
  reqDocs:     { en: 'Required documents', ta: 'தேவையான ஆவணங்கள்' },
  missingInfo: { en: 'Information not found in the document',
                 ta: 'ஆவணத்தில் காணப்படாத தகவல்' },
  howReached:  { en: 'How this conclusion was reached',
                 ta: 'இந்த முடிவு எவ்வாறு எட்டப்பட்டது' },
  textRead:    { en: 'Text read from the document', ta: 'ஆவணத்திலிருந்து படிக்கப்பட்ட உரை' },
  textNoteUni: {
    en: 'Reproduced as read from the document. The original is held in the portal.',
    ta: 'ஆவணத்திலிருந்து படிக்கப்பட்டவாறு மீள்பதிவு. மூலம் வாயிலில் உள்ளது.',
  },
  textNoteLat: {
    en: 'Reproduced as read. Tamil is transliterated into Latin letters here because the '
      + 'PDF fonts available cannot draw Tamil script; the original is held in the portal.',
    ta: 'படிக்கப்பட்டவாறு மீள்பதிவு. தமிழ் எழுத்துரு கிடைக்காததால் தமிழ் உரை லத்தீன் எழுத்தில் '
      + 'உள்ளது; மூலம் வாயிலில் உள்ளது.',
  },
  textTamilOnly: {
    en: 'The document is entirely in Tamil script; see the portal for the text read.',
    ta: 'ஆவணம் முழுவதும் தமிழ் எழுத்தில் உள்ளது; படிக்கப்பட்ட உரைக்கு வாயிலைப் பார்க்கவும்.',
  },
  textUnreadable: {
    en: 'The text stored in this document could not be read reliably - its embedded font does '
      + 'not map to readable characters. The analysis above was produced from what could be '
      + 'recovered. Please consult the original document, held in the portal.',
    ta: 'இந்த ஆவணத்தில் உள்ள உரையை நம்பகமாகப் படிக்க முடியவில்லை. '
      + 'மேலுள்ள பகுப்பாய்வு மீட்கப்பட்டதிலிருந்து உருவாக்கப்பட்டது. '
      + 'வாயிலில் உள்ள மூல ஆவணத்தைப் பார்க்கவும்.',
  },
  VERIFIED:      { en: 'VERIFIED', ta: 'சரிபார்க்கப்பட்டது' },
  AUTO_VERIFIED: { en: 'AUTO-VERIFIED', ta: 'தானாக சரிபார்க்கப்பட்டது' },
  UNVERIFIED:    { en: 'UNVERIFIED', ta: 'சரிபார்க்கப்படவில்லை' },
  officer:     { en: 'Officer', ta: 'அலுவலர்' },
  copilot:     { en: 'e-Gov Copilot', ta: 'மின்-ஆளுமை உதவியாளர்' },
  convFooter:  { en: 'AI-assisted advice - requires officer verification before action.',
                 ta: 'AI உதவியுடன் அளிக்கப்பட்ட ஆலோசனை - நடவடிக்கைக்கு முன் அலுவலர் சரிபார்ப்பு தேவை.' },
  signature:   { en: 'Signature of the Grievance Officer',
                 ta: 'குறைதீர்ப்பு அலுவலர் கையொப்பம்' },
  footerNote:  { en: 'AI-assisted recommendation - requires officer verification before action.',
                 ta: 'AI உதவியுடன் கூடிய பரிந்துரை - நடவடிக்கைக்கு முன் அலுவலர் சரிபார்ப்பு தேவை.' },
  convTitle:   { en: 'e-GOV COPILOT - CONVERSATION RECORD',
                 ta: 'மின்-ஆளுமை உதவியாளர் - உரையாடல் பதிவு' },
  reference:   { en: 'Reference', ta: 'மனு எண்' },
  status:      { en: 'Status', ta: 'நிலை' },
  subject:     { en: 'Subject', ta: 'பொருள்' },
  particulars: { en: 'PETITIONER PARTICULARS', ta: 'மனுதாரர் விவரங்கள்' },
  name:        { en: 'Name', ta: 'பெயர்' },
  phone:       { en: 'Phone', ta: 'தொலைபேசி' },
  address:     { en: 'Address', ta: 'முகவரி' },
  received:    { en: 'Received', ta: 'பெறப்பட்டது' },
  docDate:     { en: 'Date on document', ta: 'ஆவணத்தின் தேதி' },
  docRef:      { en: 'Document reference', ta: 'ஆவண குறிப்பு' },
  document:    { en: 'Document', ta: 'ஆவணம்' },
  analysis:    { en: 'AI ANALYSIS', ta: 'AI பகுப்பாய்வு' },
  summary:     { en: 'Summary', ta: 'சுருக்கம்' },
  mainIssue:   { en: 'Main issue', ta: 'முதன்மைப் பிரச்சினை' },
  act:         { en: 'Act', ta: 'சட்டம்' },
  section:     { en: 'Section', ta: 'பிரிவு' },
  verifStatus: { en: 'Verification status', ta: 'சரிபார்ப்பு நிலை' },
  department:  { en: 'Department', ta: 'துறை' },
  authority:   { en: 'Authority', ta: 'அதிகாரி' },
  jurisdiction:{ en: 'Jurisdiction', ta: 'அதிகார வரம்பு' },
  priority:    { en: 'Priority', ta: 'முன்னுரிமை' },
  action:      { en: 'RECOMMENDED ACTION', ta: 'பரிந்துரைக்கப்பட்ட நடவடிக்கை' },
  workflow:    { en: 'WORKFLOW', ta: 'நடைமுறை' },
  reasoning:   { en: 'REASONING', ta: 'காரண விளக்கம்' },
  docText:     { en: 'DOCUMENT TEXT', ta: 'ஆவண உரை' },
  question:    { en: 'Question', ta: 'கேள்வி' },
  answer:      { en: 'Answer', ta: 'பதில்' },
  page:        { en: 'Page', ta: 'பக்கம்' },
  notIdent:    { en: 'Not identified', ta: 'அடையாளம் காணப்படவில்லை' },
  verifyNote:  {
    en: 'AI-generated. Verify against the official source before acting.',
    ta: 'AI உருவாக்கியது. நடவடிக்கைக்கு முன் அதிகாரப்பூர்வ ஆதாரத்துடன் சரிபார்க்கவும்.',
  },
  translitNote: {
    en: 'Tamil text is transliterated into Latin: the Tamil font could not be loaded.',
    ta: 'தமிழ் எழுத்துரு ஏற்ற முடியவில்லை; தமிழ் உரை லத்தீன் எழுத்தில் உள்ளது.',
  },
};

/**
 * The embedded Tamil font, fetched once per session.
 *
 * `null` means it was tried and failed, so the report falls back to
 * transliteration rather than retrying on every page.
 */
let tamilFont: string | null | undefined;

async function loadTamilFont(): Promise<string | null> {
  if (tamilFont !== undefined) return tamilFont;
  try {
    const res = await fetch('/fonts/NotoSansTamil-Regular.ttf');
    if (!res.ok) throw new Error(String(res.status));
    const buf = new Uint8Array(await res.arrayBuffer());
    // Chunked so a 340 KB font does not blow the argument limit.
    let bin = '';
    for (let i = 0; i < buf.length; i += 8192) {
      bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    }
    tamilFont = btoa(bin);
  } catch {
    tamilFont = null;
  }
  return tamilFont;
}

const A4 = { w: 210, h: 297 };
const M = { l: 18, r: 18, top: 16, bottom: 18 };
const CONTENT_W = A4.w - M.l - M.r;

/**
 * Render text with the Latin-1 fonts jsPDF provides.
 *
 * Tamil cannot be drawn by those fonts, so it is TRANSLITERATED rather than
 * dropped: a report that silently lost the petitioner's name would be worse
 * than one carrying a Latin rendering of it. The Tamil original stays in the
 * portal, and the report says on its face that names were transliterated.
 */
function latin(s: unknown): string {
  const src = hasTamil(s) ? transliterate(s) : String(s ?? '');
  return String(src)
    .replace(/[஀-௿‌‍]/g, '')   // Tamil + zero-width joiners
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Install the Tamil font when the report needs it.
 *
 * Returns whether real Unicode rendering is available. An English report never
 * loads it; a Tamil report that cannot fetch it falls back to transliteration
 * and says so on the first page.
 */
async function installFont(doc: jsPDF, lang: ReportLang): Promise<boolean> {
  if (lang !== 'ta') return false;
  const b64 = await loadTamilFont();
  if (!b64) return false;
  try {
    doc.addFileToVFS('NotoSansTamil.ttf', b64);
    doc.addFont('NotoSansTamil.ttf', 'NotoTamil', 'normal');
    // The variable font has no separate bold file; jsPDF needs the mapping to
    // exist so `setFont(..., 'bold')` does not silently fall back to Latin-1.
    doc.addFont('NotoSansTamil.ttf', 'NotoTamil', 'bold');
    return true;
  } catch {
    return false;
  }
}

/**
 * Which font family to draw with.
 *
 * Helvetica cannot draw Tamil, and Noto Sans Tamil covers Latin too, so a Tamil
 * report uses one family throughout rather than switching per string.
 */
function fonts(unicode: boolean) {
  const family = unicode ? 'NotoTamil' : 'helvetica';
  return {
    normal: () => [family, 'normal'] as const,
    bold: () => [family, 'bold'] as const,
  };
}

/**
 * Render a value in the report's language.
 *
 * A bilingual value is taken from the matching half. A single-language string
 * is used as it stands - the caller has already chosen it - except that Tamil
 * is transliterated when no Unicode font could be loaded, so the name still
 * appears rather than printing as blank boxes.
 */
function text(lang: ReportLang, unicode: boolean) {
  return (v: any, fallback = ''): string => {
    if (v == null || v === '') return fallback;
    const raw = typeof v === 'string'
      ? v
      : String((lang === 'ta' ? (v.ta || v.en) : (v.en || v.ta)) ?? '');
    if (!raw) return fallback;
    // Tamil with a real font: print it as written.
    if (unicode) return raw.replace(/\s{2,}/g, ' ').trim();
    return latin(raw) || fallback;
  };
}

/** English half of a bilingual value; the PDF is an English document. */
function en(v: any, fallback = 'Not identified'): string {
  if (!v) return fallback;
  if (typeof v === 'string') return latin(v) || fallback;
  return latin(v.en || v.ta) || fallback;
}

export interface ReportInput {
  referenceNo: string;
  subject?: string;
  status?: string;
  receivedAt?: string;
  /** Petitioner particulars, entered or read from the document. */
  petitioner?: {
    name?: string | null; phone?: string | null; address?: string | null;
    language?: string | null;
  };
  extracted?: Record<string, any> | null;
  document?: {
    id?: number;
    file_name?: string; mime_type?: string;
    ocr_status?: string; ocr_confidence?: number | null;
    extracted_text?: string | null;
  } | null;
  /**
   * The original file, so it can be appended to the report.
   *
   * An image is placed on its own page, fitted to the sheet. A PDF cannot be
   * merged by jsPDF, so the report records that it accompanies the file rather
   * than pretending to contain it - see `appendOriginal`.
   */
  originalFile?: Blob | null;
  analysis?: any;
  /** The console's language. The whole report is produced in it. */
  lang?: ReportLang;
}

export async function buildAnalysisReport(input: ReportInput): Promise<jsPDF> {
  // Loaded on demand - the library is large and only needed here.
  const { jsPDF: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  let y = M.top;
  let page = 1;

  const lang: ReportLang = input.lang === 'ta' ? 'ta' : 'en';
  const unicode = await installFont(doc, lang);
  const F = fonts(unicode);
  const tx = text(lang, unicode);
  const lbl = (k: string) => tx(L[k]);

  const emblem = await loadEmblem();

  // ---------------------------------------------------------------- helpers
  const footer = () => {
    doc.setDrawColor(190);
    doc.setLineWidth(0.2);
    doc.line(M.l, A4.h - M.bottom + 4, A4.w - M.r, A4.h - M.bottom + 4);
    doc.setFont(...F.normal());
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(lbl('footerNote'), M.l, A4.h - M.bottom + 9);
    doc.text(`${lbl('page')} ${page}`, A4.w - M.r, A4.h - M.bottom + 9, { align: 'right' });
    doc.setTextColor(0);
  };

  const newPage = () => {
    footer();
    doc.addPage();
    page++;
    y = M.top;
  };

  /** Reserve vertical space, starting a page when the sheet is full. */
  const need = (mm: number) => {
    if (y + mm > A4.h - M.bottom) newPage();
  };

  const sectionTitle = (title: string) => {
    need(14);
    y += 3;
    doc.setFillColor(242, 249, 244);
    doc.rect(M.l, y - 4.2, CONTENT_W, 7, 'F');
    doc.setFont(...F.bold());
    doc.setFontSize(9.5);
    doc.setTextColor(19, 88, 48);
    doc.text(title.toUpperCase(), M.l + 2.5, y);
    doc.setTextColor(0);
    y += 7;
  };

  /** A label/value row, wrapping the value and keeping the label aligned. */
  const row = (label: string, value: string) => {
    const labelW = 48;
    const lines = doc.splitTextToSize(value || '-', CONTENT_W - labelW - 2);
    need(lines.length * 4.6 + 2);
    doc.setFont(...F.bold());
    doc.setFontSize(9);
    doc.setTextColor(70);
    doc.text(label, M.l + 1, y);
    doc.setFont(...F.normal());
    doc.setTextColor(0);
    doc.text(lines, M.l + labelW, y);
    y += lines.length * 4.6 + 1.6;
  };

  const paragraph = (text: string) => {
    const lines = doc.splitTextToSize(text || '-', CONTENT_W - 2);
    need(lines.length * 4.6 + 2);
    doc.setFont(...F.normal());
    doc.setFontSize(9.5);
    doc.text(lines, M.l + 1, y);
    y += lines.length * 4.6 + 2;
  };

  const numbered = (items: string[]) => {
    items.forEach((raw, i) => {
      const lines = doc.splitTextToSize(`${i + 1}.  ${raw}`, CONTENT_W - 6);
      need(lines.length * 4.6 + 1.5);
      doc.setFont(...F.normal());
      doc.setFontSize(9.5);
      doc.text(lines, M.l + 3, y);
      y += lines.length * 4.6 + 1.2;
    });
  };

  // ----------------------------------------------------------------- header
  if (emblem) {
    // Centred, as on official correspondence.
    doc.addImage(emblem, 'PNG', A4.w / 2 - 9, y, 18, 18);
  } else {
    doc.setDrawColor(19, 88, 48);
    doc.setLineWidth(0.5);
    doc.circle(A4.w / 2, y + 9, 9);
    doc.setFont(...F.bold());
    doc.setFontSize(7);
    doc.setTextColor(19, 88, 48);
    doc.text('GOVT', A4.w / 2, y + 10.5, { align: 'center' });
    doc.setTextColor(0);
  }
  y += 22;

  doc.setFont(...F.bold());
  doc.setFontSize(13);
  doc.text(lbl('govt'), A4.w / 2, y, { align: 'center' });
  y += 5.5;
  doc.setFont(...F.normal());
  doc.setFontSize(10);
  doc.text(lbl('portal'), A4.w / 2, y, { align: 'center' });
  y += 4.6;
  doc.setFontSize(8.5);
  doc.setTextColor(95);
  doc.text(lbl('portalSub'), A4.w / 2, y, { align: 'center' });
  doc.setTextColor(0);
  y += 5;

  doc.setDrawColor(19, 88, 48);
  doc.setLineWidth(0.7);
  doc.line(M.l, y, A4.w - M.r, y);
  y += 1.2;
  doc.setLineWidth(0.25);
  doc.line(M.l, y, A4.w - M.r, y);
  y += 7;

  doc.setFont(...F.bold());
  doc.setFontSize(11.5);
  doc.text(lbl('title'), A4.w / 2, y, { align: 'center' });
  y += 7;

  // Reference block
  doc.setFillColor(248, 250, 249);
  doc.rect(M.l, y - 4.5, CONTENT_W, 13, 'F');
  doc.setFont(...F.bold());
  doc.setFontSize(9);
  doc.text(`${lbl('reference')}: ${tx(input.referenceNo)}`, M.l + 2.5, y);
  doc.setFont(...F.normal());
  doc.text(
    `${lbl('generated')}: ${new Date().toLocaleString(lang === 'ta' ? 'ta-IN' : 'en-GB')}`,
    A4.w - M.r - 2.5, y, { align: 'right' },
  );
  if (input.status) {
    doc.text(`${lbl('status')}: ${tx(input.status)}`, M.l + 2.5, y + 5);
  }
  if (input.analysis?.overall_confidence != null) {
    doc.text(
      `${lbl('confidence')}: ${Math.round(input.analysis.overall_confidence * 100)}%`,
      A4.w - M.r - 2.5, y + 5, { align: 'right' },
    );
  }
  y += 14;

  // ------------------------------------------------------------- particulars
  sectionTitle(lbl('particulars'));
  const ex = input.extracted ?? {};
  /*
   * With a Unicode font a Tamil name prints as written. Without one it is
   * TRANSLITERATED and labelled as such, so the reader knows the portal holds
   * the original spelling - an official report must not silently drop the
   * petitioner's name.
   */
  const TA = /[஀-௿]/;
  const pick = (entered: unknown, field: string) => {
    const raw = String(entered ?? '').trim() || String(ex?.[field]?.value ?? '').trim();
    if (!raw) return lbl('notStated');
    const rendered = tx(raw);
    if (!rendered) return lbl('notStated');
    const note = !unicode && TA.test(raw) ? ` ${lbl('translit')}` : '';
    const fromDoc = !String(entered ?? '').trim() && !!ex?.[field]?.value;
    return `${rendered}${note}${fromDoc ? `  ${lbl('fromDoc')}` : ''}`;
  };
  row(lbl('name'), pick(input.petitioner?.name, 'name'));
  row(lbl('phone'), pick(input.petitioner?.phone, 'phone'));
  row(lbl('address'), pick(input.petitioner?.address, 'address'));
  row(lbl('received'), tx(input.receivedAt) || '-');
  if (ex?.document_date?.value) row(lbl('docDate'), tx(ex.document_date.value));
  if (ex?.reference?.value) row(lbl('docRef'), tx(ex.reference.value));
  if (input.document?.file_name) row(lbl('document'), tx(input.document.file_name));
  if (input.document?.ocr_confidence != null) {
    row(lbl('readWith'), `${Math.round(input.document.ocr_confidence * 100)}%`);
  }

  const a = input.analysis;
  if (a) {
    // ------------------------------------------------------------- summary
    sectionTitle(lbl('aiSummary'));
    paragraph(tx(a.summary, lbl('noSummary')));

    sectionTitle(lbl('matter'));
    row(lbl('mainIssue'), tx(a.main_issue, lbl('notIdent')));
    row(lbl('request'), tx(a.petitioner_request, lbl('notIdent')));

    // ------------------------------------------------------ classification
    sectionTitle(lbl('classify'));
    row(lbl('actRule'), a.act?.id ? tx(a.act.short_name) : lbl('notIdent'));
    if (a.act?.verification_status) {
      // An enum code, not prose: mapped here so a Tamil report does not print
      // the literal word "UNVERIFIED".
      const vs = String(a.act.verification_status);
      row(lbl('verifStatus'), L[vs] ? lbl(vs) : tx(vs));
    }
    row(
      lbl('section'),
      a.act?.section_no
        ? `${tx(a.act.section_no)}${a.act.section_heading ? ` - ${tx(a.act.section_heading)}` : ''}`
        : lbl('notIdentVerify'),
    );
    row(lbl('department'), a.department?.id ? tx(a.department.name) : lbl('notDetermined'));
    row(
      lbl('authority'),
      a.authority?.id
        ? `${tx(a.authority.designation)}${a.authority.office_name ? `, ${tx(a.authority.office_name)}` : ''}`
        : lbl('notIdent'),
    );
    if (a.authority?.jurisdiction_level) {
      row(
        lbl('jurisdiction'),
        `${tx(a.authority.jurisdiction_level)}${a.authority.jurisdiction_area ? ` - ${tx(a.authority.jurisdiction_area)}` : ''}`,
      );
    }
    row(lbl('priority'), tx(a.priority) || '-');
    if (a.priority_reason) row(lbl('priorityWhy'), tx(a.priority_reason));

    // --------------------------------------------------- recommended action
    sectionTitle(lbl('action'));
    paragraph(tx(a.next_action, lbl('notIdent')));

    if (a.workflow?.length) {
      sectionTitle(lbl('recWorkflow'));
      numbered(a.workflow.map((w: any) => tx(w)));
    }

    if (a.required_documents?.length) {
      sectionTitle(lbl('reqDocs'));
      numbered(a.required_documents.map((w: any) => tx(w)));
    }

    if (a.missing_information?.length) {
      sectionTitle(lbl('missingInfo'));
      numbered(a.missing_information.map((w: any) => tx(w)));
    }

    if (a.reasoning_flow?.length) {
      sectionTitle(lbl('howReached'));
      a.reasoning_flow.forEach((s: any) => row(tx(s.step), tx(s.value)));
    }
  }

  // ------------------------------------------------------- text read
  /*
   * Only reproduce text that is actually readable.
   *
   * A PDF with a damaged embedded font yields real characters in meaningless
   * sequences, and printing them filled a section of an official report with
   * ".. _ , ( - 2007) : ...., ..0018;2026/1". That is worse than omitting it:
   * it looks like the document said something it did not. When the extraction
   * is not legible prose, the section says so instead.
   */
  if (input.document?.extracted_text && isLegible(input.document.extracted_text)) {
    sectionTitle(lbl('textRead'));
    const note = unicode ? lbl('textNoteUni') : lbl('textNoteLat');
    doc.setFont(...F.normal());
    doc.setFontSize(8);
    doc.setTextColor(110);
    const nl = doc.splitTextToSize(note, CONTENT_W - 2);
    need(nl.length * 4 + 3);
    doc.text(nl, M.l + 1, y);
    doc.setTextColor(0);
    y += nl.length * 4 + 2;

    /*
     * With a Unicode font the document's own text prints as written; without
     * one it is transliterated, and the note above says so.
     *
     * Courier cannot draw Tamil either, so the monospaced treatment is used
     * only where the text is Latin.
     */
    const body = unicode ? tx(input.document.extracted_text) : latin(input.document.extracted_text);
    if (body) {
      if (unicode) doc.setFont(...F.normal());
      else doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      const lines = doc.splitTextToSize(body, CONTENT_W - 4);
      for (const line of lines) {
        need(4);
        doc.text(line, M.l + 2, y);
        y += 3.8;
      }
    } else {
      paragraph(lbl('textTamilOnly'));
    }
  } else if (input.document?.extracted_text) {
    // Text exists but is not legible - say so rather than print the noise.
    sectionTitle(lbl('textRead'));
    paragraph(lbl('textUnreadable'));
  }

  // ------------------------------------------------------------- signature
  need(30);
  y += 8;
  doc.setDrawColor(150);
  doc.setLineWidth(0.25);
  doc.line(A4.w - M.r - 62, y, A4.w - M.r, y);
  y += 4.5;
  doc.setFont(...F.normal());
  doc.setFontSize(8.5);
  doc.text(lbl('signature'), A4.w - M.r, y, { align: 'right' });
  y += 4.2;
  doc.setTextColor(110);
  doc.setFontSize(7.5);
  doc.text('Date: ______________________', A4.w - M.r, y, { align: 'right' });
  doc.setTextColor(0);

  // --------------------------------------------------------- the original
  await appendOriginal(doc, input, { footer, newPage, sectionTitle, paragraph });

  footer();
  return doc;
}

/**
 * Attach the original document to the report.
 *
 * An IMAGE is placed on its own annexure page, scaled to fit the sheet with
 * its aspect ratio kept - the officer gets the letter and the scan in one file.
 *
 * A PDF cannot be merged by jsPDF: it can only draw, not import another
 * document's pages. Rather than silently omitting it, the report carries an
 * annexure page naming the file and stating plainly that it accompanies this
 * report separately. A report that quietly dropped the evidence would be worse
 * than one that says where the evidence is.
 */
async function appendOriginal(
  doc: jsPDF,
  input: ReportInput,
  h: {
    footer: () => void;
    newPage: () => void;
    sectionTitle: (t: string) => void;
    paragraph: (t: string) => void;
  },
): Promise<void> {
  const blob = input.originalFile;
  const name = latin(input.document?.file_name) || 'the uploaded document';
  if (!blob) return;

  const isImage = (input.document?.mime_type ?? blob.type ?? '').startsWith('image/');

  h.newPage();
  h.sectionTitle('Annexure - original document');

  if (!isImage) {
    h.paragraph(
      `The original document "${name}" is a PDF and accompanies this report as a separate `
      + 'file. It is held against this petition in the portal and can be opened from the '
      + 'petition record. Its text, as read by the system, is reproduced above.',
    );
    return;
  }

  try {
    const dataUrl = await blobToDataUrl(blob);
    if (!dataUrl) throw new Error('unreadable');
    const dims = await imageSize(dataUrl);

    // Fit inside the page, preserving the aspect ratio.
    const maxW = A4.w - M.l - M.r;
    const maxH = A4.h - M.bottom - 60;
    const scale = Math.min(maxW / dims.w, maxH / dims.h, 1);
    const w = dims.w * scale;
    const hgt = dims.h * scale;

    doc.addImage(dataUrl, dims.type, M.l + (maxW - w) / 2, 52, w, hgt, undefined, 'FAST');

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(name, A4.w / 2, 52 + hgt + 5, { align: 'center' });
    doc.setTextColor(0);
  } catch {
    h.paragraph(
      `The original document "${name}" could not be embedded in this report. It remains `
      + 'attached to the petition in the portal.',
    );
  }
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number; type: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({
      w: img.naturalWidth,
      h: img.naturalHeight,
      type: /^data:image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG',
    });
    img.onerror = () => reject(new Error('image could not be read'));
    img.src = dataUrl;
  });
}

/**
 * Is this extracted text legible prose, or extraction noise?
 *
 * Text from a broken font arrives as a scatter of punctuation, digits and
 * stray letters with almost no real words. Requiring a reasonable proportion
 * of multi-letter words separates that from a genuine document, including one
 * that is mostly Tamil (which transliterates into real words).
 */
function isLegible(text: string): boolean {
  const rendered = latin(text);
  if (rendered.length < 40) return false;

  const words = rendered.split(/\s+/).filter(Boolean);
  if (words.length < 8) return false;

  // A "word" here is three or more letters together - what prose is made of.
  const real = words.filter((w) => /[A-Za-z]{3,}/.test(w)).length;
  return real / words.length > 0.45;
}

/**
 * Load the official emblem, when one has been supplied.
 *
 * Returns null when the file is absent so the caller can draw a neutral mark
 * instead. No emblem is generated or approximated.
 */
async function loadEmblem(): Promise<string | null> {
  try {
    const res = await fetch('/gov-emblem.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * A conversation, as a plain record for the file.
 *
 * Officers are expected to keep a note of what the assistant advised, so the
 * transcript prints as an ordinary government minute: who asked, what was
 * answered, and the same verification caveat that appears on screen.
 */
export async function buildConversationReport(input: {
  title: string;
  messages: { role: 'USER' | 'ASSISTANT'; content: string }[];
  /** The console's language. The whole record is produced in it. */
  lang?: ReportLang;
}): Promise<jsPDF> {
  const { jsPDF: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });

  const lang: ReportLang = input.lang === 'ta' ? 'ta' : 'en';
  const unicode = await installFont(doc, lang);
  const F = fonts(unicode);
  const tx = text(lang, unicode);
  const lbl = (k: string) => tx(L[k]);

  let y = M.top;
  let page = 1;

  const footer = () => {
    doc.setDrawColor(190);
    doc.setLineWidth(0.2);
    doc.line(M.l, A4.h - M.bottom + 4, A4.w - M.r, A4.h - M.bottom + 4);
    doc.setFont(...F.normal());
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(lbl('convFooter'), M.l, A4.h - M.bottom + 9);
    doc.text(`${lbl('page')} ${page}`, A4.w - M.r, A4.h - M.bottom + 9, { align: 'right' });
    doc.setTextColor(0);
  };

  const need = (mm: number) => {
    if (y + mm > A4.h - M.bottom) { footer(); doc.addPage(); page++; y = M.top; }
  };

  doc.setFont(...F.bold());
  doc.setFontSize(13);
  doc.text(lbl('govt'), A4.w / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(11);
  doc.text(tx(input.title) || lbl('convTitle'), A4.w / 2, y, { align: 'center' });
  y += 5;
  doc.setFont(...F.normal());
  doc.setFontSize(8.5);
  doc.setTextColor(95);
  doc.text(
    `${lbl('generated')} ${new Date().toLocaleString(lang === 'ta' ? 'ta-IN' : 'en-GB')}`,
    A4.w / 2, y, { align: 'center' },
  );
  doc.setTextColor(0);
  y += 5;
  doc.setDrawColor(19, 88, 48);
  doc.setLineWidth(0.6);
  doc.line(M.l, y, A4.w - M.r, y);
  y += 8;

  for (const m of input.messages) {
    const who = m.role === 'USER' ? lbl('officer') : lbl('copilot');
    const body = tx(m.content);
    if (!body) continue;

    need(10);
    doc.setFont(...F.bold());
    doc.setFontSize(9);
    doc.setTextColor(m.role === 'USER' ? 60 : 19, m.role === 'USER' ? 60 : 88, m.role === 'USER' ? 60 : 48);
    doc.text(who, M.l, y);
    doc.setTextColor(0);
    y += 4.5;

    doc.setFont(...F.normal());
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(body, CONTENT_W - 4);
    for (const line of lines) {
      need(5);
      doc.text(line, M.l + 2, y);
      y += 4.6;
    }
    y += 4;
  }

  footer();
  return doc;
}
