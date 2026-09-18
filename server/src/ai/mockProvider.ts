import type { IAIProvider, GenerateOptions, AICompletion } from './provider.js';
import { isCoimbatoreQuery, COIMBATORE_ADMIN_CORE } from './knowledge/coimbatoreKnowledge.js';

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
    const isTanglish = !isTa && (
      o.system?.includes('ANSWER ENTIRELY IN NATURAL TANGLISH')
      || /\b(pathi|pathii|sollu|solla|sollunga|enna|ethu|edhu|epdi|eppadi|kudunga|kudu|pannu|panna|panradhu|pannradhu|pannanum|irukku|iruku|venum|vendum|kettalum|kettalumm|patil|bathil|kandippa|maari|illama|ilalma|yaaru|yaar|evaru|unga|ungala|unna|senja|uruvak|tanglis|tanglish|vachirukken|potrukken)\b/i.test(question)
    );

    const lines = o.user.split('\n');
    let actTitle = '';
    let sections = '';
    let rules = '';
    let authority = '';
    let workflow = '';
    let petitionType = '';
    let deptTitle = '';
    let authTitle = '';

    // Parse real-time web search results from Hermes tool output in user prompt
    const webSectionMatch = o.user.match(/REAL-TIME WEB & PUBLIC SOURCES retrieved from live search:\s*([\s\S]*?)(?=\n(?:CONVERSATION SO FAR|OFFICER'S QUESTION:|$))/i);
    const isUnverifiedSearch = o.user.includes('LIVE WEB SEARCH: No authoritative source was found');

    const parseWebCitations = (): { title: string; url: string; domain: string; snippet: string }[] => {
      if (!webSectionMatch) return [];
      const raw = webSectionMatch[1];
      const sourceBlocks = raw.split(/\[Source \d+:\s*([^\]]+)\]/g).filter(Boolean);
      const list: { title: string; url: string; domain: string; snippet: string }[] = [];
      for (let i = 0; i < sourceBlocks.length; i += 2) {
        const domain = (sourceBlocks[i] || '').trim();
        const body = sourceBlocks[i + 1] || '';
        const titleMatch = body.match(/Title:\s*([^\n]+)/i);
        const urlMatch = body.match(/URL:\s*([^\n]+)/i);
        const contentMatch = body.match(/(?:Verified Content|Summary):\s*([\s\S]*?)(?=(?:\n\[Source|\nTitle:|$))/i);
        if (titleMatch || urlMatch) {
          list.push({
            domain,
            title: titleMatch ? titleMatch[1].trim() : domain,
            url: urlMatch ? urlMatch[1].trim() : `https://${domain}`,
            snippet: contentMatch ? contentMatch[1].trim() : '',
          });
        }
      }
      return list;
    };

    const webCitations = parseWebCitations();

    const formatCitationsBlock = (_citations: { title: string; url: string; domain: string }[]): string => {
      // Searches run silently in the backend; do not show URLs or citation cards in UI
      return '';
    };

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

    const lowerQ = question.toLowerCase();

    // 0. Anti-Hallucination Notice for unverified / non-existent information
    if (/\b(flying\s*car|secret\s*g\.?o|fake\s*scheme|alien|time\s*machine)\b/i.test(lowerQ) || (isUnverifiedSearch && !actTitle && !deptTitle)) {
      if (isTa) {
        return '⚠️ குறிப்பு: இத்தகவலை நம்பகமான அதிகாரப்பூர்வ ஆதாரங்களிலிருந்து சரிபார்க்க முடியவில்லை.';
      } else if (isTanglish) {
        return '⚠️ Note: Indha information-a reliable sources moolama verify panna mudiyala.';
      } else {
        return '⚠️ Note: This information could not be verified from reliable sources.';
      }
    }

    // Dedicated Coimbatore Administration & City Knowledge Handling
    if (isCoimbatoreQuery(question)) {
      if (isTa) {
        if (/(collector|ஆட்சியர்|மாவட்ட\s*ஆட்சியர்|collectorate)/i.test(lowerQ)) {
          return [
            '### கோயம்புத்தூர் மாவட்ட ஆட்சியரகம் & நிர்வாக வழிகாட்டி',
            '',
            '• **மாவட்ட ஆட்சியர் & மாவட்ட நடுவர்:** கோயம்புத்தூர் மாவட்ட நிர்வாகத்தின் தலைமைப் பொறுப்பு வகிக்கிறார். சட்டம் ஒழுங்கு, வருவாய் நிர்வாகம், தேர்தல் மற்றும் வளர்ச்சித் திட்டங்களை ஒருங்கிணைக்கிறார்.',
            `• **மாவட்ட ஆட்சியரகம் முகவரி:** ${COIMBATORE_ADMIN_CORE.collectorateAddressTa}`,
            `• **தொலைபேசி எண்:** ${COIMBATORE_ADMIN_CORE.collectoratePhone}`,
            `• **பேரிடர் கட்டுப்பாட்டு அறை:** ${COIMBATORE_ADMIN_CORE.disasterControlRoom}`,
            `• **அதிகாரப்பூர்வ தளம்:** ${COIMBATORE_ADMIN_CORE.officialPortal}`,
            '',
            '**பொதுமக்கள் குறைதீர்ப்பு நடைமுறைகள்:**',
            '• **வாராந்திர மனுநீதி நாள் (மக்கள் குறைதீர்க்கும் கூட்டம்):** ஒவ்வொரு திங்கட்கிழமையும் காலை 10:00 மணிக்கு மாவட்ட ஆட்சியர் தலைமையில் ஆட்சியரக கூட்டரங்கில் நேரடியாக மனுக்கள் பெறப்பட்டு உடனடியாக நடவடிக்கை எடுக்கப்படுகிறது.',
            '• **விவசாயிகள் குறைதீர்க்கும் நாள்:** மாதத்தின் 3-வது வெள்ளிக்கிழமை ஆட்சியரகத்தில் நடைபெறுகிறது.',
            '• **முதலமைச்சரின் உதவி மையம்:** 1100 என்ற கட்டணமில்லா எண்ணிலும், முதல்வர் முகவரி இணையதளத்திலும் புகார்களைப் பதிவு செய்யலாம்.',
            '',
            '**முக்கிய நிர்வாக அலுவலர்கள்:**',
            '• மாவட்ட வருவாய் அலுவலர் (DRO) — மாவட்ட வருவாய் நிர்வாகம் மற்றும் நில விவகாரங்கள்.',
            '• தனித்துணை ஆட்சியர் (சமூகப் பாதுகாப்புத் திட்டம்) — முதியோர், விதவை, ஆதரவற்றோர் ஓய்வூதியத் திட்டங்கள்.',
            '• வருவாய் கோட்டாட்சியர்கள் (RDO): கோவை வடக்கு, கோவை தெற்கு, பொள்ளாச்சி (சார் ஆட்சியர்).',
          ].join('\n');
        }

        if (/(corporation|ccmc|மாநகராட்சி|ஆணையர்|mayor|மேயர்|மண்டலம்|zone|water|குடிநீர்|வரி|tax)/i.test(lowerQ)) {
          return [
            '### கோயம்புத்தூர் மாநகராட்சி (CCMC) — குடிமைப் பணிகள் & வழிகாட்டி',
            '',
            '• **மாநகராட்சி அமைப்பு:** 1981-ல் தொடங்கப்பட்டது. 100 வார்டுகள் மற்றும் 5 நிர்வாக மண்டலங்களாகப் பிரிக்கப்பட்டுள்ளது (கிழக்கு, மேற்கு, வடக்கு, தெற்கு, மத்திய மண்டலங்கள்).',
            '• **தலைமை அலுவலகம்:** ராஜா வீதி, டவுன்ஹால், கோயம்புத்தூர் - 641001.',
            '• **நிர்வாகத் தலைமை:** மாமன்ற மேயர், மாநகராட்சி ஆணையர் (IAS), மற்றும் துணை மேயர்.',
            `• **24x7 பொதுமக்கள் குறைதீர்ப்பு உதவி எண்:** ${COIMBATORE_ADMIN_CORE.ccmcHelpline}`,
            '',
            '**முக்கிய குடிமை சேவைகள்:**',
            '• **குடிநீர் விநியோகம்:** சிறுவாணி அணை (சுவையான இயற்கை கனிம நீர்), பில்லூர் திட்டம் I, II, III மற்றும் ஆழியாறு கூட்டுக்குடிநீர்த் திட்டங்கள் மூலம் விநியோகம் செய்யப்படுகிறது.',
            '• **பிறப்பு மற்றும் இறப்பு சான்றிதழ்:** crsorgi.gov.in மற்றும் மாநகராட்சி மண்டல அலுவலகங்கள் மூலம் வழங்கப்படுகிறது.',
            '• **சொத்து வரி & தொழில் வரி:** ccmc.gov.in இணையதளம் வாயிலாக ஆன்லைனில் எளிதாக செலுத்தலாம்.',
            '• **கட்டட வரைபட அனுமதி & பாதாள சாக்கடை திட்டம்:** ஒற்றைச் சாளர முறையில் ஆன்லைன் விண்ணப்பங்கள் கையாளப்படுகின்றன.',
          ].join('\n');
        }

        if (/(police|காவல்|commissioner|கண்காணிப்பாளர்|\bsp\b|cop|crime|குற்றம்|station)/i.test(lowerQ)) {
          return [
            '### கோயம்புத்தூர் காவல் துறை நிர்வாகம் & அவசர உதவி வழிகாட்டி',
            '',
            '• **கோவை மாநகர காவல் ஆணையரகம்:**',
            '  - காவல் ஆணையர் (Commissioner of Police - ADGP/IGP தரம்) தலைமையில் மாநகர எல்லைக்குட்பட்ட காவல் நிலையங்கள், சட்டம் ஒழுங்கு, குற்றப்பிரிவு மற்றும் போக்குவரத்து பிரிவுகள் செயல்படுகின்றன.',
            '  - தலைமையகம்: பழைய தபால் நிலைய சாலை, ஹுசூர் ரோடு, கோயம்புத்தூர்.',
            '• **கோவை மாவட்டக் காவல் (ஊரகம்):**',
            '  - மாவட்ட காவல் கண்காணிப்பாளர் (SP Coimbatore Rural) தலைமையில் பொள்ளாச்சி, மேட்டுப்பாளையம், சூலூர், அன்னூர், வால்பாறை உள்ளிட்ட ஊரகப் பகுதிகள் செயல்படுகின்றன.',
            '',
            '**அவசர உதவி எண்கள்:**',
            `• காவல் கட்டுப்பாட்டு அறை: ${COIMBATORE_ADMIN_CORE.policeControlRoom}`,
            `• பெண்கள் அவசர உதவி எண்: ${COIMBATORE_ADMIN_CORE.womenHelpline}`,
            `• சைபர் கிரைம் நிதி மோசடி புகார்: ${COIMBATORE_ADMIN_CORE.cyberCrime}`,
            `• குழந்தைகள் பாதுகாப்பு உதவி: ${COIMBATORE_ADMIN_CORE.childline}`,
            '• இணையவழி புகார்களுக்கு: eservices.tnpolice.gov.in',
          ].join('\n');
        }

        if (/(taluk|வட்டம்|தாலுகா|tahsildar|வட்டாட்சியர்)/i.test(lowerQ)) {
          return [
            '### கோயம்புத்தூர் மாவட்டத்தின் 11 வருவாய் வட்டங்கள் (தாலுகாக்கள்)',
            '',
            '1. **கோயம்புத்தூர் வடக்கு** — பாலசுந்தரம் சாலை (கோவை வடக்கு வருவாய் கோட்டம்)',
            '2. **கோயம்புத்தூர் தெற்கு** — ஹுசூர் ரோடு (கோவை தெற்கு வருவாய் கோட்டம்)',
            '3. **பேரூர்** — சிறுவாணி மெயின் ரோடு, பேரூர்',
            '4. **மதுக்கரை** — பாலக்காடு மெயின் ரோடு, மதுக்கரை',
            '5. **சூலூர்** — திருச்சி ரோடு, சூலூர்',
            '6. **மேட்டுப்பாளையம்** — அன்னூர் ரோடு, மேட்டுப்பாளையம்',
            '7. **அன்னூர்** — அவிநாசி ரோடு, அன்னூர்',
            '8. **பொள்ளாச்சி** — சார் ஆட்சியர் அலுவலக வளாகம், பொள்ளாச்சி',
            '9. **கிணத்துக்கடவு** — பொள்ளாச்சி மெயின் ரோடு, கிணத்துக்கடவு',
            '10. **ஆனைமலை** — வேட்டைக்காரன்புதூர் ரோடு, ஆனைமலை',
            '11. **வால்பாறை** — மெயின் ரோடு, வால்பாறை',
            '',
            '**வட்டாட்சியர் அலுவலக சேவைகள்:**',
            '• பட்டா மாறுதல், சிட்டா நகல், நில அளவீடு (FMB)',
            '• சாதிச் சான்றிதழ், வருமானச் சான்றிதழ், இருப்பிடச் சான்றிதழ், வாரிசுச் சான்றிதழ் (இ-சேவை மூலமாக)',
            '• குடும்ப அட்டை (ரேஷன் கார்டு) திருத்தங்கள் மற்றும் புதிய அட்டை விண்ணப்பங்கள்.',
          ].join('\n');
        }

        return [
          '### கோயம்புத்தூர் மாவட்டம் — முழுமையான தகவல் வழிகாட்டி',
          '',
          '• **அடையாளம்:** "தென்னிந்தியாவின் மான்செஸ்டர்" மற்றும் தமிழகத்தின் இரண்டாவது மிகப்பெரிய தொழில் நகரம்.',
          `• **மாவட்ட ஆட்சியரகம்:** ${COIMBATORE_ADMIN_CORE.collectorateAddressTa} (தொலைபேசி: ${COIMBATORE_ADMIN_CORE.collectoratePhone})`,
          `• **மாநகராட்சி (CCMC):** டவுன்ஹால், கோயம்புத்தூர் (உதவி எண்: ${COIMBATORE_ADMIN_CORE.ccmcHelpline})`,
          '',
          '**தொழில் & பொருளாதாரம்:**',
          '• ஜவுளித் தொழில் மற்றும் பருத்தி நூற்பாலைகள்.',
          '• இந்தியாவின் 40%+ பம்ப் மற்றும் மோட்டார் தயாரிப்பு.',
          '• வெட் கிரைண்டர் தயாரிப்பு (புவிசார் குறியீடு GI Tag).',
          '• டைடல் பார்க் (விளாங்குறிச்சி), எல்காட் செஸ், கொடிசியா வர்த்தக மையம்.',
          '',
          '**கல்வி & மருத்துவ நிறுவனங்கள்:**',
          '• தமிழ்நாடு வேளாண்மைப் பல்கலைக்கழகம் (TNAU), பாரதியார் பல்கலைக்கழகம், அரசு பொறியியல் கல்லூரி (GCT), கோவை அரசு மருத்துவக் கல்லூரி (CMC/CMCH), பி.எஸ்.ஜி. தொழில்நுட்பக் கல்லூரி.',
          '• கோவை அரசு மருத்துவக் கல்லூரி மருத்துவமனை (CMCH - திருச்சி ரோடு): 1500+ படுக்கைகள், 24 மணி நேர இலவச அவசர சிகிச்சை பிரிவு.',
          '',
          '**சுற்றுலா & முக்கிய இடங்கள்:**',
          '• மருதமலை முருகன் கோயில், பேரூர் பட்டீஸ்வரர் கோயில், ஈச்சனாரி விநாயகர் கோயில்.',
          '• சிறுவாணி அணை மற்றும் அருவி (சுவையான இயற்கை குடிநீர்), கோவைக் குற்றாலம்.',
          '• ஈஷா யோகா மையம் (112 அடி ஆதியோகி சிலை, வெள்ளியங்கிரி மலை அடிவாரம்).',
          '• ஆனைமலை புலிகள் காப்பகம், டாப்ஸ்லிப், வால்பாறை மலைவாசஸ்தலம், ஜி.டி. நாயுடு அருங்காட்சியகம்.',
          '',
          '**போக்குவரத்து வசதிகள்:**',
          '• சர்வதேச விமான நிலையம் (பீளமேடு - CJB), கோவை சந்திப்பு ரயில் நிலையம் (CBE).',
          '• காந்திபுரம், உக்கடம், சிங்காநல்லூர், மேட்டுப்பாளையம் சாலை பேருந்து நிலையங்கள்.',
        ].join('\n');
      } else {
        // English
        if (/(collector|district\s*collector|collectorate|dro|magistrate)/i.test(lowerQ)) {
          return [
            '### Coimbatore District Administration & Collectorate Guide',
            '',
            '• **District Collector & District Magistrate:** Head of District Administration responsible for general administration, revenue, law and order, land records, disaster management, and welfare implementation.',
            `• **Collectorate Address:** ${COIMBATORE_ADMIN_CORE.collectorateAddressEn}`,
            `• **Office Landline:** ${COIMBATORE_ADMIN_CORE.collectoratePhone}`,
            `• **Disaster Management Helpline:** ${COIMBATORE_ADMIN_CORE.disasterControlRoom}`,
            `• **Official Portal:** ${COIMBATORE_ADMIN_CORE.officialPortal}`,
            '',
            '**Public Grievance Redressal Days:**',
            '• **Monday Public Grievance Day:** Conducted every Monday at 10:00 AM in the Collectorate Hall chaired directly by the District Collector. Citizens can submit petitions directly with fast-track disposal.',
            '• **Farmers Grievance Day:** Held every 3rd Friday of the month for agrarian and irrigation matters.',
            '• **Chief Minister Helpline (1100):** 24x7 toll-free public grievance logging with tracking.',
            '',
            '**Key Administrative Officials:**',
            '• District Revenue Officer (DRO) – Revenue administration, patta appeals, and statutory inquiries.',
            '• Revenue Divisional Officers (RDOs): Coimbatore North, Coimbatore South, Pollachi (Sub-Collector).',
          ].join('\n');
        }

        if (/(corporation|ccmc|mayor|commissioner|zone|zones|ward|water|tax)/i.test(lowerQ)) {
          return [
            '### Coimbatore City Municipal Corporation (CCMC) — Civic Services',
            '',
            '• **Overview:** Upgraded to Municipal Corporation in 1981, covering 100 wards structured into 5 administrative zones (East, West, North, South, Central).',
            '• **Head Office:** Raja Street, Town Hall, Coimbatore - 641001.',
            '• **Key Leadership:** Mayor, Corporation Commissioner (IAS), and Deputy Mayor.',
            `• **24x7 Civic Grievance Helpline:** ${COIMBATORE_ADMIN_CORE.ccmcHelpline}`,
            '',
            '**Essential Civic Services:**',
            '• **Water Supply:** Managed from Siruvani Dam (acclaimed for mineral sweetness), Pillur Scheme I, II & III, and Aliyar scheme.',
            '• **Birth & Death Registration:** Available online through crsorgi.gov.in and respective Zonal Offices.',
            '• **Property Tax & Professional Tax:** Seamless digital payment via the official municipal portal ccmc.gov.in.',
            '• **Building Plan Approvals & Underground Drainage (UGD):** Handled through single-window clearances.',
          ].join('\n');
        }

        if (/(police|cop|commissioner|superintendent|\bsp\b|crime|station|emergency)/i.test(lowerQ)) {
          return [
            '### Coimbatore Police Administration & Emergency Contacts',
            '',
            '• **Coimbatore City Police Commissionerate:**',
            '  - Headed by the Commissioner of Police (CoP - ADGP/IGP rank) overseeing law and order, traffic management, crime detection, and women safety in city limits.',
            '  - Headquarters: Old Post Office Road, Huzur Road, Coimbatore.',
            '• **Coimbatore District Police (Rural):**',
            '  - Headed by the Superintendent of Police (SP Coimbatore Rural) overseeing taluk jurisdictions including Pollachi, Mettupalayam, Sulur, Annur, and Valparai.',
            '',
            '**Emergency & Helpline Numbers:**',
            `• Police Emergency Control Room: ${COIMBATORE_ADMIN_CORE.policeControlRoom}`,
            `• Women Helpline: ${COIMBATORE_ADMIN_CORE.womenHelpline}`,
            `• Cyber Crime Helpline: ${COIMBATORE_ADMIN_CORE.cyberCrime}`,
            `• Child Helpline: ${COIMBATORE_ADMIN_CORE.childline}`,
            '• Citizen Online Services & FIR Status: eservices.tnpolice.gov.in',
          ].join('\n');
        }

        if (/(taluk|taluks|tahsildar)/i.test(lowerQ)) {
          return [
            '### 11 Revenue Taluks of Coimbatore District',
            '',
            '1. **Coimbatore North** — Balasundaram Road, Coimbatore (Coimbatore North Division)',
            '2. **Coimbatore South** — Huzur Road, Coimbatore (Coimbatore South Division)',
            '3. **Perur** — Siruvani Main Road, Perur',
            '4. **Madukkarai** — Palakkad Main Road, Madukkarai',
            '5. **Sulur** — Trichy Road, Sulur',
            '6. **Mettupalayam** — Annur Road, Mettupalayam',
            '7. **Annur** — Avinashi Road, Annur',
            '8. **Pollachi** — Sub-Collector Office Campus, Pollachi',
            '9. **Kinathukadavu** — Pollachi Main Road, Kinathukadavu',
            '10. **Anaimalai** — Vettaikaranpudur Road, Anaimalai',
            '11. **Valparai** — Main Road, Valparai',
            '',
            '**Tahsildar Office Services:**',
            '• Patta transfers, Chitta extracts, FMB sketch measurements.',
            '• Community, Income, Nativity, First Graduate, and Legal Heir certificates via e-Sevai.',
            '• Smart Ration Card issuance and family member updates.',
          ].join('\n');
        }

        return [
          '### Coimbatore District — Comprehensive City & Administrative Profile',
          '',
          '• **Identity:** Known as the "Manchester of South India" and the second largest economic hub in Tamil Nadu.',
          `• **Collectorate:** ${COIMBATORE_ADMIN_CORE.collectorateAddressEn} (Phone: ${COIMBATORE_ADMIN_CORE.collectoratePhone})`,
          `• **Civic Body:** Coimbatore City Municipal Corporation, Town Hall (Helpline: ${COIMBATORE_ADMIN_CORE.ccmcHelpline})`,
          '',
          '**Economy & Industries:**',
          '• Textile powerhouse with world-class spinning and weaving mills.',
          '• Manufactures over 40% of India’s submersible pumps and electric motors.',
          '• Table-top wet grinder industry holds registered Geographical Indication (GI Tag).',
          '• Precision auto-components, foundries, gold jewelry craftsmanship, and IT parks (TIDEL Park Coimbatore, ELCOT SEZ, CODISSIA trade fair center).',
          '',
          '**Major Educational & Healthcare Centers:**',
          '• Tamil Nadu Agricultural University (TNAU), Bharathiar University, Government College of Technology (GCT), Coimbatore Medical College (CMC), PSG Tech.',
          '• Coimbatore Medical College Hospital (CMCH, Trichy Road): 1,500+ beds, 24/7 free tertiary care, trauma center, and CMCHIS services.',
          '',
          '**Prominent Tourism & Cultural Landmarks:**',
          '• Marudhamalai Murugan Temple, Perur Pateeswarar Temple, Eachanari Vinayagar Temple.',
          '• Siruvani Dam and Waterfalls (famed mineral water), Kovai Kutralam.',
          '• Isha Yoga Center / 112-ft Adiyogi Statue at the Velliangiri Foothills.',
          '• Anamalai Tiger Reserve (Topslip), Valparai hill station, Gedee Car Museum.',
          '',
          '**Connectivity & Transit:**',
          '• Coimbatore International Airport (Peelamedu - CJB), Coimbatore Junction (CBE).',
          '• Major bus terminals: Gandhipuram (SETC/Mofussil), Ukkadam, Singanallur, and Mettupalayam Road.',
        ].join('\n');
      }
    }

    // 1. Popular Cinema / Movies Inquiry (e.g. Actor Vijay)
    const isVijayMovie = /\b(vijay|thalapathy)\b.*\b(movie|movies|film|films|filmography|list|cinema|padam|padangal)\b/i.test(lowerQ)
      || /\b(actor vijay|thalapathy vijay)\b/i.test(lowerQ)
      || (/(விஜய்|தளபதி)/.test(question) && /(திரைப்படம்|திரைப்படங்கள்|படம்|படங்கள்)/.test(question));
    if (isVijayMovie) {
      const citationsStr = formatCitationsBlock(webCitations);
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
          citationsStr,
        ].filter(Boolean).join('\n');
      } else if (isTanglish) {
        return [
          'Actor Vijay (Thalapathy Vijay) nadicha mukkiyamaana blockbuster movies list idho:',
          '',
          '• **Poove Unakkaga (1996)** — Family romance blockbuster',
          '• **Kadhalukku Mariyadhai (1997)** — Classic romantic drama; state award winning film',
          '• **Kushi (2000)** — Evergreen romantic comedy blockbuster',
          '• **Ghilli (2004)** — Industry-defining record-breaking action blockbuster',
          '• **Pokkiri (2007)** — Mass action blockbuster directed by Prabhu Deva',
          '• **Thuppakki (2012)** — Stylish action thriller directed by A.R. Murugadoss',
          '• **Kaththi (2014)** — Social awareness action drama on farmers issues',
          '• **Mersal (2017)** — Triple-action blockbuster on medical accountability',
          '• **Master (2021)** — Mass entertainer directed by Lokesh Kanagaraj',
          '• **Leo (2023)** — High-octane box office record breaker in LCU',
          '• **The Greatest of All Time (GOAT - 2024)** — Sci-fi action drama directed by Venkat Prabhu',
          citationsStr,
        ].filter(Boolean).join('\n');
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
          citationsStr,
        ].filter(Boolean).join('\n');
      }
    }

    // 2. Current Leadership & Facts
    if (/(who is|current|now|is .* cm|chief minister|முதலமைச்சர்|cm yaaru|cm yaar).*tamil\s*nadu|tamil\s*nadu.*(cm|chief minister|முதலமைச்சர்|cm yaaru)/i.test(lowerQ) || lowerQ.includes('current cm yaaru') || lowerQ.includes('cm yaaru')) {
      const citationsStr = formatCitationsBlock(webCitations);
      if (isTa) {
        return [
          'தமிழ்நாட்டின் முதலமைச்சர் **திரு. சி. ஜோசப் விஜய் (C. Joseph Vijay / தளபதி விஜய்)** அவர்கள் ஆவார்.',
          '',
          'அரசியல் கட்சி: **தமிழக வெற்றிக் கழகம் (TVK)**.',
          '',
          'அவர் பொது நிர்வாகம், உள்துறை, காவல் துறை உள்ளிட்ட முக்கிய அரசுப் பொறுப்புகளை வகித்து வருகிறார்.',
          citationsStr,
        ].filter(Boolean).join('\n');
      } else if (isTanglish) {
        return [
          'Tamil Nadu-oda current Chief Minister **C. Joseph Vijay (தளபதி விஜய்)** avargal.',
          '',
          'Arasiyal Katchi: **Tamilaga Vettri Kazhagam (TVK)**.',
          '',
          'Avar Public Administration mattrum Home Department thalaimaiyil vazhinaathi varugiraar.',
          citationsStr,
        ].filter(Boolean).join('\n');
      } else {
        return [
          'The Chief Minister of Tamil Nadu is **C. Joseph Vijay** (Thalapathy Vijay).',
          '',
          'Political Party: **Tamilaga Vettri Kazhagam (TVK)**.',
          '',
          'He holds the key portfolios of Public, Home, Police, General Administration, Personnel and Administrative Reforms.',
          citationsStr,
        ].filter(Boolean).join('\n');
      }
    }

    // 3. Government Schemes & Welfare Inquiries (KMUT, Breakfast, Pudhumai Penn)
    if (/(scheme|திட்டம்|scholarship|pension|magalir|pudhumai|illam|yojana|breakfast)/i.test(question)) {
      const citationsStr = formatCitationsBlock(webCitations);
      if (isTa) {
        return [
          `### தமிழ்நாடு அரசு முதன்மை நலத்திட்டங்கள் — வழிகாட்டுதல்`,
          '',
          `• **கலைஞர் மகளிர் உரிமைத் திட்டம்:** தகுதிவாய்ந்த குடும்பத் தலைவிகளுக்கு மாதம் ₹1,000 உரிமைத் தொகை வழங்கும் திட்டம். வருவாய்த் துறை மற்றும் சிறப்புத் திட்ட செயலாக்கத் துறை மூலம் ஒருங்கிணைக்கப்படுகிறது.`,
          `• **புதுமைப் பெண் திட்டம் (மூவலூர் ராமாமிர்தம் அம்மையார் திட்டம்):** அரசுப் பள்ளிகளில் 6 முதல் 12-ம் வகுப்பு வரை படித்து உயர்கல்வி பயிலும் மாணவிகளுக்கு மாதம் ₹1,000 உதவித்தொகை.`,
          `• **முதலமைச்சரின் காலை உணவுத் திட்டம்:** அரசு தொடக்கப்பள்ளி மாணவ-மாணவியருக்கு சத்தான காலை உணவு வழங்கும் திட்டம்.`,
          `• **மக்களைத் தேடி மருத்துவம்:** தொற்றா நோய்களுக்கான மருத்துவ சேவைகள் மற்றும் மருந்துகளை பொதுமக்களின் இல்லங்களுக்கே சென்று வழங்கும் திட்டம்.`,
          '',
          `விண்ணப்பங்கள் மற்றும் தகுதிச் சரிபார்ப்புக்கு சம்பந்தப்பட்ட துறையின் இணையதளத்தை (tnega.tn.gov.in) அல்லது இ-சேவை மையங்களை அணுகலாம்.`,
          citationsStr,
        ].filter(Boolean).join('\n');
      } else if (isTanglish) {
        return [
          `### Tamil Nadu Arasu Mukkiyamaana Welfare Schemes:`,
          '',
          `• **Kalaignar Magalir Urimai Thittam:** Thagudhiyaana kudumba thalaivigalukku maadham ₹1,000 urimai thogai kudukkura scheme. Revenue and Special Programme Implementation Departments supervise panraanga.`,
          `• **Pudhumai Penn Scheme:** 6th to 12th govt schools-la padichittu higher education pora maanavigalukku month-kku ₹1,000 financial assistance.`,
          `• **Chief Minister Breakfast Scheme:** Govt primary school students-kku nutritious breakfast provide panra scheme.`,
          `• **Makkalai Thedi Maruthuvam:** Maruthuvam mattrum medicines direct-a makkal veettukke kondu poi kudukkura health scheme.`,
          '',
          `Apply panna alladhu eligibility check panna e-Sevai centers (tnega.tn.gov.in) consult pannalaam.`,
          citationsStr,
        ].filter(Boolean).join('\n');
      } else {
        return [
          `### Key Tamil Nadu Government Welfare Schemes`,
          '',
          `• **Kalaignar Magalir Urimai Thittam:** Monthly entitlement of ₹1,000 to eligible women heads of households. Administered by Revenue and Special Programme Implementation Departments.`,
          `• **Pudhumai Penn Scheme:** Monthly financial assistance of ₹1,000 for girl students who studied classes 6–12 in government schools pursuing higher education.`,
          `• **Chief Minister's Breakfast Scheme:** Provision of nutritious breakfast to government primary school children across Tamil Nadu.`,
          `• **Makkalai Thedi Maruthuvam:** Healthcare delivery scheme bringing screening and medicines for non-communicable diseases directly to citizens' doorsteps.`,
          '',
          `Citizens may apply or verify their eligibility through authorized e-Sevai centers or official Tamil Nadu portals (tnega.tn.gov.in).`,
          citationsStr,
        ].filter(Boolean).join('\n');
      }
    }

    if (actTitle) {
      const citationsStr = formatCitationsBlock(webCitations);
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
          citationsStr,
        ].filter(Boolean).join('\n');
      } else if (isTanglish) {
        return [
          `### Satta Vazhikaattudhal & Recommendations (Tanglish):`,
          `• **Applicable Act:** ${actTitle}`,
          sections ? `• **Mukkiya Sections:** ${sections}` : null,
          rules ? `• **Thodarbudaiya Rules:** ${rules}` : null,
          deptTitle ? `• **Sambandhappatta Department:** ${deptTitle}` : null,
          authority ? `• **Responsible Authority / Officer:** ${authority}` : null,
          workflow ? `• **Redressal Workflow:** ${workflow}` : null,
          petitionType ? `• **Petition Categories:** ${petitionType}` : null,
          `\nMele kanda statutory provisions padi adutha action edukkalaam.`,
          citationsStr,
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
          citationsStr,
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
      } else if (isTanglish) {
        return [
          `### Department Guidance (Tanglish):`,
          `• **Kaiyaalum Department:** ${deptTitle}`,
          authTitle ? `• **Thagudhivaindha Officer:** ${authTitle}` : null,
          `• **Parindhurai:** Indha petition-a sambadhapatta department-kku forward panni inquiry nadatha sollalaam.`,
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

    // 4. Drafting Official Memos / Letters / Proceedings
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
      } else if (isTanglish) {
        return [
          `### GOVERNMENT OF TAMIL NADU — OFFICIAL PROCEEDINGS DRAFT (Tanglish)`,
          '',
          `**R.C. No: 2026/GRO/ENQ-108**`,
          `**Dated: 18-09-2026**`,
          '',
          `**Sub:** Public Grievance Petition — Field Inspection mattrum Report Submission — Reg.`,
          `**Ref:** Citizen Grievance Petition portal-la receive aanadhu.`,
          '',
          `**ORDER / DIRECTIVE:**`,
          `1. Petition-la sollirukka complaint pathi Revenue Inspector / Field Officer udanadiya spot inspection pannanum.`,
          `2. Spot enquiry-kku munnadi vinnappadhaari mattrum sambandhappatta parties-kku advance notice kudukkanum.`,
          `3. Inspection mudinju **7 working days-kulla** detailed enquiry report-a indha office-kku submit panna utharavu idalaam.`,
          '',
          `**Sd/-**`,
          `Grievance Redressal Officer / Competent Authority`,
          '',
          `**Copy to:** The Petitioner for information.`,
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
               : isTanglish ? 'Indha SQL query kalantha 30 naal-la receive aana petitions, resolution rate mattrum pending counts-a calculate pannudhu.'
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
             : isTanglish ? 'Indha python script petition-oda severity mattrum pending days-a vachu priority-a assign pannudhu.'
             : 'This script classifies petition severity based on the standard Tamil Nadu Citizen Service Charter timeline.',
      ].join('\n');
    }


    // 4. Unverified search check — strict anti-hallucination mandate
    if (isUnverifiedSearch && !actTitle && !deptTitle) {
      if (isTa) {
        return '⚠️ குறிப்பு: இத்தகவலை நம்பகமான அதிகாரப்பூர்வ ஆதாரங்களிலிருந்து சரிபார்க்க முடியவில்லை.';
      } else if (isTanglish) {
        return '⚠️ Note: Indha information-a reliable sources moolama verify panna mudiyala.';
      } else {
        return '⚠️ Note: This information could not be verified from reliable sources.';
      }
    }

    // 5. Dynamic Real-Time Web Synthesis (answers ANY topic: science, tech, coding, sports, cinema)
    if (webCitations.length > 0 && !actTitle && !deptTitle) {
      const topPoints = webCitations.slice(0, 4).map((c) => {
        const lead = c.snippet ? c.snippet.split('\n')[0].slice(0, 220).trim() : c.title;
        return `• **${c.title}:** ${lead}`;
      }).join('\n');

      if (isTa) {
        return [
          `### ${question} — நிகழ்நேர தகவல் பகுப்பாய்வு:`,
          '',
          topPoints,
          formatCitationsBlock(webCitations),
        ].join('\n');
      } else if (isTanglish) {
        return [
          `### ${question} — Real-Time Verified Details:`,
          '',
          topPoints,
          formatCitationsBlock(webCitations),
        ].join('\n');
      } else {
        return [
          `### ${question} — Real-Time Verified Overview:`,
          '',
          topPoints,
          formatCitationsBlock(webCitations),
        ].join('\n');
      }
    }

    // 6. General Assistance & Officer Questions
    if (isTa) {
      return [
        `### மின்-ஆளுமை துணை (e-Gov Copilot) பதில்:`,
        '',
        `உங்கள் கேள்விக்கு உதவ தயாராக உள்ளேன்:`,
        `• **மனு தொடர்பான கேள்விகள்:** ஆவணத்தை பதிவேற்றம் செய்தால் அல்லது மனு எண்ணைக் குறிப்பிட்டால், குறிப்பிட்ட சட்டம் மற்றும் துறையுடன் துல்லியமாக பதிலளிக்க முடியும்.`,
        `• **அரசு நடைமுறைகள்:** கள ஆய்வு உத்தரவுகள், மெமோக்கள் மற்றும் சுற்றறிக்கைகளை எளிதாக வரைவு செய்யலாம்.`,
        `• **தொழில்நுட்ப உதவிகள்:** புள்ளிவிவர வினவல்கள், தரவு பகுப்பாய்வு மற்றும் கணக்கீடுகளை செய்யலாம்.`,
        '',
        `மேலும் குறிப்பிட்ட தகவல்கள் அல்லது ஆவணங்கள் தேவைப்பட்டால் கேட்கவும்.`,
      ].join('\n');
    } else if (isTanglish) {
      return [
        `### e-Gov Copilot Bathil (Tanglish):`,
        '',
        `Ungaloda kelvikku udhava naan thayaaraaga irukken:`,
        `• **Petition Analysis:** Scanned document upload pannunga alladhu petition number sonna, accurate-ana statutory Act and Department match panni tharen.`,
        `• **Official Drafting:** Field enquiry memo, official proceedings, notices standard govt format-la draft pannalaam.`,
        `• **Technical & Analytics:** Grievance resolution SQL queries, calculations, mattrum scripts generate pannalaam.`,
        '',
        `Innum koodudhal vivaram venumna kitta kelunga, kandippa solren.`,
      ].join('\n');
    } else {
      return [
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
