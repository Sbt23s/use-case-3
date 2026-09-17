import type { IAIProvider, GenerateOptions, AICompletion } from './provider.js';

/**
 * Deterministic local provider.
 *
 * It performs real work — it reads the case text it is given and derives its
 * output from that text. It does not call a network model, and it never
 * invents an Act, Rule, GO number, department or legal conclusion: every
 * authoritative reference must come from the RAG layer, not from here.
 *
 * Determinism is intentional: the demo must be reproducible and runnable
 * offline. Swap in AnthropicProvider for live model calls.
 */

const t0 = () => Date.now();

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 12);
}

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
}

/** Keyword cue sets used for extraction. Descriptive, not legal conclusions. */
const CUES = {
  property: ['property', 'land', 'house', 'site', 'acre', 'cent', 'survey', 'patta', 'plot'],
  sale: ['sold', 'sale', 'sale deed', 'transfer', 'registered', 'deed', 'transferred'],
  consent: ['without', 'knowledge', 'consent', 'acknowledgement', 'informing', 'unaware'],
  livelihood: ['livelihood', 'income', 'food', 'medical', 'expenses', 'maintenance', 'support', 'difficulty'],
  pension: ['pension', 'old age', 'allowance', 'scheme', 'welfare', 'social security'],
  elderly: ['elderly', 'aged', 'senior citizen', 'grandmother', 'old', 'years'],
  family: ['son', 'sons', 'daughter', 'husband', 'wife', 'family', 'children'],
};

function hits(text: string, cues: string[]): string[] {
  const lower = text.toLowerCase();
  return cues.filter((c) => lower.includes(c));
}

const DATE_RE = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g;
const AMOUNT_RE = /(?:rs\.?|inr|₹)\s?([\d,]+)/gi;

export class MockAIProvider implements IAIProvider {
  readonly name = 'mock-deterministic';
  readonly model = 'gov-poc-mock-v1';
  readonly available = true;

  private done(text: string, started: number): AICompletion {
    return { text, model: this.model, latencyMs: Date.now() - started };
  }

  async generateText(o: GenerateOptions): Promise<AICompletion> {
    const started = t0();
    // OCR correction gets dedicated logic rather than the generic sentence extractor.
    if (o.system?.includes('OCR post-processor')) {
      return this.done(this.correctOcr(o.user), started);
    }
    return this.done(this.compose(o), started);
  }

  async generateStructuredOutput<T>(o: GenerateOptions): Promise<{ data: T } & AICompletion> {
    const started = t0();
    const data = this.structured(o) as T;
    return { data, ...this.done(JSON.stringify(data), started) };
  }

  async summarize(text: string, instruction?: string): Promise<AICompletion> {
    const started = t0();
    const ss = sentences(text);
    const lead = ss.slice(0, 3).join(' ');
    return this.done(
      (instruction ? `${instruction}\n\n` : '') +
      (lead || text.slice(0, 400)),
      started,
    );
  }

  async classify(text: string, labels: string[]): Promise<AICompletion> {
    const started = t0();
    const tk = new Set(tokens(text));
    let best = labels[0] ?? 'UNCLASSIFIED';
    let bestScore = 0;
    for (const l of labels) {
      const score = tokens(l).filter((w) => tk.has(w)).length;
      if (score > bestScore) { bestScore = score; best = l; }
    }
    return this.done(best, started);
  }

  async translate(text: string, to: string): Promise<AICompletion> {
    const started = t0();
    // No real MT in the offline provider. Returning the source unchanged with an
    // explicit marker is honest; silently returning text as "translated" is not.
    return this.done(`[translation-unavailable:${to}] ${text}`, started);
  }

