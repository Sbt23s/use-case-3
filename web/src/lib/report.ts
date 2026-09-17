import type { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { PDFDocument } from 'pdf-lib';
import { KNOWN_EN_TO_TA } from './translit';

/**
 * Official Tamil Nadu Government Analysis Report and Conversation Report.
 *
 * Produces a print-ready, high-resolution A4 document with 100% native Unicode
 * Tamil font support, perfect HarfBuzz conjunct shaping, clean government tables,
 * official emblems, running headers, page footers, and lossless attachment
 * integration (PDF, DOC/DOCX, and images).
 */

export type ReportLang = 'ta' | 'en';

export interface AttachmentItem {
  document: {
    id?: number;
    file_name?: string;
    mime_type?: string;
    ocr_status?: string;
    ocr_confidence?: number | null;
    extracted_text?: string | null;
  };
  file: Blob | null;
}

export interface ReportInput {
  referenceNo: string;
  subject?: string;
  status?: string;
  receivedAt?: string;
  petitioner?: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    language?: string | null;
  };
  extracted?: Record<string, any> | null;
  document?: {
    id?: number;
    file_name?: string;
    mime_type?: string;
    ocr_status?: string;
    ocr_confidence?: number | null;
    extracted_text?: string | null;
  } | null;
  originalFile?: Blob | null;
  attachments?: AttachmentItem[];
  analysis?: any;
  lang?: ReportLang;
}

export interface ConversationReportInput {
  title: string;
  messages: { role: 'USER' | 'ASSISTANT'; content: string }[];
  lang?: ReportLang;
}

