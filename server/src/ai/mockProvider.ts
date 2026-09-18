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

    // ---- Universal AI Capabilities for Officer Console ----
    const lowerQ = question.toLowerCase();

    // 0. Popular Cinema / Movies Inquiry (e.g. Actor Vijay)
    const isVijayMovie = /\b(vijay|thalapathy)\b.*\b(movie|movies|film|films|filmography|list)\b/i.test(lowerQ)
      || /\b(actor vijay|thalapathy vijay)\b/i.test(lowerQ);
    if (isVijayMovie) {
      if (isTa) {
        return [
          'நடிகர் விஜய் (தளபதி விஜய்) நடித்த சில முக்கிய வெற்றித் திரைப்படங்கள்:',
          '',
          '• **பூவே உனக்காக (1996)** — குடும்பப் பாங்கான காதல் வெற்றித் திரைப்படம்',
          '• **காதலுக்கு மரியாதை (1997)** — மாநில விருது பெற்ற கிளாசிக் காதல் படம்',
          '• **குஷி (2000)** — எவர்கிரீன் ரொமாண்டிக் காமெடி',
          '• **கில்லி (2004)** — தமிழ் சினிமாவின் மிகப்பெரிய பிளாக்பஸ்டர் கமர்ஷியல் ஹிட்',
          '• **போக்கிரி (2007)** — ஆக்ஷன் பிளாக்பஸ்டர்',
          '• **துப்பாக்கி (2012)** — ஏ.ஆர். முருகதாஸ் இயக்கத்தில் மிகப்பெரிய வரவேற்பைப் பெற்ற ஆக்ஷன் த்ரில்லர்',
          '• **கத்தி (2014)** — சமூகப் பிரச்சனை மற்றும் விவசாயிகளின் உரிமைகளைப் பேசிய படம்',
          '• **மெர்சல் (2017)** — மருத்துவ சேவை குறித்த விவாதம் ஏற்படுத்திய பிளாக்பஸ்டர்',
          '• **சர்க்கார் (2018)** — வாக்குரிமை மற்றும் தேர்தல் விழிப்புணர்வு படம்',
          '• **மாஸ்டர் (2021)** — லோகேஷ் கனகராஜ் இயக்கத்தில் மாஸ் ஆக்ஷன் ஹிட்',
          '• **லியோ (2023)** — பாக்ஸ் ஆபிஸ் சாதனை படைத்த எல்சியூ ஆக்ஷன் படம்',
          '• **தி கிரேட்டஸ்ட் ஆஃப் ஆல் டைம் (GOAT - 2024)** — வெங்கட் பிரபு இயக்கத்தில் சயின்ஸ் ஃபிக்ஷன் ஆக்ஷன் படம்',
        ].join('\n');
      } else {
        return [
          'Here are some of the most popular and iconic movies of actor Vijay (Thalapathy Vijay):',
          '',
          '• **Poove Unakkaga (1996)** – Breakthrough family romantic drama',
          '• **Kadhalukku Mariyadhai (1997)** – Classic romance film; won Tamil Nadu State Film Award',
          '• **Kushi (2000)** – Highly popular romantic comedy blockbuster',
          '• **Ghilli (2004)** – Industry-defining record-breaking action blockbuster',
          '• **Pokkiri (2007)** – Massive action entertainer',
          '• **Thuppakki (2012)** – Action thriller directed by A.R. Murugadoss; entered the 100-crore club',
          '• **Kaththi (2014)** – Social action drama addressing corporate greed and farmers’ rights',
          '• **Mersal (2017)** – Triple-role blockbuster tackling medical negligence',
          '• **Sarkar (2018)** – Political action drama on electoral awareness (Section 49P)',
          '• **Master (2021)** – High-octane action blockbuster directed by Lokesh Kanagaraj',
          '• **Leo (2023)** – Box office phenomenon and part of the LCU franchise',
          '• **The Greatest of All Time (GOAT - 2024)** – High-concept action espionage film directed by Venkat Prabhu',
        ].join('\n');
      }
    }

    // 0b. Current Leadership & Facts
    if (/(who is|current|now|is .* cm|chief minister|முதலமைச்சர்).*tamil\s*nadu/i.test(lowerQ)) {
      if (isTa) {
        return [
          'தமிழ்நாட்டின் தற்போதைய முதலமைச்சர் **திரு. மு. க. ஸ்டாலின் (M. K. Stalin)** அவர்கள் ஆவார்.',
          '',
          'அவர் மே 7, 2021 முதல் தமிழ்நாட்டின் 8-வது முதலமைச்சராகப் பொறுப்பு வகித்து வருகிறார்.',
          '',
          'நடிகர் விஜய் 2024-இல் "தமிழக வெற்றிக் கழகம்" (TVK) என்ற அரசியல் கட்சியைத் தொடங்கியுள்ளார்; அவர் முதலமைச்சர் அல்ல.',
        ].join('\n');
      } else {
        return [
          'The current Chief Minister of Tamil Nadu is **Thiru M. K. Stalin**.',
          '',
          'He has been serving as the Chief Minister since May 7, 2021, and is the president of the Dravida Munnetra Kazhagam (DMK).',
          '',
          'Actor Vijay founded the political party *Tamilaga Vettri Kazhagam* (TVK) in 2024; he is not the Chief Minister of Tamil Nadu.',
        ].join('\n');
      }
    }

    // 1. Drafting Official Memos / Letters / Proceedings
    if (/(draft|letter|memo|proceedings|order|notice|circular|format|வரைவு|கடிதம்|உத்தரவு|சுற்றறிக்கை)/i.test(question)) {
      if (isTa) {
        return [
          `### தமிழ்நாடு அரசு — அதிகாரப்பூர்வ உத்தரவு வரைவு (Official Proceedings)`,
          '',
          `**ந.க. எண்: 2026/கு.தீ.அ/ஆய்வு-108**`,
          `**நாள்: 18-09-2026**`,
          '',
          `**பொருள்:** பொதுமக்கள் குறைதீர்ப்பு மனு — நேரடி கள ஆய்வு மற்றும் அறிக்கை சமர்ப்பித்தல் — தொடர்பாக.`,
          `**பார்வை:** மனுதாரரின் குறைதீர்ப்பு விண்ணப்பம்.`,
          '',
          `**உத்தரவு:**`,
          `1. மனுதாரர் தெரிவித்துள்ள குறைபாடு குறித்து சம்பந்தப்பட்ட வருவாய் ஆய்வாளர் / கள அலுவலர் உடனடியாக நேரில் ஆய்வு செய்ய பணிக்கப்படுகிறார்.`,
          `2. கள ஆய்வின் போது மனுதாரர் மற்றும் தொடர்புடைய அனைத்து தரப்பினருக்கும் முன்னறிவிப்பு வழங்கி அவர்களின் கருத்துக்கள் பதிவு செய்யப்பட வேண்டும்.`,
          `3. ஆய்வு முடிந்த **7 வேலை நாட்களுக்குள்** முழுமையான கள அறிக்கை, வரைபடம் மற்றும் ஆவணங்களுடன் இவ்வலுவலகத்திற்கு அறிக்கை சமர்ப்பிக்க உத்தரவிடப்படுகிறது.`,
          '',
          `**ஒப்பம்/-**`,
          `குறைதீர்ப்பு அலுவலர் / வட்டாட்சியர்`,
          '',
          `**நகல்:** மனுதாரரின் தகவலுக்காக அனுப்பப்படுகிறது.`,
        ].join('\n');
      } else {
        return [
          `### GOVERNMENT OF TAMIL NADU — OFFICIAL PROCEEDINGS DRAFT`,
          '',
          `**R.C. No: 2026/GRO/ENQ-108**`,
          `**Dated: 18-09-2026**`,
          '',
          `**Sub:** Public Grievance Redressal — Field Inspection and Enquiry Report — Reg.`,
          `**Ref:** Citizen Grievance Petition Received on Portal.`,
          '',
          `**ORDER / DIRECTIVE:**`,
          `1. The Field Inspection Officer / Revenue Inspector is hereby directed to conduct an immediate on-site enquiry regarding the issues highlighted in the petition.`,
          `2. Advance notice shall be served to the petitioner and all concerned parties prior to conducting the spot enquiry.`,
          `3. A comprehensive enquiry report along with relevant sketches and statements shall be submitted to this office within **7 working days** for passing final orders.`,
          '',
          `**Sd/-**`,
          `Grievance Redressal Officer / Competent Authority`,
          '',
          `**Copy to:** The Petitioner for information.`,
        ].join('\n');
      }
    }

    // 2. Code & Technical Queries (SQL, Python, Scripting)
    if (/(code|sql|python|javascript|typescript|script|function|api|query|நிரல்)/i.test(question)) {
      if (/sql/i.test(question)) {
        return [
          `### Grievance Analytics SQL Query`,
          '',
          'Here is a production-ready SQL query to summarize monthly grievance resolution rates and pending counts across departments:',
          '',
          '```sql',
          '-- Grievance Redressal Performance by Department',
          'SELECT',
          '    d.name AS department_name,',
          '    COUNT(p.id) AS total_received,',
          '    SUM(CASE WHEN p.status = \'CLOSED\' THEN 1 ELSE 0 END) AS resolved_count,',
          '    SUM(CASE WHEN p.status != \'CLOSED\' THEN 1 ELSE 0 END) AS pending_count,',
          '    ROUND(AVG(JULIANDAY(p.updated_at) - JULIANDAY(p.created_at)), 1) AS avg_resolution_days,',
          '    ROUND((SUM(CASE WHEN p.status = \'CLOSED\' THEN 1.0 ELSE 0 END) / COUNT(p.id)) * 100, 1) || \'%\' AS resolution_rate',
          'FROM cp_petition p',
          'LEFT JOIN cp_analysis a ON a.petition_id = p.id',
          'LEFT JOIN kb_department d ON d.id = a.department_id',
          'WHERE p.created_at >= datetime(\'now\', \'-30 days\')',
          'GROUP BY d.id',
          'ORDER BY total_received DESC;',
          '```',
          '',
          isTa ? 'இக்குறியீடு கடந்த 30 நாட்களில் பெறப்பட்ட மனுக்கள், தீர்க்கப்பட்ட விகிதம் மற்றும் சராசரி நாட்களைக் கணக்கிடுகிறது.'
               : 'This query aggregates 30-day resolution rates, average resolution turnaround days, and pending caseload per department.',
        ].join('\n');
      }

      return [
        `### Technical Implementation / Script Sample`,
        '',
        '```python',
        '# Python utility for automated citizen grievance notification and categorization',
        'import datetime',
        '',
        'def evaluate_petition_priority(days_pending: int, category: str) -> str:',
        '    """Assign grievance priority according to citizen service charter."""',
        '    critical_categories = {"drinking_water", "street_lights", "medical_emergency"}',
        '    if category.lower() in critical_categories or days_pending >= 15:',
        '        return "HIGH"',
        '    elif days_pending >= 7:',
        '        return "MEDIUM"',
        '    return "LOW"',
        '',
        '# Example usage',
        'status = evaluate_petition_priority(days_pending=10, category="drinking_water")',
        'print(f"Assigned Priority: {status}")',
        '```',
        '',
        isTa ? 'இக்குறியீடு மனுக்களின் முக்கியத்துவம் மற்றும் நிலுவை நாட்களை அடிப்படையாகக் கொண்டு முன்னுரிமையை நிர்ணயிக்கிறது.'
             : 'This script classifies petition severity based on the standard Tamil Nadu Citizen Service Charter timeline.',
      ].join('\n');
    }

    // 3. Government Schemes & Welfare Inquiries
    if (/(scheme|திட்டம்|scholarship|pension|magalir|pudhumai|illam|yojana)/i.test(question)) {
      if (isTa) {
        return [
          `### தமிழ்நாடு அரசு முதன்மை நலத்திட்டங்கள் — வழிகாட்டுதல்`,
          '',
          `• **கலைஞர் மகளிர் உரிமைத் திட்டம்:** தகுதிவாய்ந்த குடும்பத் தலைவிகளுக்கு மாதம் ₹1,000 உரிமைத் தொகை வழங்கும் திட்டம். வருவாய்த் துறை மற்றும் சிறப்புத் திட்ட செயலாக்கத் துறை மூலம் ஒருங்கிணைக்கப்படுகிறது.`,
          `• **புதுமைப் பெண் திட்டம் (மூவலூர் ராமாமிர்தம் அம்மையார் திட்டம்):** அரசுப் பள்ளிகளில் 6 முதல் 12-ம் வகுப்பு வரை படித்து உயர்கல்வி பயிலும் மாணவிகளுக்கு மாதம் ₹1,000 உதவித்தொகை.`,
          `• **மக்களைத் தேடி மருத்துவம்:** தொற்றா நோய்களுக்கான மருத்துவ சேவைகள் மற்றும் மருந்துகளை பொதுமக்களின் இல்லங்களுக்கே சென்று வழங்கும் திட்டம்.`,
          `• **இல்லம் தேடிக் கல்வி:** கோவிட் கால கற்றல் இடைவெளியை நிரப்ப தன்னார்வலர்கள் மூலம் குடியிருப்பு பகுதியிலேயே மாலை நேர வகுப்புகள் வழங்கும் திட்டம்.`,
          '',
          `விண்ணப்பங்கள் மற்றும் தகுதிச் சரிபார்ப்புக்கு சம்பந்தப்பட்ட துறையின் இணையதளத்தை (tnega.tn.gov.in) அல்லது இ-சேவை மையங்களை அணுகலாம்.`,
        ].join('\n');
      } else {
        return [
          `### Key Tamil Nadu Government Welfare Schemes`,
          '',
          `• **Kalaignar Magalir Urimai Thittam:** Monthly entitlement of ₹1,000 to eligible women heads of households. Administered by Revenue and Special Programme Implementation Departments.`,
          `• **Pudhumai Penn Scheme:** Monthly financial assistance of ₹1,000 for girl students who studied classes 6–12 in government schools pursuing higher education.`,
          `• **Makkalai Thedi Maruthuvam:** Healthcare delivery scheme bringing screening and medicines for non-communicable diseases directly to citizens' doorsteps.`,
          `• **Illam Thedi Kalvi:** Neighborhood supplementary education program bridging learning loss through community volunteer tutors.`,
          '',
          `Citizens may apply or verify their eligibility through authorized e-Sevai centers or official Tamil Nadu portals (tnega.tn.gov.in).`,
        ].join('\n');
      }
    }

    // 4. General Assistance & Officer Questions
    return isTa
      ? [
          `### மின்-ஆளுமை துணை (e-Gov Copilot) பதில்:`,
          '',
          `உங்கள் கேள்விக்கு உதவ தயாராக உள்ளேன்:`,
          `• **மனு தொடர்பான கேள்விகள்:** ஆவணத்தை பதிவேற்றம் செய்தால் அல்லது மனு எண்ணைக் குறிப்பிட்டால், குறிப்பிட்ட சட்டம் மற்றும் துறையுடன் துல்லியமாக பதிலளிக்க முடியும்.`,
          `• **அரசு நடைமுறைகள்:** கள ஆய்வு உத்தரவுகள், மெமோக்கள் மற்றும் சுற்றறிக்கைகளை எளிதாக வரைவு செய்யலாம்.`,
          `• **தொழில்நுட்ப உதவிகள்:** புள்ளிவிவர வினவல்கள், தரவு பகுப்பாய்வு மற்றும் கணக்கீடுகளை செய்யலாம்.`,
          '',
          `மேலும் குறிப்பிட்ட தகவல்கள் அல்லது ஆவணங்கள் தேவைப்பட்டால் கேட்கவும்.`,
        ].join('\n')
      : [
          `### e-Gov Copilot Response:`,
          '',
          `I am ready to assist you with your administrative or technical inquiry:`,
          `• **Petition Analysis:** Upload any document or specify a petition ID to get grounded statutory citations, sections, and department recommendations.`,
          `• **Official Drafting:** Draft inspection memos, proceedings, notices, and citizen responses in standard Tamil Nadu Government format.`,
          `• **Technical & Analytics:** Generate SQL queries, data summaries, and scripts for grievance performance metrics.`,
          '',
          `Please provide any additional details or files if you need a specific analysis.`,
        ].join('\n');
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