  async extract(text: string, fields: string[]): Promise<AICompletion> {
    const started = t0();
    const out: Record<string, unknown> = {};
    for (const f of fields) out[f] = this.field(f, text);
    return this.done(JSON.stringify(out), started);
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Deterministic hashed bag-of-words vector; adequate for lexical similarity
    // in the POC. Production swaps in a real embedding model.
    return texts.map((t) => {
      const v = new Array(128).fill(0);
      for (const w of tokens(t)) {
        let h = 0;
        for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) >>> 0;
        v[h % 128] += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }

  async transcribe(audioRef: string): Promise<AICompletion> {
    const started = t0();
    return this.done(`[transcription-unavailable] No speech-to-text engine configured for ${audioRef}.`, started);
  }

  // ---------- internals ----------
  private field(f: string, text: string): unknown {
    const lower = text.toLowerCase();
    switch (f) {
      case 'dates': return [...text.matchAll(DATE_RE)].map((m) => m[0]);
      case 'amounts': return [...text.matchAll(AMOUNT_RE)].map((m) => m[0]);
      case 'property_mentioned': return hits(text, CUES.property);
      case 'sale_mentioned': return hits(text, CUES.sale);
      case 'livelihood_mentioned': return hits(text, CUES.livelihood);
      case 'pension_mentioned': return hits(text, CUES.pension);
      default: return lower.includes(f.toLowerCase()) ? f : null;
    }
  }

  private compose(o: GenerateOptions): string {
    if (o.user.includes("OFFICER'S QUESTION:")) {
      return this.composeCopilot(o);
    }
    const ss = sentences(o.user);
    return ss.slice(0, 5).join('\n');
  }

  private composeCopilot(o: GenerateOptions): string {
    const qMatch = o.user.match(/OFFICER'S QUESTION:\s*([^\n]+)/i);
    const question = qMatch ? qMatch[1].trim() : '';
    const isTa = o.system?.includes('ANSWER ENTIRELY IN TAMIL') || /[\u0B80-\u0BFF]/.test(question);

    const lines = o.user.split('\n');
    let actTitle = '';
    let sections = '';
    let rules = '';
    let authority = '';
    let workflow = '';
    let petitionType = '';
    let deptTitle = '';
    let authTitle = '';

    let inAct = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('ACT [')) {
        if (!actTitle) {
          inAct = true;
          actTitle = trimmed.replace(/^ACT\s*\[id\s*\d+\]\s*/i, '');
        } else {
          inAct = false;
        }
        continue;
      }
      if (inAct) {
        if (trimmed.startsWith('DEPARTMENT [') || trimmed.startsWith('AUTHORITY [') || trimmed.startsWith('TOOL:') || trimmed.startsWith('═══')) {
          inAct = false;
        } else if (trimmed.startsWith('Section(s):')) {
          sections = trimmed.replace(/^Section\(s\):\s*/i, '');
        } else if (trimmed.startsWith('Rules:')) {
          rules = trimmed.replace(/^Rules:\s*/i, '');
        } else if (trimmed.startsWith('Competent Authority:')) {
          authority = trimmed.replace(/^Competent Authority:\s*/i, '');
        } else if (trimmed.startsWith('Petition Types:')) {
          petitionType = trimmed.replace(/^Petition Types:\s*/i, '');
        } else if (trimmed.startsWith('Workflow / Redressal Process:')) {
          workflow = trimmed.replace(/^Workflow \/ Redressal Process:\s*/i, '');
        }
      }
      if (trimmed.startsWith('DEPARTMENT [') && !deptTitle) {
        deptTitle = trimmed.replace(/^DEPARTMENT\s*\[id\s*\d+\]\s*/i, '');
      }
      if (trimmed.startsWith('AUTHORITY [') && !authTitle) {
        authTitle = trimmed.replace(/^AUTHORITY\s*\[id\s*\d+\]\s*/i, '');
      }
    }

    if (!authority && authTitle) authority = authTitle;

    if (actTitle) {
      if (isTa) {
        return [
          `சட்டரீதியான வழிகாட்டுதல் மற்றும் பரிந்துரை:`,
          `• பொருந்தும் சட்டம்: ${actTitle}`,
          sections ? `• முக்கிய சட்டப் பிரிவுகள்: ${sections}` : null,
          rules ? `• தொடர்புடைய விதிகள்: ${rules}` : null,
          deptTitle ? `• கையாளும் துறை: ${deptTitle}` : null,
          authority ? `• தகுதிவாய்ந்த பொறுப்பு அலுவலர்: ${authority}` : null,
          workflow ? `• தீர்வு நடைமுறை / பணிப்பாய்வு: ${workflow}` : null,
          petitionType ? `• பொருந்தும் மனு வகைகள்: ${petitionType}` : null,
          `\nமேற்குறிப்பிட்ட விவரங்களின் அடிப்படையில் உரிய நடைமுறையைப் பின்பற்றி நடவடிக்கை எடுக்கலாம்.`,
        ].filter(Boolean).join('\n');
      } else {
        return [
          `Statutory Legal Guidance and Recommendations:`,
          `• Applicable Act: ${actTitle}`,
          sections ? `• Key Sections: ${sections}` : null,
          rules ? `• Applicable Rules: ${rules}` : null,
          deptTitle ? `• Competent Department: ${deptTitle}` : null,
          authority ? `• Responsible Authority: ${authority}` : null,
          workflow ? `• Redressal Workflow: ${workflow}` : null,
          petitionType ? `• Petition Categories: ${petitionType}` : null,
          `\nAction may be initiated in accordance with the prescribed statutory workflow above.`,
        ].filter(Boolean).join('\n');
      }
    }

    if (deptTitle) {
      if (isTa) {
        return [
          `துறை சார்ந்த வழிகாட்டுதல்:`,
          `• பொறுப்பான துறை: ${deptTitle}`,
          authTitle ? `• தகுதிவாய்ந்த அலுவலர்: ${authTitle}` : null,
          `• பரிந்துரை: மனுவை இத்துறையின் பரிசீலனைக்கு அனுப்பி உரிய நடவடிக்கை எடுக்கவும்.`,
        ].filter(Boolean).join('\n');
      } else {
        return [
          `Departmental Guidance:`,
          `• Handling Department: ${deptTitle}`,
          authTitle ? `• Competent Authority: ${authTitle}` : null,
          `• Recommendation: Forward the matter to this department for necessary field inspection and redressal.`,
        ].filter(Boolean).join('\n');
      }
    }

    return isTa
      ? 'இக்கேள்விக்கான குறிப்பிட்ட சட்டம் அல்லது துறை அறிவுத் தளத்தில் நேரடியாகப் பொருந்தவில்லை. மனுதாரர் விவரங்களை சரிபார்த்து சம்பந்தப்பட்ட மாவட்ட வருவாய் அலுவலர் அல்லது குறைதீர்ப்பு அலுவலரை அணுகவும்.'
      : 'No specific Act or Department directly matched in the configured knowledge base. Please verify the petition details with the District Grievance Redressal Officer.';
  }

  private structured(o: GenerateOptions): unknown {
    // Task-shaped structured output is produced by the individual agents,
    // which pass an explicit schema. The provider returns a best-effort
    // skeleton derived from the input text.
    return { derived_from: o.user.slice(0, 200), note: 'structured output produced by agent layer' };
  }

  /**
   * Deterministic OCR post-processor.
   *
   * Applied when the real AI provider is not configured. Performs rule-based
   * cleaning that covers the most common Tesseract failure modes on Tamil Nadu
   * government document scans:
   *   - Character-level confusion pairs (0/O, 1/l, rn/m, etc.)
   *   - Broken Tamil/English mixed words
   *   - Government-document phrase reconstruction
   *   - Noise line removal (lines that are pure punctuation or single chars)
   *
   * A production deployment replaces MockAIProvider with AnthropicProvider,
   * which calls Claude and gets genuinely intelligent correction.
   */
  private correctOcr(prompt: string): string {
    // ---- Extract the raw OCR portion from the prompt ----
    const marker = 'document:\n\n';
    const idx = prompt.indexOf(marker);
    let text = idx >= 0 ? prompt.slice(idx + marker.length) : prompt;

    // ---- Strip any previous correction header to avoid accumulation ----
    text = text.replace(/^\[AI-Assisted OCR Correction[^\]]*\]\s*\n*/gi, '');

    // ---- 1. Remove pure-artefact lines ----
    text = text
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        if (!t) return true; // keep blank lines (paragraph breaks)
        // Always keep lines with Tamil script
        if (/[஀-௿]/.test(t)) return true;
        // Drop lines that are only 1-3 random non-alphanumeric characters
        if (t.length <= 3 && /^[^a-zA-Z0-9஀-௿]+$/.test(t)) return false;
        // Drop lines that look like scan noise (e.g. "| |", "— —", "; :")
        if (/^[\s|\\/_\-=~.,:;!?'"(){}\[\]]+$/.test(t)) return false;
        return true;
      })
      .join('\n');

    // ---- 2. Character-level substitution pairs ----
    // Each entry is [pattern, replacement]. Order matters — more specific first.
    const charFixes: [RegExp, string][] = [
      // --- digit/letter confusion ---
      [/\b0([A-Za-z])/g, 'O$1'],
      [/([A-Za-z])0\b/g, '${1}O'],
      [/\b1([a-z])/g, 'l$1'],
      [/\bI([a-z]{2})/g, 'l$1'],           // capital I read as l
      [/\b([A-Z])1\b/g, '$1l'],
      [/\brn\b/g, 'm'],                      // 'rn' → 'm' (Tesseract classic)
      [/([a-z])rn([a-z])/g, '$1m$2'],
      [/\bvv\b/g, 'w'],
      [/([a-z])vv([a-z])/g, '$1w$2'],
      // --- punctuation noise around words ---
      [/\|([A-Za-z])/g, 'l$1'],             // '|word' → 'lword'
      [/([A-Za-z])\|/g, '$1l'],
      // --- currency ---
      [/R\s*s\s*\.?\s*/g, 'Rs. '],
      [/₹\s+/g, '₹'],
      // --- common two-char substitution sequences ---
      [/\bca\b(?=\s)/gi, 'can'],
      [/\btbe\b/gi, 'the'],
      [/\btne\b/gi, 'the'],
      [/\bTne\b/gi, 'The'],
      [/\bTbe\b/gi, 'The'],
      [/\btrorn\b/gi, 'from'],
      [/\bfrorn\b/gi, 'from'],
      [/\bwit\b(?=\s)/gi, 'with'],
      [/\bthis\s+is\s+to\s+certif\b/gi, 'This is to certify'],
    ];
    for (const [re, rep] of charFixes) text = text.replace(re, rep);

    // ---- 3. Word-level Tamil Nadu government document phrase fixes ----
    const wordFixes: [RegExp, string][] = [
      // Government / institution names
      [/\bGovemment\b/gi, 'Government'],
      [/\bGovernement\b/gi, 'Government'],
      [/\bGovt\.?\s*of\s*Tarnil\b/gi, 'Govt. of Tamil'],
      [/\bTarnil\s*Nadu\b/gi, 'Tamil Nadu'],
      [/\bTamil\s*Naciu\b/gi, 'Tamil Nadu'],
      [/\bTaminadu\b/gi, 'Tamil Nadu'],
      [/\bCollecforaie\b/gi, 'Collectorate'],
      [/\bCollecforafe\b/gi, 'Collectorate'],
      [/\bCollecfor\b(?!\s*ate)/gi, 'Collector'],
      [/\bColiecfor\b/gi, 'Collector'],
      [/\bDistrci?t\b/gi, 'District'],
      [/\bDisfricf\b/gi, 'District'],
      [/\bTasildar\b/gi, 'Tahsildar'],
      [/\bTahsildar\b/gi, 'Tahsildar'],
      [/\bPanchayat\b/gi, 'Panchayat'],
      [/\bPancayat\b/gi, 'Panchayat'],
      [/\bMunicipailty\b/gi, 'Municipality'],
      // Petition language
      [/\bPetifion\b/gi, 'Petition'],
      [/\bPetifioner\b/gi, 'Petitioner'],
      [/\bpetifioner\b/gi, 'Petitioner'],
      [/\bpetioner\b/gi, 'Petitioner'],
      [/\bRespectfuliy\b/gi, 'Respectfully'],
      [/\bsubmilted\b/gi, 'submitted'],
      [/\bsubmitled\b/gi, 'submitted'],
      [/\bhurnbly\b/gi, 'humbly'],
      [/\bHurnbly\b/gi, 'Humbly'],
      [/\bkindiy\b/gi, 'kindly'],
      [/\bKindiy\b/gi, 'Kindly'],
      [/\bauthoriiy\b/gi, 'authority'],
      [/\bAuthorily\b/gi, 'Authority'],
      // Document / legal terms
      [/\bSurvey\s+No\.?\s*(\d)/gi, 'Survey No. $1'],
      [/\bS\.?\s*No\.?\s*(\d)/g, 'S.No. $1'],
      [/\bPatta\s+No\.?\s*(\d)/gi, 'Patta No. $1'],
      [/\bAadhaar\b/gi, 'Aadhaar'],
      [/\bAadhar\b/gi, 'Aadhaar'],
      [/\bAdhaar\b/gi, 'Aadhaar'],
      [/\bFieid\b/gi, 'Field'],
      [/\bencroachinent\b/gi, 'encroachment'],
      [/\bencroachrnent\b/gi, 'encroachment'],
      // Date/time
      [/Daied\s*:/gi, 'Dated:'],
      [/Daled\s*:/gi, 'Dated:'],
      [/Datecl\s*:/gi, 'Dated:'],
      [/\bdt\.?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/gi, 'Dt. $1'],
      // Reference number patterns
      [/\bRef\.?\s*No\.?\s*:/gi, 'Ref. No.:'],
      [/\bLr\.?\s*No\.?\s*:/gi, 'Lr. No.:'],
      [/\bNa\.?\s*Ka\.?\s*(\d)/gi, 'Na. Ka. $1'],
    ];
    for (const [re, rep] of wordFixes) text = text.replace(re, rep);

    // ---- 4. Collapse excessive whitespace ----
    text = text
      .replace(/[ \t]{2,}/g, ' ')        // multiple spaces → one
      .replace(/\n{3,}/g, '\n\n')        // more than 2 blank lines → 2
      .trim();

    // ---- 5. Warn if confidence likely still low ----
    const note = 'This correction was applied by the rule-based offline mock. '
      + 'For best results, configure a real AI provider (Anthropic/OpenAI) or '
      + 're-run OCR with PaddleOCR which handles scanned documents more accurately.';

    return `[AI-Assisted OCR Correction — Officer review recommended]\n\n${text}\n\n---\n${note}`;
  }
}