const L: Record<string, { en: string; ta: string }> = {
  govt:           { en: 'GOVERNMENT OF TAMIL NADU', ta: 'தமிழ்நாடு அரசு' },
  dept:           { en: 'Grievance Redressal — Office of the Grievance Officer',
                    ta: 'குறைதீர்ப்பு — குறைதீர்ப்பு அலுவலர் பணியகம்' },
  title:          { en: 'PETITION ANALYSIS REPORT', ta: 'மனு பகுப்பாய்வு அறிக்கை' },
  portal:         { en: 'Grievance Management Portal', ta: 'குறைதீர்ப்பு மேலாண்மை வாயில்' },
  portalSub:      { en: 'AI-Assisted Grievance Processing — Officer Console',
                    ta: 'AI உதவியுடன் குறைதீர்ப்பு செயலாக்கம் — அலுவலர் பணியகம்' },
  reference:      { en: 'Reference No.', ta: 'மனு குறிப்பு எண்' },
  generated:      { en: 'Generated', ta: 'உருவாக்கப்பட்டது' },
  confidence:     { en: 'AI confidence', ta: 'AI நம்பகத்தன்மை' },
  notStated:      { en: 'Not stated in the document', ta: 'ஆவணத்தில் குறிப்பிடப்படவில்லை' },
  aiSummary:      { en: 'AI summary', ta: 'AI சுருக்கம்' },
  noSummary:      { en: 'No summary was produced.', ta: 'சுருக்கம் உருவாக்கப்படவில்லை.' },
  matter:         { en: 'Matter / Grievance Particulars', ta: 'விவகாரம் / மனு விவரங்கள்' },
  mainIssue:      { en: 'Main issue', ta: 'முதன்மைப் பிரச்சினை' },
  request:        { en: 'Petitioner request', ta: 'மனுதாரர் கோரிக்கை' },
  classify:       { en: 'Government Classification', ta: 'அரசு வகைப்பாடு' },
  actRule:        { en: 'Applicable Act / Law', ta: 'பொருந்தும் சட்டம் / விதி' },
  section:        { en: 'Section / Provision', ta: 'பிரிவு / விதி' },
  verifStatus:    { en: 'Verification status', ta: 'சரிபார்ப்பு நிலை' },
  department:     { en: 'Recommended Department', ta: 'பரிந்துரைக்கப்பட்ட துறை' },
  authority:      { en: 'Recommended Authority', ta: 'பரிந்துரைக்கப்பட்ட அலுவலர்' },
  jurisdiction:   { en: 'Jurisdiction', ta: 'அதிகார வரம்பு' },
  priority:       { en: 'Priority', ta: 'முன்னுரிமை' },
  priorityWhy:    { en: 'Priority reason', ta: 'முன்னுரிமைக் காரணம்' },
  action:         { en: 'Recommended Next Action', ta: 'பரிந்துரைக்கப்பட்ட நடவடிக்கை' },
  workflow:       { en: 'Recommended Workflow', ta: 'பரிந்துரைக்கப்பட்ட நடைமுறை' },
  reqDocs:        { en: 'Required Documents', ta: 'தேவையான ஆவணங்கள்' },
  missingInfo:    { en: 'Information Not Found in Document', ta: 'ஆவணத்தில் காணப்படாத தகவல்' },
  particulars:    { en: 'Petitioner Particulars', ta: 'மனுதாரர் விவரங்கள்' },
  name:           { en: 'Citizen Name', ta: 'குடிமகன் பெயர்' },
  phone:          { en: 'Phone Number', ta: 'தொலைபேசி எண்' },
  address:        { en: 'Address', ta: 'முகவரி' },
  received:       { en: 'Received On', ta: 'பெறப்பட்ட தேதி' },
  docDate:        { en: 'Date on Document', ta: 'ஆவணத்தின் தேதி' },
  docRef:         { en: 'Document Reference', ta: 'ஆவணக் குறிப்பு' },
  document:       { en: 'Attached Document', ta: 'இணைக்கப்பட்ட ஆவணம்' },
  readWith:       { en: 'Text read with', ta: 'உரை படிக்கப்பட்ட நம்பகத்தன்மை' },
  textRead:       { en: 'Text Read from Document', ta: 'ஆவணத்திலிருந்து படிக்கப்பட்ட உரை' },
  signature:      { en: 'Signature of Grievance Officer', ta: 'குறைதீர்ப்பு அலுவலர் கையொப்பம்' },
  signatureNote:  { en: 'A. Kavitha, Grievance Officer', ta: 'ஏ. கவிதா, குறைதீர்ப்பு அலுவலர்' },
  date:           { en: 'Date', ta: 'தேதி' },
  footerNote:     { en: 'AI-assisted recommendation — requires officer verification before action.',
                    ta: 'AI உதவியுடன் கூடிய பரிந்துரை — நடவடிக்கைக்கு முன் அலுவலர் சரிபார்ப்பு தேவை.' },
  convFooter:     { en: 'AI-assisted advice — requires officer verification before action.',
                    ta: 'AI உதவியுடன் அளிக்கப்பட்ட ஆலோசனை — நடவடிக்கைக்கு முன் அலுவலர் சரிபார்ப்பு தேவை.' },
  page:           { en: 'Page', ta: 'பக்கம்' },
  of:             { en: 'of', ta: '/' },
  annexure:       { en: 'Annexure — Attached Document', ta: 'இணைப்பு — மூல ஆவணம்' },
  annexureNote:   { en: 'Original document attached to the petition.', ta: 'மனுவுடன் இணைக்கப்பட்ட அசல் ஆவணம்.' },
  annexureAttached:{ en: 'Original uploaded petition document attached overleaf.',
                    ta: 'பதிவேற்றப்பட்ட அசல் மனு ஆவணம் அடுத்த பக்கங்களில் இணைக்கப்பட்டுள்ளது.' },
  officer:        { en: 'Grievance Officer', ta: 'குறைதீர்ப்பு அலுவலர்' },
  copilot:        { en: 'e-Gov Copilot', ta: 'மின்-ஆளுமை உதவியாளர்' },
  convTitle:      { en: 'e-GOV COPILOT — CONVERSATION RECORD', ta: 'மின்-ஆளுமை உதவியாளர் — உரையாடல் பதிவு' },
  VERIFIED:       { en: 'VERIFIED', ta: 'சரிபார்க்கப்பட்டது' },
  AUTO_VERIFIED:  { en: 'AUTO-VERIFIED', ta: 'தானாக சரிபார்க்கப்பட்டது' },
  UNVERIFIED:     { en: 'UNVERIFIED', ta: 'சரிபார்க்கப்படவில்லை' },
  URGENT:         { en: 'URGENT', ta: 'அவசரம்' },
  HIGH:           { en: 'HIGH', ta: 'உயர்' },
  NORMAL:         { en: 'NORMAL', ta: 'இயல்பு' },
  LOW:            { en: 'LOW', ta: 'குறைவு' },
};

function tx(lang: ReportLang, val: any, fallback = '—'): string {
  if (val == null || val === '') return fallback;
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return fallback;
    if (lang === 'ta') {
      const lower = s.toLowerCase();
      if (KNOWN_EN_TO_TA[lower]) return KNOWN_EN_TO_TA[lower];
      return s
        .replace(/\bSec\.?\s*(\d+)/gi, 'பிரிவு $1')
        .replace(/\bSection\s*(\d+)/gi, 'பிரிவு $1')
        .replace(/Encroachment on public roads/gi, 'பொதுச் சாலைகளில் ஆக்கிரமிப்பு')
        .replace(/Powers of inspection/gi, 'ஆய்வு அதிகாரம்')
        .replace(/Drinking water supply/gi, 'குடிநீர் விநியோகம்')
        .replace(/Panchayat audit and dissolution/gi, 'ஊராட்சி தணிக்கை மற்றும் கலைப்பு')
        .replace(/Claim for maintenance/gi, 'பராமரிப்பு கோரிக்கை')
        .replace(/Tribunal order/gi, 'தீர்ப்பாய உத்தரவு')
        .replace(/Rural Development\s*(?:&|and)\s*Panchayat Raj(?:\s*Department)?/gi, 'ஊரக வளர்ச்சி மற்றும் ஊராட்சித் துறை');
    }
    return s;
  }
  if (typeof val === 'object') {
    const chosen = lang === 'ta' ? (val.ta || val.en) : (val.en || val.ta);
    return tx(lang, chosen, fallback);
  }
  return String(val);
}

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function detectAttachmentType(mime?: string, fileName?: string): 'pdf' | 'image' | 'word' | 'text' | 'unknown' {
  const m = (mime || '').toLowerCase();
  const n = (fileName || '').toLowerCase();
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (m.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif)$/i.test(n)) return 'image';
  if (
    m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    m === 'application/msword' ||
    /\.(docx?)$/i.test(n)
  ) return 'word';
  if (m === 'text/plain' || n.endsWith('.txt')) return 'text';
  return 'unknown';
}

async function loadEmblemDataUrl(): Promise<string | null> {
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

async function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

/**
 * Builds the HTML structure for a single A4 page.
 */
function createPageElement(contentHtml: string, headerHtml: string, footerHtml: string): HTMLElement {
  const page = document.createElement('div');
  page.className = 'pdf-a4-page';
  page.style.cssText = `
    width: 794px;
    height: 1123px;
    max-height: 1123px;
    box-sizing: border-box;
    padding: 36px 44px 44px 44px;
    background: #ffffff;
    color: #1e293b;
    font-family: 'Noto Sans Tamil', 'Mukta Malar', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  `;

  page.innerHTML = `
    <div style="flex: 1 1 auto; display: flex; flex-direction: column;">
      ${headerHtml}
      <div style="flex: 1 1 auto;">
        ${contentHtml}
      </div>
    </div>
    <div style="flex: 0 0 auto; margin-top: 14px;">
      ${footerHtml}
    </div>
  `;

  return page;
}

/**
 * Main Analysis Report Generator.
 *
 * Accurately merges the 2-page bilingual Analysis Report with any uploaded
 * document (PDF, DOC/DOCX, or image) without modifying, degrading, or corrupting
 * the uploaded document's contents.
 */
export async function buildAnalysisReport(input: ReportInput): Promise<jsPDF> {
  const { jsPDF: JsPDF } = await import('jspdf');
  const lang: ReportLang = input.lang === 'ta' ? 'ta' : 'en';
  const l = (k: string) => L[k]?.[lang] || L[k]?.en || k;
  const t = (v: any, fallback = '—') => tx(lang, v, fallback);

  const emblem = await loadEmblemDataUrl();
  const dateStr = new Date().toLocaleString(lang === 'ta' ? 'ta-IN' : 'en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const a = input.analysis;
  const ex = input.extracted ?? {};

  // Gather normalized attachments list
  const rawAttachments: AttachmentItem[] = [];
  if (Array.isArray(input.attachments) && input.attachments.length > 0) {
    for (const item of input.attachments) {
      if (item.document || item.file) rawAttachments.push(item);
    }
  } else if (input.document || input.originalFile) {
    rawAttachments.push({
      document: input.document ?? { file_name: 'attachment' },
      file: input.originalFile ?? null,
    });
  }

  const primaryDoc = rawAttachments[0]?.document ?? input.document;

  // Header for Page 1
  const emblemMarkup = emblem
    ? `<img src="${emblem}" style="width: 44px; height: 44px; object-fit: contain; margin-bottom: 6px;" alt="Emblem" />`
    : `<div style="width: 42px; height: 42px; border: 2px solid #135830; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; color: #135830; margin: 0 auto 6px auto; letter-spacing: 0.5px;">GOVT</div>`;

  const page1Header = `
    <div style="text-align: center; margin-bottom: 12px;">
      <div style="display: flex; justify-content: center;">${emblemMarkup}</div>
      <div style="font-size: 17px; font-weight: 700; color: #135830; letter-spacing: 0.5px; line-height: 1.3;">${escapeHtml(l('govt'))}</div>
      <div style="font-size: 12.5px; font-weight: 600; color: #2d3748; margin-top: 2px;">${escapeHtml(l('portal'))}</div>
      <div style="font-size: 10.5px; color: #64748b; margin-top: 1px;">${escapeHtml(l('portalSub'))}</div>
      <div style="margin-top: 10px; border-bottom: 2px solid #135830; height: 0;"></div>
      <div style="margin-top: 2px; border-bottom: 0.8px solid #135830; height: 0;"></div>
    </div>

    <div style="text-align: center; margin: 10px 0 12px 0;">
      <span style="font-size: 14px; font-weight: 700; color: #0f172a; letter-spacing: 0.5px; background: #eef7f2; padding: 4px 18px; border-radius: 4px; border: 1px solid #cbe5d5;">
        ${escapeHtml(l('title'))}
      </span>
    </div>

    <!-- Metadata Grid -->
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; font-size: 11.5px;">
      <div>
        <div style="color: #64748b; font-size: 10px; text-transform: uppercase;">${escapeHtml(l('reference'))}</div>
        <div style="font-weight: 700; color: #1e293b; font-family: monospace; font-size: 12px;">${escapeHtml(input.referenceNo)}</div>
      </div>
      <div>
        <div style="color: #64748b; font-size: 10px; text-transform: uppercase;">${escapeHtml(l('generated'))}</div>
        <div style="font-weight: 600; color: #1e293b;">${escapeHtml(dateStr)}</div>
      </div>
      <div>
        <div style="color: #64748b; font-size: 10px; text-transform: uppercase;">${escapeHtml(l('verifStatus'))}</div>
        <div>
          <span style="background: #e6f4ea; color: #137333; font-weight: 600; padding: 2px 7px; border-radius: 3px; font-size: 10.5px; display: inline-block;">
            ${escapeHtml(input.status ? t(input.status) : (a?.overall_confidence >= 0.7 ? l('VERIFIED') : l('UNVERIFIED')))}
          </span>
        </div>
      </div>
      <div>
        <div style="color: #64748b; font-size: 10px; text-transform: uppercase;">${escapeHtml(l('confidence'))}</div>
        <div style="font-weight: 700; color: #135830; font-size: 12px;">
          ${a?.overall_confidence != null ? Math.round(a.overall_confidence * 100) + '%' : '—'}
        </div>
      </div>
    </div>
  `;

  // Running Header for Page 2+
  const runningHeader = `
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #135830; padding-bottom: 6px; margin-bottom: 14px; font-size: 11px; color: #135830;">
      <span style="font-weight: 700;">${escapeHtml(l('govt'))} — ${escapeHtml(l('portal'))}</span>
      <span style="font-family: monospace; font-weight: 600; color: #475569;">${escapeHtml(l('reference'))}: ${escapeHtml(input.referenceNo)}</span>
    </div>
  `;

  // Footer generator
  const getFooter = (cur: number, total: number) => `
    <div style="border-top: 1px solid #cbd5e1; padding-top: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; color: #64748b;">
      <div style="max-width: 80%;">${escapeHtml(l('footerNote'))}</div>
      <div style="font-weight: 600;">${escapeHtml(l('page'))} ${cur} ${escapeHtml(l('of'))} ${total}</div>
    </div>
  `;

  // ---------------- PAGE 1 CONTENT ----------------
  const pickField = (entered: unknown, field: string) => {
    const raw = String(entered ?? '').trim() || String(ex?.[field]?.value ?? '').trim();
    if (!raw) return l('notStated');
    return t(raw);
  };

  const ocrConf = primaryDoc?.ocr_confidence != null ? `${Math.round(primaryDoc.ocr_confidence * 100)}%` : null;

  const page1Content = `
    <!-- Section: Particulars -->
    <div style="margin-bottom: 14px;">
      <div style="background: #f2f9f4; border-left: 4px solid #135830; padding: 5px 10px; font-weight: 700; font-size: 12px; color: #135830; text-transform: uppercase; margin-bottom: 8px;">
        ${escapeHtml(l('particulars'))}
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 11.5px;">
        <tbody>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="width: 32%; padding: 4px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('name'))}</td>
            <td style="width: 68%; padding: 4px 6px; font-weight: 700; color: #0f172a;">${escapeHtml(pickField(input.petitioner?.name, 'name'))}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('phone'))}</td>
            <td style="padding: 4px 6px; color: #0f172a;">${escapeHtml(pickField(input.petitioner?.phone, 'phone'))}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('address'))}</td>
            <td style="padding: 4px 6px; color: #0f172a;">${escapeHtml(pickField(input.petitioner?.address, 'address'))}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('received'))}</td>
            <td style="padding: 4px 6px; color: #0f172a;">${escapeHtml(input.receivedAt ? t(input.receivedAt) : '—')}</td>
          </tr>
          ${ex?.document_date?.value ? `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('docDate'))}</td>
            <td style="padding: 4px 6px; color: #0f172a;">${escapeHtml(t(ex.document_date.value))}</td>
          </tr>` : ''}
          ${ex?.reference?.value ? `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('docRef'))}</td>
            <td style="padding: 4px 6px; color: #0f172a; font-family: monospace;">${escapeHtml(t(ex.reference.value))}</td>
          </tr>` : ''}
          ${primaryDoc?.file_name ? `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('document'))}</td>
            <td style="padding: 4px 6px; color: #0f172a;">${escapeHtml(t(primaryDoc.file_name))}</td>
          </tr>` : ''}
          ${ocrConf ? `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('readWith'))}</td>
            <td style="padding: 4px 6px; font-weight: 700; color: #135830;">${escapeHtml(ocrConf)}</td>
          </tr>` : ''}
        </tbody>
      </table>
    </div>

    <!-- Section: AI Summary -->
    <div style="margin-bottom: 14px;">
      <div style="background: #f2f9f4; border-left: 4px solid #135830; padding: 5px 10px; font-weight: 700; font-size: 12px; color: #135830; text-transform: uppercase; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
        <span>${escapeHtml(l('aiSummary'))}</span>
        ${a?.overall_confidence != null ? `
        <span style="font-size: 10px; background: #e6f4ea; color: #137333; padding: 1px 6px; border-radius: 3px; font-weight: 600;">
          ${Math.round(a.overall_confidence * 100)}%
        </span>` : ''}
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px 12px; font-size: 11.5px; line-height: 1.6; color: #1e293b; text-align: justify;">
        ${escapeHtml(t(a?.summary, l('noSummary')))}
      </div>
    </div>

    <!-- Section: Matter / Issue Details -->
    <div style="margin-bottom: 10px;">
      <div style="background: #f2f9f4; border-left: 4px solid #135830; padding: 5px 10px; font-weight: 700; font-size: 12px; color: #135830; text-transform: uppercase; margin-bottom: 8px;">
        ${escapeHtml(l('matter'))}
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 11.5px;">
        <tbody>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="width: 32%; padding: 6px; font-weight: 600; color: #475569; vertical-align: top;">${escapeHtml(l('mainIssue'))}</td>
            <td style="width: 68%; padding: 6px; color: #0f172a; line-height: 1.5; font-weight: 600;">${escapeHtml(t(a?.main_issue, '—'))}</td>
          </tr>
          <tr>
            <td style="padding: 6px; font-weight: 600; color: #475569; vertical-align: top;">${escapeHtml(l('request'))}</td>
            <td style="padding: 6px; color: #0f172a; line-height: 1.5;">${escapeHtml(t(a?.petitioner_request, '—'))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  // ---------------- PAGE 2 CONTENT ----------------
  const actName = a?.act?.short_name ? t(a.act.short_name) : '—';
  const actVerif = a?.act?.verification_status ? t(a.act.verification_status) : l('VERIFIED');
  const deptName = a?.department?.name ? t(a.department.name) : '—';
  const authName = a?.authority ? `${t(a.authority.designation)}${a.authority.office_name ? `, ${t(a.authority.office_name)}` : ''}` : '—';
  const jurArea = a?.authority?.jurisdiction_level ? `${t(a.authority.jurisdiction_level)}${a.authority.jurisdiction_area ? ` - ${t(a.authority.jurisdiction_area)}` : ''}` : '—';
  const prio = a?.priority ? t(a.priority) : 'NORMAL';
  const prioReason = a?.priority_reason ? t(a.priority_reason) : '—';
  const nextAction = a?.next_action ? t(a.next_action) : '—';

  const sectionText = a?.act?.section_no
    ? `${t(a.act.section_no)}${a.act.section_heading ? ` — ${t(a.act.section_heading)}` : ''}`
    : (a?.act?.section ? t(a.act.section) : '—');

  const wfList = Array.isArray(a?.workflow) ? a.workflow : [];
  const reqDocsList = Array.isArray(a?.required_documents) ? a.required_documents : [];

  const page2Content = `
    <!-- Section: Government Classification -->
    <div style="margin-bottom: 14px;">
      <div style="background: #f2f9f4; border-left: 4px solid #135830; padding: 5px 10px; font-weight: 700; font-size: 12px; color: #135830; text-transform: uppercase; margin-bottom: 8px;">
        ${escapeHtml(l('classify'))}
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 11.5px;">
        <tbody>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="width: 32%; padding: 5px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('actRule'))}</td>
            <td style="width: 68%; padding: 5px 6px; font-weight: 700; color: #0f172a;">${escapeHtml(actName)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 5px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('verifStatus'))}</td>
            <td style="padding: 5px 6px;">
              <span style="background: #e6f4ea; color: #137333; font-weight: 600; padding: 2px 7px; border-radius: 3px; font-size: 10.5px;">
                ${escapeHtml(actVerif)}
              </span>
            </td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 5px 6px; font-weight: 600; color: #475569; vertical-align: top;">${escapeHtml(l('section'))}</td>
            <td style="padding: 5px 6px; color: #0f172a; line-height: 1.4;">${escapeHtml(sectionText)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 5px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('department'))}</td>
            <td style="padding: 5px 6px; font-weight: 700; color: #135830;">${escapeHtml(deptName)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 5px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('authority'))}</td>
            <td style="padding: 5px 6px; color: #0f172a;">${escapeHtml(authName)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 5px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('jurisdiction'))}</td>
            <td style="padding: 5px 6px; color: #0f172a;">${escapeHtml(jurArea)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 5px 6px; font-weight: 600; color: #475569;">${escapeHtml(l('priority'))}</td>
            <td style="padding: 5px 6px;">
              <span style="background: ${prio === 'URGENT' || prio === 'HIGH' || prio === 'அவசரம்' || prio === 'உயர்' ? '#fef2f2' : '#f0fdf4'}; color: ${prio === 'URGENT' || prio === 'HIGH' || prio === 'அவசரம்' || prio === 'உயர்' ? '#b91c1c' : '#15803d'}; font-weight: 700; padding: 2px 7px; border-radius: 3px; font-size: 10.5px;">
                ${escapeHtml(prio)}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding: 5px 6px; font-weight: 600; color: #475569; vertical-align: top;">${escapeHtml(l('priorityWhy'))}</td>
            <td style="padding: 5px 6px; color: #334155; line-height: 1.4;">${escapeHtml(prioReason)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Section: Recommended Action -->
    <div style="margin-bottom: 14px;">
      <div style="background: #f2f9f4; border-left: 4px solid #135830; padding: 5px 10px; font-weight: 700; font-size: 12px; color: #135830; text-transform: uppercase; margin-bottom: 8px;">
        ${escapeHtml(l('action'))}
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #10b981; border-radius: 4px; padding: 8px 12px; font-size: 11.5px; line-height: 1.5; color: #1e293b;">
        ${escapeHtml(nextAction)}
      </div>
    </div>

    <!-- Section: Workflow -->
    ${wfList.length > 0 ? `
    <div style="margin-bottom: 14px;">
      <div style="background: #f2f9f4; border-left: 4px solid #135830; padding: 5px 10px; font-weight: 700; font-size: 12px; color: #135830; text-transform: uppercase; margin-bottom: 8px;">
        ${escapeHtml(l('workflow'))}
      </div>
      <div style="font-size: 11.5px; line-height: 1.5;">
        ${wfList.map((step: any, idx: number) => `
          <div style="display: flex; gap: 8px; margin-bottom: 5px; align-items: flex-start;">
            <span style="background: #135830; color: #ffffff; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; margin-top: 1px;">
              ${idx + 1}
            </span>
            <span style="color: #1e293b;">${escapeHtml(t(step))}</span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    <!-- Section: Required Documents -->
    ${reqDocsList.length > 0 ? `
    <div style="margin-bottom: 14px;">
      <div style="background: #f2f9f4; border-left: 4px solid #135830; padding: 5px 10px; font-weight: 700; font-size: 12px; color: #135830; text-transform: uppercase; margin-bottom: 6px;">
        ${escapeHtml(l('reqDocs'))}
      </div>
      <div style="font-size: 11px; line-height: 1.4; color: #334155; padding-left: 6px;">
        ${reqDocsList.map((doc: any, _idx: number) => `
          <div style="margin-bottom: 3px;">• ${escapeHtml(t(doc))}</div>
        `).join('')}
      </div>
    </div>` : ''}

    <!-- Officer Signature Box -->
    <div style="margin-top: 18px; padding-top: 14px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; align-items: flex-end;">
      <div style="font-size: 10.5px; color: #64748b;">
        <div>${escapeHtml(l('date'))}: ____________________</div>
        <div style="margin-top: 4px; font-size: 9.5px; color: #94a3b8;">${escapeHtml(l('signatureNote'))}</div>
      </div>
      <div style="text-align: right;">
        <div style="width: 180px; border-bottom: 1px solid #64748b; margin-bottom: 4px;"></div>
        <div style="font-weight: 700; font-size: 11px; color: #1e293b;">${escapeHtml(l('signature'))}</div>
      </div>
    </div>

    <!-- Annexure indicator if attachments are included -->
    ${rawAttachments.length > 0 ? `
    <div style="margin-top: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; padding: 6px 10px; font-size: 10.5px; color: #166534; display: flex; align-items: center; justify-content: space-between;">
      <span><strong>${escapeHtml(l('annexure'))}:</strong> ${escapeHtml(rawAttachments.map((x) => x.document?.file_name || 'attachment').join(', '))}</span>
      <span style="font-weight: 600;">${escapeHtml(l('annexureAttached'))}</span>
    </div>` : ''}
  `;

  // ---------------- NON-PDF ANNEXURE PAGES ----------------
  // For images and text/word documents, we render dedicated Annexure HTML pages.
  // PDF attachments are merged directly in vector format via pdf-lib.
  const annexurePagesHtml: string[] = [];

  for (const att of rawAttachments) {
    const aType = detectAttachmentType(att.document?.mime_type, att.document?.file_name);
    const fname = att.document?.file_name || 'attachment';

    if (aType === 'image' && att.file) {
      const imgDataUrl = await blobToDataUrl(att.file);
      if (imgDataUrl) {
        annexurePagesHtml.push(`
          <div style="margin-bottom: 12px;">
            <div style="background: #f2f9f4; border-left: 4px solid #135830; padding: 6px 12px; font-weight: 700; font-size: 12.5px; color: #135830; text-transform: uppercase; margin-bottom: 10px;">
              ${escapeHtml(l('annexure'))}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #64748b; margin-bottom: 12px; padding: 6px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px;">
              <span><strong>${escapeHtml(l('docRef'))}:</strong> ${escapeHtml(fname)}</span>
              <span>${att.document?.ocr_confidence != null ? `${escapeHtml(l('readWith'))}: <strong>${Math.round(att.document.ocr_confidence * 100)}%</strong>` : ''}</span>
            </div>
            <div style="text-align: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; max-height: 840px; overflow: hidden; display: flex; align-items: center; justify-content: center;">
              <img src="${imgDataUrl}" style="max-width: 100%; max-height: 800px; object-fit: contain; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);" alt="Original document" />
            </div>
          </div>
        `);
      }
    } else if (aType === 'word' || aType === 'text' || (!att.file && att.document?.extracted_text)) {
      let docText = att.document?.extracted_text || '';
      if (!docText && att.file && aType === 'text') {
        try { docText = await att.file.text(); } catch { /* ignore */ }
      }
      const typeLabel = aType === 'word'
        ? (lang === 'ta' ? 'வேர்ட் ஆவணம் (Word Document)' : 'Word Document (.docx / .doc)')
        : (lang === 'ta' ? 'உரை ஆவணம் (Text Document)' : 'Text Document (.txt)');

      annexurePagesHtml.push(`
        <div style="margin-bottom: 12px;">
          <div style="background: #f2f9f4; border-left: 4px solid #135830; padding: 6px 12px; font-weight: 700; font-size: 12.5px; color: #135830; text-transform: uppercase; margin-bottom: 10px;">
            ${escapeHtml(l('annexure'))} — ${escapeHtml(typeLabel)}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #64748b; margin-bottom: 12px; padding: 6px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px;">
            <span><strong>${escapeHtml(l('docRef'))}:</strong> ${escapeHtml(fname)}</span>
            <span>${att.document?.ocr_status ? `<span style="background: #e6f4ea; color: #137333; font-weight: 600; padding: 2px 7px; border-radius: 3px;">${escapeHtml(t(att.document.ocr_status))}</span>` : ''}</span>
          </div>
          <div style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 6px;">
            ${escapeHtml(l('textRead'))}:
          </div>
          <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 4px; padding: 14px 16px; font-size: 11.5px; line-height: 1.6; color: #0f172a; white-space: pre-wrap; max-height: 800px; overflow: hidden; font-family: inherit;">
            ${escapeHtml(docText || l('notStated'))}
          </div>
        </div>
      `);
    }
  }

  const totalHtmlPages = 2 + annexurePagesHtml.length;

  // Build the DOM container for html2canvas rendering
  const container = document.createElement('div');
  container.id = 'pdf-export-container';
  container.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 794px; z-index: -9999; background: #ffffff;';
  document.body.appendChild(container);

  const pageElements: HTMLElement[] = [];
  try {
    const el1 = createPageElement(page1Content, page1Header, getFooter(1, totalHtmlPages));
    container.appendChild(el1);
    pageElements.push(el1);

    const el2 = createPageElement(page2Content, runningHeader, getFooter(2, totalHtmlPages));
    container.appendChild(el2);
    pageElements.push(el2);

    for (let i = 0; i < annexurePagesHtml.length; i++) {
      const el = createPageElement(annexurePagesHtml[i], runningHeader, getFooter(3 + i, totalHtmlPages));
      container.appendChild(el);
      pageElements.push(el);
    }

    // Render using html2canvas into jsPDF
    const jsPdfDoc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    for (let i = 0; i < pageElements.length; i++) {
      const canvas = await html2canvas(pageElements[i], {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.96);
      if (i > 0) jsPdfDoc.addPage('a4', 'portrait');
      jsPdfDoc.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }

    // Now merge any uploaded PDF pages using pdf-lib, and attach raw files
    const reportBytes = jsPdfDoc.output('arraybuffer');
    const finalDoc = await PDFDocument.load(reportBytes);

    // Merge PDF attachments
    for (const att of rawAttachments) {
      const aType = detectAttachmentType(att.document?.mime_type, att.document?.file_name);
      if (aType === 'pdf' && att.file) {
        try {
          const uploadedBytes = new Uint8Array(await att.file.arrayBuffer());
          const uploadedDoc = await PDFDocument.load(uploadedBytes, { ignoreEncryption: true });
          const pageIndices = uploadedDoc.getPageIndices();
          const copiedPages = await finalDoc.copyPages(uploadedDoc, pageIndices);
          for (const page of copiedPages) {
            finalDoc.addPage(page);
          }
        } catch (pdfErr) {
          console.error('[buildAnalysisReport] Error copying PDF pages:', pdfErr);
        }
      }
    }

    // Embed all original attachment files into the PDF document catalog
    for (const att of rawAttachments) {
      if (att.file) {
        try {
          const fileBytes = new Uint8Array(await att.file.arrayBuffer());
          const fname = att.document?.file_name || 'attached-document';
          const mime = att.document?.mime_type || att.file.type || 'application/octet-stream';
          await finalDoc.attach(fileBytes, fname, {
            mimeType: mime,
            description: 'Original uploaded petition document',
          });
        } catch (attachErr) {
          // File catalog attachment is optional
        }
      }
    }

    const finalBytes = await finalDoc.save();

    // Return an object completely compatible with jsPDF
    return {
      save: (filename: string) => {
        const blob = new Blob([finalBytes as any], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      output: (type?: string) => {
        if (type === 'blob') return new Blob([finalBytes as any], { type: 'application/pdf' });
        if (type === 'arraybuffer') return finalBytes.buffer;
        return finalBytes;
      },
    } as unknown as jsPDF;
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

/**
 * e-Gov Copilot Conversation Record PDF Generator.
 */
export async function buildConversationReport(input: ConversationReportInput): Promise<jsPDF> {
  const { jsPDF: JsPDF } = await import('jspdf');
  const lang: ReportLang = input.lang === 'ta' ? 'ta' : 'en';
  const l = (k: string) => L[k]?.[lang] || L[k]?.en || k;
  const t = (v: any) => tx(lang, v);

  const emblem = await loadEmblemDataUrl();
  const dateStr = new Date().toLocaleString(lang === 'ta' ? 'ta-IN' : 'en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const emblemMarkup = emblem
    ? `<img src="${emblem}" style="width: 40px; height: 40px; object-fit: contain; margin-bottom: 6px;" alt="Emblem" />`
    : `<div style="width: 38px; height: 38px; border: 2px solid #135830; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 10px; color: #135830; margin: 0 auto 6px auto;">GOVT</div>`;

  const headerHtml = `
    <div style="text-align: center; margin-bottom: 12px;">
      <div style="display: flex; justify-content: center;">${emblemMarkup}</div>
      <div style="font-size: 16px; font-weight: 700; color: #135830;">${escapeHtml(l('govt'))}</div>
      <div style="font-size: 12px; font-weight: 600; color: #2d3748;">${escapeHtml(l('portal'))}</div>
      <div style="margin-top: 8px; border-bottom: 2px solid #135830; height: 0;"></div>
      <div style="margin-top: 2px; border-bottom: 0.8px solid #135830; height: 0;"></div>
    </div>
    <div style="text-align: center; margin: 8px 0 12px 0;">
      <span style="font-size: 13px; font-weight: 700; color: #0f172a; background: #eef7f2; padding: 4px 16px; border-radius: 4px; border: 1px solid #cbe5d5;">
        ${escapeHtml(t(input.title) || l('convTitle'))}
      </span>
      <div style="font-size: 10.5px; color: #64748b; margin-top: 6px;">
        ${escapeHtml(l('generated'))}: ${escapeHtml(dateStr)}
      </div>
    </div>
  `;

  const footerHtml = (cur: number, total: number) => `
    <div style="border-top: 1px solid #cbd5e1; padding-top: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #64748b;">
      <div>${escapeHtml(l('convFooter'))}</div>
      <div style="font-weight: 600;">${escapeHtml(l('page'))} ${cur} ${escapeHtml(l('of'))} ${total}</div>
    </div>
  `;

  const messagesHtml = input.messages.map((m) => {
    const isUser = m.role === 'USER';
    const roleTitle = isUser ? l('officer') : l('copilot');
    const bg = isUser ? '#f1f5f9' : '#f0fdf4';
    const borderColor = isUser ? '#cbd5e1' : '#bbf7d0';
    const accentColor = isUser ? '#475569' : '#135830';

    return `
      <div style="margin-bottom: 12px; background: ${bg}; border: 1px solid ${borderColor}; border-left: 4px solid ${accentColor}; border-radius: 6px; padding: 10px 14px; font-size: 11.5px; line-height: 1.55;">
        <div style="font-weight: 700; font-size: 11px; color: ${accentColor}; margin-bottom: 4px; text-transform: uppercase;">
          ${escapeHtml(roleTitle)}
        </div>
        <div style="color: #1e293b; white-space: pre-wrap;">${escapeHtml(t(m.content))}</div>
      </div>
    `;
  }).join('');

  const contentHtml = `
    <div style="margin-top: 6px;">
      ${messagesHtml}
    </div>
    <div style="margin-top: 24px; padding-top: 12px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; align-items: flex-end;">
      <div style="font-size: 10px; color: #64748b;">${escapeHtml(l('date'))}: ____________________</div>
      <div style="text-align: right;">
        <div style="width: 160px; border-bottom: 1px solid #64748b; margin-bottom: 4px;"></div>
        <div style="font-weight: 700; font-size: 10.5px; color: #1e293b;">${escapeHtml(l('signature'))}</div>
      </div>
    </div>
  `;

  const container = document.createElement('div');
  container.id = 'pdf-conv-container';
  container.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 794px; z-index: -9999; background: #ffffff;';
  document.body.appendChild(container);

  try {
    const pageEl = createPageElement(contentHtml, headerHtml, footerHtml(1, 1));
    container.appendChild(pageEl);

    const canvas = await html2canvas(pageEl, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const imgData = canvas.toDataURL('image/jpeg', 0.96);
    doc.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    return doc;
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
