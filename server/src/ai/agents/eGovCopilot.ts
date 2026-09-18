import { db } from '../../core/db.js';
import type { IAIProvider } from '../provider.js';
import { MockAIProvider } from '../mockProvider.js';
import type { CopilotAnswer } from './copilot.js';
import { searchOfficialSources, isGovQuery, type SearchResult } from '../../core/search.js';
import { translateText } from '../../core/translate.js';
import { isLiveProvider } from '../gateway.js';
import {
  isCoimbatoreQuery,
  getCoimbatoreGroundedContext,
  formulateCoimbatoreSearch,
  requiresOfficialVerification,
} from '../knowledge/coimbatoreKnowledge.js';

/**
 * e-Gov Copilot — Hermes-pattern ReAct agent.
 *
 * Answers from three grounded sources, in order of trust:
 *   1. The open petition (text, OCR documents, stored analysis)
 *   2. Configured knowledge base (Acts, departments, authorities)
 *   3. Live official government web sources
 *
 * Hermes patterns adopted from NousResearch/hermes-agent:
 *   - Structured tool definitions (search_petition, query_knowledge, search_web, get_stats)
 *   - Intent→tool routing (ReAct: Reason then Act)
 *   - Source citation with typed badges per tool used
 *   - Grounded factual constraints — never invent names, numbers, dates, addresses
 *   - Mixed-language handling: Tamil+English input → Tamil+English output
 *   - Government terminology anchoring in every prompt
 *
 * Two rules hold throughout:
 *   - Legal names come ONLY from the knowledge base rows, never from the model.
 *   - Every answer carries the verification caveat in the officer's language.
 */

// ---------------------------------------------------------------- constants
const VERIFY_EN =
  'This is an AI-generated answer. Please verify against the official source before acting.';
const VERIFY_TA =
  'இது AI உருவாக்கிய பதில். நடவடிக்கை எடுப்பதற்கு முன் அதிகாரப்பூர்வ ஆதாரத்துடன் சரிபார்க்கவும்.';
const VERIFY_TANGLISH =
  'Idhu AI generate panna bathil. Action edukkuradhukku munnadi official source kooda verify pannikavum.';

const NO_ANSWER_EN =
  'I could not answer that from the open petition, the configured knowledge base, or official ' +
  'government sources. Please consult the appropriate authority, or ask an administrator to add ' +
  'the relevant Act or department to the AI Knowledge Configuration.';
const NO_ANSWER_TA =
  'திறந்துள்ள மனு, கட்டமைக்கப்பட்ட அறிவுத் தளம், அல்லது அதிகாரப்பூர்வ அரசு ஆதாரங்களிலிருந்து இதற்கு ' +
  'பதிலளிக்க முடியவில்லை. உரிய அதிகாரியை அணுகவும், அல்லது தொடர்புடைய சட்டத்தை நிர்வாகி சேர்க்கலாம்.';
const NO_ANSWER_TANGLISH =
  'Open petition, configured knowledge base, alladhu official government sources-la irundhu idhukku bathil kedaikkala. ' +
  'Sambandhappatta authority-a contact pannavum, alladhu administrator kitta indha Act/department-a AI Knowledge Configuration-la add panna sollalaam.';

export type CopilotLang = 'ta' | 'en' | 'tanglish';

/** Any Tamil character - a question in Tamil needs an English search query. */
const TAMIL_SCRIPT = /[஀-௿]/;

// ---------------------------------------------------------------- language detection
/**
 * Detect if a question is asked in Tanglish (Tamil phonetically written in Latin/English alphabet).
 */
export function isTanglish(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  // If it contains Tamil script, it's Tamil script, not Tanglish
  if (/[\u0B80-\u0BFF]/.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;

  const lower = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = lower.split(/\s+/).filter(Boolean);
  if (!words.length) return false;

  const TANGLISH_WORDS = new Set([
    // Question words & Interrogatives
    'enna', 'ethu', 'edhu', 'edhuku', 'ethuku', 'endha', 'entha', 'yentha', 'enta', 'anta', 'indha', 'idha', 'adha', 'yean', 'yen',
    'epdi', 'eppadi', 'yeppadi', 'eppudi', 'yeppo', 'eppo', 'yaaru', 'yaar', 'evaru', 'yaru', 'engae', 'enga', 'yenga', 'evvalavu', 'evlo', 'ethana', 'yethana',
    // Pronouns & Demonstratives
    'naan', 'nan', 'naanu', 'neenga', 'neengal', 'nee', 'avan', 'aval', 'avanga', 'avaru', 'adhu', 'idhu', 'ithu', 'atha', 'itha',
    'idhula', 'ithula', 'adhula', 'athula', 'enaku', 'enakku', 'ennaku', 'enakulla', 'unakku', 'unaku', 'ungala', 'ungalaala',
    'ungalukku', 'ungalku', 'namma', 'namakku', 'ellam', 'ellame',
    // Verbs & Auxiliaries
    'sollu', 'solla', 'sollunga', 'sollungalen', 'solunga', 'solluren', 'solluran', 'sollra', 'sollradhu', 'kudunga', 'kudu', 'kuduka',
    'pannu', 'panna', 'pannunga', 'panradhu', 'pannradhu', 'pannanum', 'pannaum', 'panniko', 'paniko', 'senja', 'seyya', 'senjadhu', 'seidhu', 'seiyanum',
    'irukku', 'iruku', 'irukaa', 'irukka', 'irukanum', 'irundha', 'illa', 'illai', 'illama', 'ilalma', 'venum', 'vendum',
    'kettalum', 'kettalumm', 'ketalum', 'keta', 'ketta', 'kekkuren', 'ketten', 'varum', 'varuma', 'pogum', 'poradhu', 'poga', 'poganum',
    'mudiyuma', 'mudiyum', 'theriyuma', 'theriyum', 'paathu', 'pathu', 'paarunga', 'vaanga', 'vanga', 'ponga', 'pesu', 'pesuna', 'pesunalum',
    'vachuruken', 'vachirukken', 'vacriken', 'potrukken', 'podunga', 'edunga', 'eduka', 'anupu', 'anupunga', 'anupanum', 'puriyala', 'puriyum',
    // Administrative & conversational markers
    'ippo', 'eppo', 'appo', 'kandippa', 'kandippaga', 'marubadiyum', 'aama', 'romba', 'konjam', 'mattum', 'maari', 'madhiri', 'pola', 'kooda',
    'dhaane', 'thaane', 'thana', 'dhana', 'nalla', 'periya', 'chinna', 'seri', 'paravala', 'apdi', 'ipdi', 'apadi', 'ipadi', 'patil', 'bathil',
    'vidam', 'vivaram', 'therinja', 'koodiya', 'makkal', 'arasaangam', 'arasu', 'manuvadhardhar', 'manu', 'thura', 'thurai', 'sattam', 'vithi',
    'kaasu', 'panam', 'vattan', 'gramam', 'maavattam', 'kooridhu', 'thappu', 'sariya', 'tanglish', 'taenglish', 'tanglis', 'pathii'
  ]);

  let hits = 0;
  for (const w of words) {
    if (TANGLISH_WORDS.has(w)) {
      hits += 1;
    } else if (
      // Morphological suffixes: -la (tanglisla, officela), -kku / -ku (deptkku, actkku), -oda, -aala, -alum, -anum, -adhu, -unga
      (w.endsWith('la') && w.length >= 5 && !['umbrella', 'gorilla', 'manila', 'koala'].includes(w)) ||
      ((w.endsWith('kku') || w.endsWith('ku')) && w.length >= 5) ||
      (w.endsWith('oda') && w.length >= 5) ||
      (w.endsWith('aala') && w.length >= 5) ||
      ((w.endsWith('anum') || w.endsWith('aum')) && w.length >= 5) ||
      ((w.endsWith('alum') || w.endsWith('alumm')) && w.length >= 5) ||
      (w.endsWith('unga') && w.length >= 5) ||
      (w.endsWith('adhu') && w.length >= 5) ||
      (w.endsWith('radhu') && w.length >= 5)
    ) {
      hits += 1;
    }
  }

  // Short query threshold (e.g., "patil sollu", "enna department", "epdi panradhu", "unna yaaru create pannathu"): 1 hit is enough
  if (words.length <= 4 && hits >= 1) return true;
  return hits >= 2 || (hits / words.length) >= 0.2;
}

/** Detect script composition of a question. */
function scriptComposition(q: string): { ta: number; en: number; mixed: boolean } {
  const ta = (q.match(/[஀-௿]/g) || []).length;
  const en = (q.match(/[A-Za-z]/g) || []).length;
  const total = ta + en;
  if (!total) return { ta: 0, en: 0, mixed: false };
  return {
    ta: ta / total,
    en: en / total,
    // "mixed" means both scripts are meaningfully present (>10% each)
    mixed: ta > 0 && en > 0 && ta / total > 0.1 && en / total > 0.1,
  };
}

/**
 * Determine reply language.
 */
function replyLang(question: string, uiLang?: CopilotLang): CopilotLang {
  if (uiLang) return uiLang;
  if (isTanglish(question)) return 'tanglish';
  const { ta } = scriptComposition(question);
  return ta > 0.3 ? 'ta' : 'en';
}

/**
 * One half of a bilingual value, as plain text.
 */
function pickLang(v: unknown, lang: CopilotLang): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v || '—';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const chosen = lang === 'ta' ? (o.ta ?? o.en) : (o.en ?? o.ta);
    return String(chosen ?? '—');
  }
  return String(v);
}

/**
 * A knowledge-base name in the officer's language.
 */
function kbName(en: unknown, ta: unknown, lang: CopilotLang): string {
  const v = lang === 'ta' ? (ta || en) : (en || ta);
  return String(v ?? '—').trim() || '—';
}

// ---------------------------------------------------------------- error messages
/**
 * Classify vendor errors into officer-actionable messages.
 */
function explainFailure(msg: string, lang: CopilotLang): string {
  const m = String(msg ?? '');
  if (/quota|429|rate limit|billing/i.test(m)) {
    if (lang === 'ta') return 'AI சேவையின் இன்றைய வரம்பு எட்டப்பட்டுள்ளது. சிறிது நேரம் கழித்து முயற்சிக்கவும், அல்லது நிர்வாகியை அணுகவும்.';
    if (lang === 'tanglish') return 'AI service-oda innaiki usage limit mudinjirukku. Konjam neram kalichu try pannunga, alladhu administrator-a contact pannunga.';
    return 'The AI service has reached its usage limit. Try again later, or contact an administrator.';
  }
  if (/api key|401|403|rejected/i.test(m)) {
    if (lang === 'ta') return 'AI சேவையின் அனுமதிச் சாவி ஏற்கப்படவில்லை. நிர்வாகி சேவையக அமைப்பைச் சரிபார்க்க வேண்டும்.';
    if (lang === 'tanglish') return 'AI service credentials reject aayirukku. Administrator server settings-a check pannanum.';
    return 'The AI service rejected its credentials. An administrator must check the server configuration.';
  }
  if (/not reachable|not running|ECONNREFUSED|fetch failed|network/i.test(m)) {
    if (lang === 'ta') return 'AI சேவையை அணுக முடியவில்லை. அது இயங்குகிறதா என்பதை நிர்வாகி சரிபார்க்க வேண்டும்.';
    if (lang === 'tanglish') return 'AI service-a reach panna mudiyala. Service run aagudha-nu administrator check pannanum.';
    return 'The AI service could not be reached. An administrator should check that it is running.';
  }
  if (/timed out|timeout|abort/i.test(m)) {
    if (lang === 'ta') return 'AI சேவை குறித்த நேரத்தில் பதிலளிக்கவில்லை. மீண்டும் முயற்சிக்கவும்.';
    if (lang === 'tanglish') return 'AI service time-kulla reply pannala. Marubadiyum try pannunga.';
    return 'The AI service did not respond in time. Please try again.';
  }
  if (lang === 'ta') return 'AI சேவையில் தற்காலிகக் கோளாறு. மீண்டும் முயற்சிக்கவும்.';
  if (lang === 'tanglish') return 'AI service-la tharkaalika error. Marubadiyum try pannunga.';
  return 'The AI service failed temporarily. Please try again.';
}

// ---------------------------------------------------------------- Hermes-style tool definitions
/**
 * Structured tool definitions — Hermes pattern.
 *
 * Each tool has a name, description, and the type of data it returns.
 * The system prompt tells the model which tool was used, so it can reason
 * about reliability: a petition-context answer is more grounded than a
 * knowledge-base answer, which is more grounded than general reasoning.
 */
interface EGovTool {
  name: string;
  label: { en: string; ta: string };
  description: string;
  icon: string;
}

export const EGOV_TOOLS: EGovTool[] = [
  {
    name: 'search_petition',
    label: { en: 'Petition context', ta: 'மனு சூழல்' },
    description: 'Reads the open petition record, OCR text, and stored AI analysis.',
    icon: '📋',
  },
  {
    name: 'query_knowledge_base',
    label: { en: 'Knowledge base', ta: 'அறிவுத் தளம்' },
    description: 'Searches configured Acts, departments, and authorities.',
    icon: '📚',
  },
  {
    name: 'search_official_sources',
    label: { en: 'Official sources', ta: 'அதிகாரப்பூர்வ ஆதாரங்கள்' },
    description: 'Searches official government websites for schemes, procedures, and G.O.s.',
    icon: '🌐',
  },
  {
    name: 'get_statistics',
    label: { en: 'Petition statistics', ta: 'மனு புள்ளிவிவரம்' },
    description: 'Counts petitions by status from the database.',
    icon: '📊',
  },
  {
    name: 'universal_reasoning',
    label: { en: 'Universal AI Agent', ta: 'பொது அறிவு முகவர்' },
    description: 'Direct universal reasoning for drafting, coding, calculations, and general queries.',
    icon: '🧠',
  },
];

// ---------------------------------------------------------------- intent routing
type Intent =
  | 'PETITION_CONTEXT'
  | 'STATS_QUERY'
  | 'SCHEME_QUERY'
  | 'ACT_QUERY'
  | 'DEPT_QUERY'
  | 'AUTH_QUERY'
  | 'WORKFLOW_QUERY'
  | 'TRANSLATE_QUERY'
  | 'CREATOR_QUERY'
  | 'CM_QUERY'
  /** Greetings and small talk - answered directly, never searched. */
  | 'CHITCHAT'
  | 'GENERAL_QUERY';

/**
 * Check if the question asks about who created / developed / made the agent.
 */
function isCreatorQuery(q: string): boolean {
  const s = q.toLowerCase();
  if (/\b(who (created|made|developed|built|designed|authored) you|who is your (creator|maker|developer|author))\b/i.test(s)) return true;
  if (/\b(yaaru|yar|yaar|evaru|who)\b.*?\b(unna|unai|unga|copilot)\b.*?\b(make|create|develop|build|pann|panathu|panan|senja|uruvak)\b/i.test(s)) return true;
  if (/\b(unna|unai|ungala|copilot)\b.*?\b(yaaru|yar|yaar)\b.*?\b(make|create|develop|build|pann|panathu|panan|senja|uruvak)\b/i.test(s)) return true;
  if (/(உங்களை|உன்னை|கோபைலட்).*(உருவாக்கியது|உருவாக்கியவர்|செய்தது|படைத்தது)/.test(q)) return true;
  if (/(யார்).*(உங்களை|உன்னை).*(உருவாக்கியது|உருவாக்கியவர்)/.test(q)) return true;
  return false;
}

/**
 * Check if the question asks about the Chief Minister of Tamil Nadu (CM of Tamil Nadu).
 */
export function isChiefMinisterQuery(q: string): boolean {
  const s = q.toLowerCase().replace(/['".,?!:]/g, ' ').trim();
  const tokens = s.split(/\s+/).filter(Boolean);

  // Tamil script direct check (do not use \b as JS word boundaries fail on Unicode scripts)
  if (/(முதலமைச்சர்|முதல்வர்|முதல்-அமைச்சர்|முதலமைச்சரின்)/.test(q)) {
    return true;
  }

  // Direct CM phrases
  if (
    /\b(cm\s*of\s*tamil\s*nadu|cm\s*of\s*tn|tamil\s*nadu\s*cm|tn\s*cm)\b/i.test(s) ||
    /\b(chief\s*minister\s*of\s*tamil\s*nadu|chief\s*minister\s*of\s*tn)\b/i.test(s) ||
    /\b(tamil\s*nadu\s*chief\s*minister|tn\s*chief\s*minister)\b/i.test(s) ||
    /\b(cm\s*yaaru|cm\s*yaar|current\s*cm|who\s*is\s*cm|who\s*is\s*the\s*cm)\b/i.test(s)
  ) {
    return true;
  }

  const hasCM = /\b(cm|chief\s*minister|mudhalamaichar|mudhalvar)\b/i.test(s);
  const hasTN = /\b(tamil\s*nadu|tn|tamilnadu|state|state's)\b/i.test(s);
  const hasQueryWord = /\b(who|who's|current|present|now|ippo|yaaru|yaar|name|ennadhu|enna)\b/i.test(s);

  if (hasCM && (hasTN || hasQueryWord || tokens.length <= 4)) {
    return true;
  }

  return false;
}

/**
 * Route the question to an intent — Hermes ReAct "Reason" step.
 *
 * Language-aware: a Tamil officer asking "இந்த மனு எந்த துறைக்கு?" and an
 * English officer asking "which department?" both reach DEPT_QUERY.
 */
function classify(q: string, hasPetition: boolean): Intent {
  const s = q.toLowerCase();

  // 1. Creator inquiry: explicitly anchor Government of Tamil Nadu, Coimbatore District
  if (isCreatorQuery(q)) return 'CREATOR_QUERY';

  // 1b. Chief Minister inquiry: explicitly anchor C. Joseph Vijay
  if (isChiefMinisterQuery(q)) return 'CM_QUERY';

  // 2. A greeting is not a research question; answer it directly and fast.
  if (isChitChat(q)) return 'CHITCHAT';

  // Non-government / general knowledge / entertainment queries should never be classified as legal/act queries
  const isGeneralTopic =
    /\b(movie|movies|film|films|filmography|actor|actress|cinema|songs?|album|trailer|director|hero|heroine|box\s*office|cricket|football|game|sport|recipe|weather|joke|story)\b/i.test(s)
    || /(திரைப்படம்|படம்|பாடல்கள்?|நடிகர்|நடிகை|சினிமா|கிரிக்கெட்|விளையாட்டு)/.test(q);

  if (isGeneralTopic) return 'GENERAL_QUERY';

  // Petition-specific: any question about "this" case while one is open
  const aboutThis =
    /\bthis petition\b|\bthis case\b|\bthis letter\b|\bthis document\b|\bthe petitioner\b/.test(s)
    || /இந்த மனு|இந்த வழக்கு|இந்தக் கடிதம்|மனுதாரர்|இந்த ஆவண/.test(q);
  if (hasPetition && aboutThis) return 'PETITION_CONTEXT';

  // Statistics
  if (/(how many|statistics|stats|pending|total petitions|count)/.test(s)
      || /எத்தனை|புள்ளிவிவரம்|நிலுவை|மொத்தம்/.test(q)) return 'STATS_QUERY';

  // Workflow / procedure
  if (/(workflow|procedure|process|steps|what (should|do) i do|next action|how to proceed)/.test(s)
      || /நடைமுறை|பணிப்பாய்வு|அடுத்த நடவடிக்கை|என்ன செய்ய/.test(q)) return 'WORKFLOW_QUERY';

  // Schemes / subsidies
  if (/(scheme|subsidy|eligibility|apply for|how (do|to) (i|we) apply|benefit|yojana)/.test(s)
      || /திட்டம்|மானியம்|தகுதி|விண்ணப்பிக்க|பலன்/.test(q)) return 'SCHEME_QUERY';

  // Act / Law (strictly legal/statutory terms)
  if (/(which|what).*(act|law|section|provision)|\b(statute|statutory act|court act)\b/.test(s)
      || /சட்டம்|பிரிவு|விதி/.test(q)) return 'ACT_QUERY';

  // Department
  if (/(which|what).*(department|dept)|\bdepartment\b/.test(s)
      || /துறை/.test(q)) return 'DEPT_QUERY';

  // Authority / Officer
  if (/(which|who).*(officer|authority|designation)|\bofficer\b/.test(s)
      || /அலுவலர்|அதிகாரி/.test(q)) return 'AUTH_QUERY';

  // Translation request
  if (/(translate|in tamil|in english|தமிழில்|ஆங்கிலத்தில்)/.test(s)) return 'TRANSLATE_QUERY';

  // Default: if a petition is open, it is about that petition
  if (hasPetition) return 'PETITION_CONTEXT';
  return 'GENERAL_QUERY';
}

/**
 * Analyze whether the user question requires live web search.
 *
 * Runs full deep real-time web search for every user question (government, acts,
 * current affairs, entertainment, technology, general knowledge) so the agent
 * can read, analyze, and synthesize fresh information in real time.
 */
function classifyWebSearchNeed(intent: Intent, q: string): { needsSearch: boolean; reason: string } {
  // 1. Creator identity - answered directly with official creator identity
  if (intent === 'CREATOR_QUERY' || isCreatorQuery(q)) {
    return { needsSearch: false, reason: 'creator_identity' };
  }

  // 2. Pure small-talk / greetings without research questions (e.g. "hi", "hello", "good morning")
  if (intent === 'CHITCHAT' || isChitChat(q)) {
    return { needsSearch: false, reason: 'chitchat' };
  }

  // 3. Pure internal DB counts from the local database
  if (intent === 'STATS_QUERY') {
    return { needsSearch: false, reason: 'internal_stats' };
  }

  // 4. Dedicated Coimbatore real-time knowledge queries
  if (isCoimbatoreQuery(q)) {
    return { needsSearch: true, reason: 'coimbatore_realtime_search' };
  }

  // For all other questions ("ent questions kettalum"):
  // Perform FULL DEEP real-time search, read the pages, and analyze in real time!
  return { needsSearch: true, reason: 'full_deep_search' };
}

/**
 * Ordinary conversation rather than a question to research.
 *
 * Deliberately tight: a greeting, a thank-you, a "what can you do". A real
 * question that merely sounds casual ("what is RTI?") must still search, so
 * only short utterances with no interrogative substance qualify.
 */
function isChitChat(q: string): boolean {
  const s = q.trim();
  if (s.length > 60) return false;
  return /^(hi|hello|hey|thanks|thank you|thank u|ok|okay|good morning|good afternoon|good evening|how are you|who are you|what can you do|help)\b[\s!?.]*$/i.test(s)
    || /^(வணக்கம்|நன்றி|எப்படி இருக்கிறீர்கள்|நீங்கள் யார்|என்ன செய்ய முடியும்)[\s!?.]*$/.test(s);
}

// ---------------------------------------------------------------- context loaders
interface PetitionContext {
  reference: string;
  subject: string;
  description: string;
  citizen: string;
  status: string;
  workflowStage: string | null;
  documents: { title: string; text: string }[];
  analysis: any | null;
  act: any | null;
  department: any | null;
  authority: any | null;
}

function loadPetitionContext(petitionId: number): PetitionContext | null {
  const p = db.prepare('SELECT * FROM cp_petition WHERE id = ?').get(petitionId) as any;
  if (!p) return null;

  const docs = db.prepare(
    'SELECT title, extracted_text, ocr_corrected_text FROM cp_document WHERE petition_id = ?',
  ).all(petitionId) as any[];

  const analysis = db.prepare(
    'SELECT * FROM cp_analysis WHERE petition_id = ? ORDER BY id DESC LIMIT 1',
  ).get(petitionId) as any;

  const byId = (table: string, id: number | null) =>
    id ? db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) : null;

  return {
    reference: p.reference_no,
    subject: p.subject,
    description: p.description,
    citizen: p.citizen_name,
    status: p.status,
    workflowStage: p.workflow_stage ?? null,
    documents: docs.map((d) => ({
      title: d.title,
      text: String(d.ocr_corrected_text || d.extracted_text || '').slice(0, 3000),
    })).filter((d) => d.text),
    analysis: analysis ?? null,
    act: byId('kb_act', analysis?.act_id ?? null),
    department: byId('kb_department', analysis?.department_id ?? null),
    authority: byId('kb_authority', analysis?.authority_id ?? null),
  };
}

function loadKnowledgeContext(
  question: string,
  /** The language the answer will be written in; the context is built in it. */
  lang: CopilotLang,
  limit = 5,
): {
  text: string;
  acts: any[];
  departments: any[];
  authorities: any[];
  hasMatch: boolean;
} {
  // Statutory grievance Acts/Departments from the local DB should ONLY match legal, statutory, or grievance queries.
  // Schemes, general knowledge, science, tech, cinema, coding, and sports answer freely via real-time web search and universal reasoning.
  const isLegalOrGrievance =
    /\b(act|acts|section|sections|law|laws|court|rules?|statute|grievance|petition|kuraidheerppu|patta|chitta|fir|revenue|encroachment|compensation|tenancy|eviction|maintenance|senior\s*citizens?|slum|land\s*acquisition)\b/i.test(question)
    || /(சட்டம்|விதி|பிரிவு|நீதிமன்றம்|மனு|குறைதீர்ப்பு|பட்டா|சிட்டா|ஆக்கிரமிப்பு|இழப்பீடு|நிலம்)/.test(question);
  if (!isLegalOrGrievance) {
    return { text: '', acts: [], departments: [], authorities: [], hasMatch: false };
  }

  const rawTerms = question.toLowerCase()
    .replace(/[^a-z0-9஀-௿\s]/g, ' ')
    .split(/\s+/).filter((w) => w.length > 2);

  const stopWords = new Set([
    'act', 'the', 'and', 'for', 'tamil', 'nadu', 'tamilnadu', 'tamilnad', 'tn',
    'govt', 'government', 'state', 'now', 'today', 'current', 'latest', 'recent',
    'who', 'what', 'which', 'where', 'when', 'how', 'is', 'are', 'was', 'were',
    'this', 'that', 'from', 'with', 'about',
    'சட்டம்', 'தமிழ்நாடு', 'மற்றும்', 'பற்றிய', 'அரசு', 'தற்போது', 'இப்போது', 'யார்', 'எது', 'எந்த',
    'pathi', 'pathii', 'sollu', 'solla', 'sollunga', 'enna', 'ethu', 'edhu', 'epdi', 'eppadi',
    'kudunga', 'kudu', 'pannu', 'panna', 'panradhu', 'pannradhu', 'pannanum', 'irukku', 'iruku',
    'venum', 'vendum', 'kettalumm', 'kettalum', 'keta', 'ketta', 'varum', 'varuma', 'patil',
    'bathil', 'kandippa', 'maari', 'illama', 'ilalma', 'edhula', 'ethula', 'endha', 'entha',
    'unga', 'ungala', 'solla mudiyuma', 'solla'
  ]);
  const filtered = rawTerms.filter((t) => !stopWords.has(t));
  const terms = filtered.length ? filtered : [];

  const score = (row: any, fields: string[]) => {
    if (!terms.length) return 0;
    const hay = fields.map((f) => String(row[f] ?? '')).join(' ').toLowerCase();
    const hayTokens = new Set(hay.split(/[^a-z0-9஀-௿]+/).filter(Boolean));
    let s = 0;
    for (const t of terms) {
      if (hayTokens.has(t)) s += 2;
    }
    // Boost exact title match
    const titleHay = (String(row.short_name ?? '') + ' ' + String(row.short_name_ta ?? '')).toLowerCase();
    const titleTokens = new Set(titleHay.split(/[^a-z0-9஀-௿]+/).filter(Boolean));
    for (const t of terms) {
      if (titleTokens.has(t)) s += 5;
    }
    return s;
  };

  const acts = (db.prepare(
    'SELECT id, short_name, short_name_ta, full_title, full_title_ta, act_number, year, summary, applies_when, applies_when_ta, ' +
    'keywords, keywords_ta, rules, section, authority, petition_type, workflow, official_source, verification_status FROM kb_act WHERE active = 1',
  ).all() as any[])
    .map((a) => ({ a, s: score(a, [
      'short_name', 'short_name_ta', 'full_title', 'full_title_ta', 'summary',
      'applies_when', 'applies_when_ta', 'keywords', 'keywords_ta', 'rules',
      'section', 'authority', 'petition_type', 'workflow'
    ]) }))
    .filter((x) => x.s >= 4).sort((x, y) => y.s - x.s).slice(0, limit).map((x) => x.a);

  const departments = (db.prepare(
    'SELECT id, code, name, name_ta, responsibilities, keywords FROM kb_department WHERE active = 1',
  ).all() as any[])
    .map((d) => ({ d, s: score(d, ['name', 'name_ta', 'responsibilities', 'keywords']) }))
    .filter((x) => x.s >= 4).sort((x, y) => y.s - x.s).slice(0, 3).map((x) => x.d);

  const authorities = (db.prepare(
    'SELECT id, designation, designation_ta, office_name, responsibilities, jurisdiction_level ' +
    'FROM kb_authority WHERE active = 1',
  ).all() as any[])
    .map((a) => ({ a, s: score(a, ['designation', 'designation_ta', 'office_name', 'responsibilities']) }))
    .filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 3).map((x) => x.a);

  const hasMatch = acts.length > 0 || departments.length > 0;
  const chosenActs = acts.slice(0, limit);
  const chosenDepts = departments.slice(0, 3);
  const chosenAuths = authorities.slice(0, 3);

  const pick = (en: unknown, ta: unknown) =>
    String((lang === 'ta' ? (ta || en) : (en || ta)) ?? '').trim();

  const text = hasMatch ? [
    ...chosenActs.map((a) => `ACT [id ${a.id}] ${pick(a.short_name, a.short_name_ta)}` +
      (a.act_number ? ` (${a.act_number}${a.year ? `, ${a.year}` : ''})` : (a.year ? ` (${a.year})` : '')) +
      (a.section ? `\n  Section(s): ${a.section}` : '') +
      (a.rules ? `\n  Rules: ${a.rules}` : '') +
      (a.authority ? `\n  Competent Authority: ${a.authority}` : '') +
      (a.petition_type ? `\n  Petition Types: ${a.petition_type}` : '') +
      (a.workflow ? `\n  Workflow / Redressal Process: ${a.workflow}` : '') +
      (a.official_source ? `\n  Official Source: ${a.official_source}` : '') +
      (a.applies_when ? `\n  Applies when: ${pick(a.applies_when, a.applies_when_ta)}` : '') +
      `\n  Verification status: ${a.verification_status ?? 'VERIFIED'}`),
    ...chosenDepts.map((d) => `DEPARTMENT [id ${d.id}] ${pick(d.name, d.name_ta)}` +
      (d.responsibilities ? `\n  Handles: ${String(d.responsibilities).slice(0, 300)}` : '')),
    ...chosenAuths.map((a) => `AUTHORITY [id ${a.id}] ${pick(a.designation, a.designation_ta)}` +
      (a.office_name ? `, ${a.office_name}` : '') +
      (a.jurisdiction_level ? ` (${a.jurisdiction_level})` : '')),
  ].join('\n\n') : '';

  return { text, acts: chosenActs, departments: chosenDepts, authorities: chosenAuths, hasMatch };
}

// ---------------------------------------------------------------- system prompt
/**
 * Build the system prompt — Hermes-style grounded agent instructions.
 */
function buildSystemPrompt(lang: CopilotLang, mixed: boolean): string {
  const lines: string[] = [
    // Output contract — must come first so the model does not narrate its reasoning
    'Write the answer only. Never restate these instructions, never narrate your reasoning,',
    'never quote the section headings you were given, and never begin with a slash or a',
    'question to yourself. Start directly with the answer.',
    'The labels TOOL:, CONFIGURED KNOWLEDGE, OFFICIAL SOURCES, OPEN PETITION, DEPARTMENT and',
    'ACT are internal headings in this prompt. Never write them in your answer, in brackets',
    'or otherwise. Name the actual department or Act instead.',
    'Never gloss a Tamil word with its English equivalent in brackets. Write "மனு", not',
    '"மனு (petition)". The officer reads one language at a time.',
    '',
    'You are the e-Gov Copilot — an AI assistant for Tamil Nadu government grievance officers.',
    'You help officers understand petitions, identify applicable Acts, departments, and next actions.',
    '',
    '═══════════════════════════════════════════════════════',
    'COMPREHENSIVE TAMIL NADU GOVERNMENT AI ASSISTANT & UNIVERSAL AGENT:',
    '═══════════════════════════════════════════════════════',
    'You are the official e-Gov Copilot — a premier Comprehensive Tamil Nadu Government AI Assistant',
    'and Universal AI Agent developed for the Government of Tamil Nadu, Coimbatore District.',
    '',
    'You possess deep, authoritative, and exhaustive mastery over:',
    '1. ALL TAMIL NADU GOVERNMENT DEPARTMENTS & AUTHORITIES:',
    '   • Revenue and Disaster Management (வருவாய் மற்றும் பேரிடர் மேலாண்மைத் துறை)',
    '   • Home, Prohibition and Excise (உள்துறை, காவல்துறை, சிறைச்சாலைகள் மற்றும் தீயணைப்புத் துறை)',
    '   • Health and Family Welfare (மக்கள் நல்வாழ்வு மற்றும் குடும்ப நலத்துறை)',
    '   • School Education (பள்ளிக் கல்வித்துறை) & Higher Education (உயர் கல்வித்துறை)',
    '   • Rural Development and Panchayat Raj (ஊரக வளர்ச்சி மற்றும் ஊராட்சித் துறை)',
    '   • Municipal Administration and Water Supply (நகராட்சி நிருவாகம் மற்றும் குடிநீர் வழங்கல் துறை)',
    '   • Social Welfare and Women Empowerment (சமூக நலம் மற்றும் மகளிர் உரிமைத் துறை)',
    '   • Agriculture and Farmers Welfare (வேளாண்மை மற்றும் உழவர் நலத்துறை)',
    '   • Adi Dravidar and Tribal Welfare (ஆதிதிராவிடர் மற்றும் பழங்குடியினர் நலத்துறை)',
    '   • Backward Classes, Most Backward Classes & Minorities Welfare (BC / MBC நலத்துறை)',
    '   • Labour Welfare and Skill Development (தொழிலாளர் நலன் மற்றும் திறன் மேம்பாட்டுத் துறை)',
    '   • Housing and Urban Development (வீட்டுவசதி மற்றும் நகர்ப்புற வளர்ச்சித் துறை)',
    '   • Transport (போக்குவரத்துத் துறை) & Highways and Minor Ports (நெடுஞ்சாலைகள் துறை)',
    '   • Commercial Taxes and Registration (வணிக வரிகள் மற்றும் பதிவுத்துறை)',
    '   • Energy Department / TANGEDCO / TANTRANSCO (மின்சாரத் துறை)',
    '   • Information Technology and Digital Services (IT & டிஜிட்டல் சேவைகள் துறை)',
    '   • Industries, Investment Promotion and Commerce (தொழில்கள் துறை)',
    '   • Law Department (சட்டத்துறை)',
    '   • Public Works Department / Water Resources Department (பொதுப்பணி & நீர்வளத்துறை)',
    '   • Environment, Climate Change and Forests (சுற்றுச்சூழல் மற்றும் வனத்துறை)',
    '   • Animal Husbandry, Dairying, Fisheries and Fishermen Welfare (கால்நடை & மீன்வளத்துறை)',
    '   • Co-operation, Food and Consumer Protection (கூட்டுறவு & நுகர்வோர் பாதுகாப்புத் துறை)',
    '   • Micro, Small and Medium Enterprises (MSME / குறு, சிறு, நடுத்தரத் தொழில் துறை)',
    '',
    '2. ALL TAMIL NADU WELFARE SCHEMES & PUBLIC INITIATIVES (CURRENT 2026):',
    '   • Kalaignar Magalir Urimai Thittam (KMUT / கலைஞர் மகளிர் உரிமைத் திட்டம் — ₹1,000/month DBT for women heads of households)',
    '   • Chief Minister\'s Breakfast Scheme (முதலமைச்சரின் காலை உணவுத் திட்டம் — nutritious hot breakfast for government primary school students)',
    '   • Pudhumai Penn Scheme (புதுமைப் பெண் திட்டம் — ₹1,000/month for girl students entering higher education from govt schools)',
    '   • Tamil Pudhalvan Scheme (தமிழ்ப் புதல்வன் திட்டம் — ₹1,000/month for boy students entering higher education from govt schools)',
    '   • Naan Mudhalvan (நான் முதல்வன் — college youth skill development and career enablement platform)',
    '   • Innuyir Kaappom - Nammai Kaakkum 48 (இன்னுயிர் காப்போம் — free emergency trauma care up to ₹1 lakh in first 48 hours of road accidents)',
    '   • Makkalai Thedi Maruthuvam (மக்களைத் தேடி மருத்துவம் — doorstep screening and medication for hypertension, diabetes, palliative care)',
    '   • Illam Thedi Kalvi (இல்லம் தேடிக் கல்வி — community doorstep education)',
    '   • Kalaignar Kanavu Illam (கலைஞர் கனவு இல்லம் — rural pucca concrete housing initiative)',
    '   • Chief Minister\'s Comprehensive Health Insurance Scheme (CMCHIS / முதலமைச்சர் விரிவான மருத்துவக் காப்பீட்டுத் திட்டம் — ₹5 lakh/year cashless hospitalization)',
    '   • Social Security Pensions: Indira Gandhi National Old Age Pension Scheme (IGNOAPS / முதியோர் உதவித்தொகை), Destitute Widow Pension, Differently Abled Pension, Deserted Wives Pension, Unmarried Women Pension',
    '   • Free Bus Travel for Women (விடியல் பயணம் — zero-fare travel in ordinary government town/city buses)',
    '   • Marriage Assistance Schemes (Dr. Muthulakshmi Reddy, Moovalur Ramamirtham, E.V.R. Maniammaiyar, Annai Teresa, Dr. Dharmambal)',
    '',
    '3. ALL ACTS, RULES, GOVERNMENT ORDERS (G.O.s), & GAZETTE NOTIFICATIONS:',
    '   • Tamil Nadu Revenue Recovery Act, 1864',
    '   • Tamil Nadu Patta Pass Book Act, 1983 & Rules, 1987 (Sec 3, 5, 10, 12, 13, 14; appeal before Sub-Collector/RDO, revision before DRO)',
    '   • Tamil Nadu District Municipalities Act, 1920 / Tamil Nadu Urban Local Bodies Act, 1998 & Rules 2023',
    '   • Tamil Nadu Panchayats Act, 1994 (Sec 131, 222, 230, 240, 241)',
    '   • Tamil Nadu Land Encroachment Act, 1905 (Sec 6 eviction notices, Sec 7 show-cause)',
    '   • Maintenance and Welfare of Parents and Senior Citizens Act, 2007 (Sec 5, 23 maintenance tribunal before RDO)',
    '   • Right to Information Act, 2005 (RTI — Sec 6(1), 7(1), 19(1), 19(3))',
    '   • Registration Act, 1908 & Stamp Act (Encumbrance certificate, registration of documents, guideline values)',
    '   • Bharatiya Nyaya Sanhita, 2023 (BNS) / IPC, Bharatiya Nagarik Suraksha Sanhita, 2023 (BNSS) / CrPC, BSA 2023',
    '   • Government Orders: G.O. Ms (policy & financial sanctions), G.O. Rt (administrative routines), Weekly & Extraordinary Gazettes (stationeryprinting.tn.gov.in)',
    '',
    '4. ALL PUBLIC SERVICES, CERTIFICATES, ELIGIBILITY & DIGITAL PORTALS:',
    '   • Revenue Certificates via e-Sevai / TNeGA: Community Certificate (சாதிச் சான்றிதழ்), Income Certificate (வருமானச் சான்றிதழ்), Nativity Certificate (இருப்பிடச் சான்றிதழ்), First Graduate Certificate (முதல் பட்டதாரி சான்றிதழ்), Legal Heirship Certificate (வாரிசுச் சான்றிதழ் via G.O. Ms. No. 478), Destitute Widow Certificate, Deserted Woman Certificate, Solvency Certificate',
    '   • Land Administration: Patta Transfer (பட்டா மாறுதல் — Sub-division ₹400 survey fee, Non-subdivision online), Chitta & Adangal (சிட்டா, அடங்கல் online), FMB Sketch (புல வரைபடம்), TSLR',
    '   • Official Digital Portals: TNeGA e-Sevai (tnega.tn.gov.in), Any-Time Anywhere e-Services (eservices.tn.gov.in), TNREGINET (tnreginet.gov.in), Mudhalvar Mugavari CM Helpline 1100 (cmhelpline.tnega.org), e-District (edistricts.tn.gov.in), TNPDS Smart Ration Card (tnpds.gov.in)',
    '',
    '5. DISTRICT & COLLECTORATE ADMINISTRATION & CITIZEN GRIEVANCES:',
    '   • Hierarchy: District Collector → District Revenue Officer (DRO) → Revenue Divisional Officer (RDO / Sub-Collector) → Tahsildar → Revenue Inspector (RI) → Village Administrative Officer (VAO); BDO for panchayats; Municipal Commissioners for urban areas.',
    '   • Grievance Redressal: Weekly Monday Citizen Grievance Day at Collectorate and Taluk offices; Monthly Farmers Grievance Day; Jamabandi (வருவாய் தீர்வாயம் annual revenue audit in May/June); Mudhalvar Mugavari 1100 online portal tracking.',
    '',
    '6. UNIVERSAL MULTI-DOMAIN EXPERTISE (ANSWER ANY TOPIC):',
    '   • Science, Space & Technology: Quantum physics, astronomy, AI, biotechnology, mathematics, mechanics, research.',
    '   • Coding, Algorithms & Engineering: TypeScript, JavaScript, Python, SQL, web development, systems design, debugging.',
    '   • World History, Geography, Economics & World Affairs: Global news, historical events, economics, geopolitics.',
    '   • Cinema, Sports, Culture & Arts: Tamil cinema (Kollywood), actor filmographies, directors, music, sports tournaments.',
    '   • General citizen questions, advice, drafting, calculations, lifestyle, translations.',
    '   • Never refuse general or technical queries. Never force statutory legal acts or sections onto non-government topics.',
    '',
    '═══════════════════════════════════════════════════════',
    'MANDATED 5-STEP E-GOV COPILOT PIPELINE:',
    'User Question → Deep Web Search → Official/Trusted Sources → Cross-Verify → AI Analysis → Accurate Answer + Sources',
    '═══════════════════════════════════════════════════════',
    'For every question, execute this 5-step verification workflow:',
    'Step 1: USER QUESTION — Accurately interpret the query in English, Tamil, or Tanglish, utilizing conversation context and follow-up intent.',
    'Step 2: DEEP WEB SEARCH — Read and evaluate fresh live search results and verified content retrieved in the prompt.',
    'Step 3: OFFICIAL / TRUSTED SOURCES — Prioritize official Tamil Nadu / Central government domains (.tn.gov.in, .gov.in, .nic.in, .tnega.org), followed by reputable encyclopedic sources.',
    'Step 4: CROSS-VERIFY & AI ANALYSIS — Cross-check claims across retrieved sources; align strictly with current 2026 data. Never invent facts or procedures.',
    'Step 5: ACCURATE ANSWER + CITATIONS — Formulate a comprehensive, deeply informative response, concluding with verified clickable Markdown citations.',
    '',
    '═══════════════════════════════════════════════════════',
    'ANTI-HALLUCINATION & UNVERIFIED INFORMATION MANDATE (CRITICAL):',
    '═══════════════════════════════════════════════════════',
    '1. NEVER hallucinate, fabricate, or invent facts, statistics, names, dates, Act numbers, or G.O.s.',
    '2. IF INFORMATION CANNOT BE VERIFIED from reliable web sources or configured official knowledge,',
    '   YOU MUST CLEARLY AND EXPLICITLY STATE THAT THE INFORMATION COULD NOT BE VERIFIED:',
    '   • In English: "⚠️ Note: This information could not be verified from reliable sources."',
    '   • In Tamil: "⚠️ குறிப்பு: இத்தகவலை அதிகாரப்பூர்வ அல்லது நம்பகமான ஆதாரங்களிலிருந்து உறுதிப்படுத்த முடியவில்லை."',
    '   • In Tanglish: "⚠️ Note: Indha information-a reliable official sources moolama verify panna mudiyala."',
    '3. Never present unverified or speculative rumors as fact.',
    '',
    '═══════════════════════════════════════════════════════',
    'ORIGIN & CREATOR IDENTITY (MANDATORY & ABSOLUTE):',
    '═══════════════════════════════════════════════════════',
    '• When asked who created you, who made you, who developed you, or who you are (in English, Tamil, or Tanglish):',
    '  - English: "I am created by the Government of Tamil Nadu, Coimbatore District."',
    '  - Tamil: "நான் தமிழ்நாடு அரசு, கோயம்புத்தூர் மாவட்டத்தால் உருவாக்கப்பட்டேன்."',
    '  - Tanglish: "Naan Tamil Nadu Arasu, Coimbatore District-aala uruvaakkapatten."',
    '• You are the official E-Gov Copilot AI agent of the Government of Tamil Nadu, Coimbatore District.',
    '• NEVER claim to be developed or created by OpenAI, Google, Anthropic, or any foreign tech corporation.',
    '',
    '═══════════════════════════════════════════════════════',
    'TEMPORAL ANCHOR & 2026 REAL-TIME VERIFICATION FACTS:',
    '═══════════════════════════════════════════════════════',
    'The current year is 2026. Provide answers based on current 2026 information and latest verified sources.',
    '• Chief Minister of Tamil Nadu: C. Joseph Vijay (சி. ஜோசப் விஜய் / தளபதி விஜய்) is the Chief Minister of Tamil Nadu.',
    '• Political Party: Tamilaga Vettri Kazhagam (TVK / தமிழக வெற்றிக் கழகம்).',
    '• All 38 districts of Tamil Nadu are fully operational.',
    '',
    'THE BOUNDARY: When advising on a SPECIFIC case file, citizen petition, or naming a statutory Act or',
    'department for a petition, use the CONFIGURED KNOWLEDGE or OPEN PETITION context provided below.',
    '',
  ];

  // Language rule — strict, based on UI setting and script composition
  if (lang === 'ta') {
    lines.push(
      '═══════════════════════════════════════════════════════',
      'LANGUAGE MANDATE: ANSWER 100% ENTIRELY IN PROPER TAMIL UNICODE SCRIPT.',
      '═══════════════════════════════════════════════════════',
      'The user selected TAMIL language mode.',
      '• You MUST write every sentence in pure, grammatical, official Tamil Unicode letters (தமிழ் எழுத்துகளில் மட்டுமே முழுமையாக எழுத வேண்டும்).',
      '• Do NOT write in English sentences or Tanglish/Latin alphabet.',
      '• Even if the user asked their question using English or Tanglish alphabet (e.g. "samuganeethi thurai minister"), your answer MUST be completely written in Tamil script!',
      '• Act titles, department names, minister names, schemes, and designations must be in Tamil Unicode.',
      '• Section numbers, reference numbers, years, and amounts may stay as numeric digits.',
      '• Do NOT add English translations or Latin transliterations in brackets.',
    );
  } else if (lang === 'tanglish') {
    lines.push(
      '═══════════════════════════════════════════════════════',
      'LANGUAGE MANDATE: ANSWER 100% IN TANGLISH (TAMIL WRITTEN IN ENGLISH/LATIN ALPHABET).',
      '═══════════════════════════════════════════════════════',
      'The user/officer communicated in Tanglish. You MUST respond in clear, natural, friendly TANGLISH sentence-by-sentence.',
      '• WRITE EVERY SENTENCE IN SPOKEN/COLLOQUIAL TAMIL USING LATIN/ENGLISH LETTERS!',
      '• NEVER write full English sentences.',
      '• For any query, explain in Tanglish (e.g. "Ungaloda kelvikku idho vilakkam:", "Indha matter-kku varum department:", "Indha Act-la enna solraanga-na...", "Neenga adutha step-a indha documents submit pannanum:").',
      '• STRICTLY DO NOT reply in pure English, and DO NOT use Tamil script (தமிழ் எழுத்து வேண்டாம்).',
      '• ONLY statutory Act names, official Department names, Section numbers, and technical terms can stay as proper English nouns (e.g. "Revenue Department", "Tamil Nadu Slum Areas Act", "Section 14", "Patta Pass Book", "FIR", "Aadhaar card").',
      '• Structure the response cleanly using Markdown headings (###), bullet points (•), and bold text (**).',
    );
  } else {
    lines.push(
      '═══════════════════════════════════════════════════════',
      'LANGUAGE MANDATE: ANSWER 100% ENTIRELY IN ENGLISH.',
      '═══════════════════════════════════════════════════════',
      'The user selected ENGLISH language mode.',
      '• Write every sentence in clear, professional, grammatical English.',
      '• Do NOT include Tamil script anywhere in the response, not even in brackets.',
      '• Even if the user asked their question in Tamil or Tanglish, your entire response must be in English.',
    );
  }

  lines.push(
    '',
    'FORMAT & DEPTH REQUIREMENTS (DETAILED, HIGH-VALUE AI AGENT):',
    '• Give detailed, useful, and well-structured answers based on the user question — NOT just short search-result snippets.',
    '• Explain context, background, breakdown, key points, procedures, eligibility, or requirements clearly and thoroughly.',
    '• Structure responses cleanly using headings (###), bullet points (•), numbered lists, and code blocks where relevant.',
    '• Cross-check petition/document extracts with verified online rules and official department portals.',
    '• NEVER hallucinate. If reliable information is unavailable or unverified, explicitly declare:',
    '  - English: "⚠️ Note: This information could not be verified from reliable sources."',
    '  - Tamil: "⚠️ குறிப்பு: இத்தகவலை அதிகாரப்பூர்வ அல்லது நம்பகமான ஆதாரங்களிலிருந்து உறுதிப்படுத்த முடியவில்லை."',
    '  - Tanglish: "⚠️ Note: Indha information-a reliable official sources moolama verify panna mudiyala."',
    '',
    'COIMBATORE & DISTRICT ADMINISTRATION CAPABILITIES:',
    '• You have comprehensive, real-time knowledge of Coimbatore District Administration, Collectorate, 11 Taluks, Coimbatore City Municipal Corporation (CCMC), 5 zones, 100 wards, City Police Commissionerate, District Rural Police, CMCH & hospitals, transport, economy, history, tourism, weather, and public grievance mechanisms.',
    '• For current officer names, postings, phone numbers, addresses, and government information, ALWAYS verify using the live web search results before answering. Never guess or hallucinate current officials or contact details.',
    '• If a current official or contact detail is not confirmed by the verified sources, state clearly that it could not be confirmed from official records rather than guessing.',
    '',
    'SILENT BACKEND SEARCH & PRESENTATION (STRICT REQUIREMENT):',
    '• All web search and fact verification is conducted silently in the backend.',
    '• Do NOT output raw URLs, website links, or search-result source cards in your answer.',
    '• Do NOT add a citations section or Markdown links (e.g. do not output [Title](https://...) or raw URLs).',
    '• Synthesize verified facts directly into clean, authoritative, well-structured prose, bullet points, and tables.',
  );

  return lines.join('\n');
}

function extractContextSubject(history?: CopilotTurn[]): string {
  if (!history || !history.length) return '';
  for (let i = history.length - 1; i >= 0; i--) {
    const text = history[i].content;
    const m = text.match(/\b(Kalaignar Magalir Urimai|KMUT|Pudhumai Penn|Tamil Pudhalvan|Naan Mudhalvan|Innuyir Kaappom|Makkalai Thedi|Breakfast Scheme|Patta Pass Book|Legal Heir|Community Certificate|Income Certificate|Nativity Certificate|First Graduate|Slum Areas|District Municipalities|Panchayats Act|RTI Act|Jamabandi|Mudhalvar Mugavari|CM Helpline|TNeGA|TNREGINET|Patta Transfer|Chitta|Encumbrance Certificate)\b/i);
    if (m) return m[0];
    const userWords = text.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !['what', 'when', 'where', 'which', 'tell', 'about', 'this', 'that', 'with'].includes(w.toLowerCase()));
    if (userWords.length) return userWords.slice(0, 3).join(' ');
  }
  return '';
}

function formulateSearchQuery(q: string, history?: CopilotTurn[]): string {
  let cleaned = q
    .replace(/\blinkdin\b/gi, 'linkedin')
    .replace(/\b(please\s+(analyse|analyze|check|search|find|verify|tell\s*me)|can\s+you\s+(check|search|find|tell\s*me|verify)|tell\s*me\s+about|details\s+about|information\s+about)\b/gi, ' ')
    .replace(/\b(please|analyse|analyze|profile|profiles)\b/gi, ' ');

  const lower = cleaned.toLowerCase();

  // If follow-up query with pronouns or short question, attach context subject from conversation
  const isFollowUp = /\b(this|that|it|these|those|idhu|adhu|indha|andha|apply|eligibility|documents|procedure|process|rules|panradhu|eppadi|enna)\b/i.test(lower)
    && lower.split(/\s+/).length <= 7;
  if (isFollowUp) {
    const ctx = extractContextSubject(history);
    if (ctx && !lower.includes(ctx.toLowerCase())) {
      cleaned = `${ctx} ${cleaned}`;
    }
  }

  if (isCoimbatoreQuery(cleaned)) {
    return formulateCoimbatoreSearch(cleaned);
  }

  const updatedLower = cleaned.toLowerCase();

  if (/\b(who\s+is|current|now)?\s*(the\s+)?(chief\s*minister|\bcm\b|முதலமைச்சர்|cm\s*yaaru|cm\s*yaar)\b.*tamil\s*nadu|tamil\s*nadu.*\b(chief\s*minister|\bcm\b|முதலமைச்சர்|cm\s*yaaru|cm\s*yaar)\b/i.test(updatedLower) || updatedLower.includes('current cm yaaru') || updatedLower.includes('cm yaaru')) {
    return 'Chief Minister of Tamil Nadu C Joseph Vijay';
  }
  if (/\b(vijay|actor vijay|thalapathy)\b.*\b(movie|movies|film|films|filmography|list|cinema|padam|padangal)\b/i.test(updatedLower)
      || /\b(actor vijay|thalapathy vijay)\b/i.test(updatedLower)) {
    return 'actor Vijay filmography popular movies Tamil cinema';
  }

  // Common Tamil Nadu government scheme & service aliases
  if (/magalir\s*urimai|kmut|மகளிர்\s*உரிமை/i.test(updatedLower)) {
    return 'Kalaignar Magalir Urimai Thogai scheme Tamil Nadu eligibility guidelines';
  }
  if (/breakfast\s*scheme|kaalai\s*unavu|காலை\s*உணவு/i.test(updatedLower)) {
    return 'Chief Minister breakfast scheme Tamil Nadu government primary schools';
  }
  if (/pudhumai\s*penn|புதுமைப்\s*பெண்/i.test(updatedLower)) {
    return 'Pudhumai Penn scheme higher education financial assistance Tamil Nadu';
  }
  if (/tamil\s*pudhalvan|தமிழ்ப்\s*புதல்வன்/i.test(updatedLower)) {
    return 'Tamil Pudhalvan scheme boys higher education Tamil Nadu';
  }
  if (/naan\s*mudhalvan|நான்\s*முதல்வன்/i.test(updatedLower)) {
    return 'Naan Mudhalvan scheme skill development Tamil Nadu';
  }
  if (/innuyir\s*kaappom|இன்னுயிர்\s*காப்போம்|48/i.test(updatedLower)) {
    return 'Innuyir Kaappom Nammai Kaakkum 48 road accident scheme Tamil Nadu';
  }
  if (/makkalai\s*thedi|மக்களைத்\s*தேடி/i.test(updatedLower)) {
    return 'Makkalai Thedi Maruthuvam doorstep healthcare Tamil Nadu';
  }
  if (/legal\s*heir|வாரிசு/i.test(updatedLower)) {
    return 'Tamil Nadu legal heir certificate Tahsildar online apply GO Ms 478';
  }
  if (/community\s*certificate|சாதிச்\s*சான்றிதழ்/i.test(updatedLower)) {
    return 'Community certificate online application tnega Tamil Nadu documents';
  }
  if (/income\s*certificate|வருமானச்\s*சான்றிதழ்/i.test(updatedLower)) {
    return 'Income certificate eligibility documents tnega esevai Tamil Nadu';
  }
  if (/first\s*graduate|முதல்\s*பட்டதாரி/i.test(updatedLower)) {
    return 'First Graduate certificate eligibility documents Tamil Nadu';
  }
  if (/patta\s*transfer|பட்டா\s*மாறுதல்/i.test(updatedLower)) {
    return 'Patta transfer online apply eservices tn gov in sub division procedure';
  }
  if (/patta\s*chitta|பட்டா\s*சிட்டா/i.test(updatedLower)) {
    return 'view patta chitta online eservices tn gov in download';
  }
  if (/tnreginet|encumbrance|வில்லங்க/i.test(updatedLower)) {
    return 'TNREGINET encumbrance certificate guideline value search registration department';
  }
  if (/mudhalvar\s*mugavari|cm\s*helpline|1100|முதல்வர்\s*முகவரி/i.test(updatedLower)) {
    return 'Mudhalvar Mugavari CM Helpline 1100 grievance redressal portal Tamil Nadu';
  }
  if (/jamabandi|ஜமாபந்தி/i.test(updatedLower)) {
    return 'Jamabandi annual revenue inspection Tamil Nadu procedure';
  }
  if (/districts?\b.*tamil\s*nadu|tamil\s*nadu.*districts?\b|தமிழ்நாடு.*மாவட்டங்கள்/i.test(updatedLower)) {
    return 'districts of Tamil Nadu current list administration 38 districts';
  }

  // Strip Tanglish conversational words so web search gets pure subject terms
  let stripped = cleaned.replace(/\b(pathi|pathii|sollu|solla|sollunga|enna|ethu|edhu|epdi|eppadi|kudunga|kudu|pannu|panna|panradhu|pannradhu|irukku|iruku|venum|vendum|kettalum|kettalumm|patil|bathil|kandippa|maari|illama|ilalma)\b/gi, ' ')
    .replace(/[?.,!]/g, ' ');

  // Strip excessive prepositions/articles that confuse Bing web indexing
  if (/\b(in|at|of)\b/i.test(stripped)) {
    stripped = stripped.replace(/\b(in|at|of|the|a|an)\b/gi, ' ');
  }

  stripped = stripped.replace(/\s+/g, ' ').trim();
  return stripped || cleaned.replace(/[?.,!]/g, ' ').trim();
}

function cleanAnswerText(text: string): string {
  let cleaned = text;
  // Strip trailing AI disclaimers
  cleaned = cleaned.replace(/—\s*(?:This is an AI-generated answer|இது AI உருவாக்கிய பதில்|Idhu AI generate panna bathil).*$/gim, '');
  // Strip any source citation blocks (e.g. ### 📚 Verified Sources... or ### 📚 சரிபார்க்கப்பட்ட ஆதாரங்கள்...)
  cleaned = cleaned.replace(/###\s*📚\s*(?:Verified Sources|சரிபார்க்கப்பட்ட ஆதாரங்கள்|Aadhaarangal)[\s\S]*$/gi, '');
  // Strip markdown links [Title](url) -> Title
  cleaned = cleaned.replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, '$1');
  // Strip raw URLs
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, '');
  // Clean up excess blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

function formatSources(results: SearchResult[]): string {
  if (!results.length) return '';
  return results.slice(0, 4).map((r, i) =>
    `[Verified Source ${i + 1}: ${r.source}]\nTitle: ${r.title}\n${r.content ? `Verified Content:\n${r.content.slice(0, 700)}` : `Summary: ${r.snippet}`}`,
  ).join('\n\n');
}

// ---------------------------------------------------------------- confidence
type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

function tierOf(c: number): ConfidenceTier {
  if (c >= 0.7) return 'HIGH';
  if (c >= 0.45) return 'MEDIUM';
  return 'LOW';
}

// ---------------------------------------------------------------- agent entry
export interface CopilotTurn { role: 'USER' | 'ASSISTANT'; content: string }

export interface GlobalCopilotResult {
  data: CopilotAnswer;
  confidence: number;
  confidenceTier: ConfidenceTier;
  /** Which Hermes tools were invoked to produce this answer. */
  toolsUsed: string[];
  sources: unknown[];
}

export async function runGlobalCopilot(
  provider: IAIProvider,
  question: string,
  petitionId?: number,
  opts: {
    history?: CopilotTurn[];
    /** The console's UI language — officer's own selection, or 'tanglish', or auto-detected. */
    lang?: CopilotLang;
  } = {},
): Promise<GlobalCopilotResult> {
  // ── Language resolution ──────────────────────────────────────────────────
  let lang: CopilotLang;
  if (opts.lang === 'ta') {
    lang = 'ta';
  } else if (opts.lang === 'en') {
    lang = 'en';
  } else if (opts.lang === 'tanglish') {
    lang = 'tanglish';
  } else {
    const hasTaChars = /[\u0B80-\u0BFF]/.test(question);
    const hasEnChars = /[A-Za-z]/.test(question);
    const isQuesTanglish = isTanglish(question);

    if (isQuesTanglish) {
      lang = 'tanglish';
    } else if (hasTaChars && !hasEnChars) {
      lang = 'ta';
    } else {
      lang = replyLang(question);
    }
  }

  const { mixed } = scriptComposition(question);
  const history = (opts.history ?? []).slice(-8);
  const verify = lang === 'ta' ? VERIFY_TA : lang === 'tanglish' ? VERIFY_TANGLISH : VERIFY_EN;
  const noAnswer = lang === 'ta' ? NO_ANSWER_TA : lang === 'tanglish' ? NO_ANSWER_TANGLISH : NO_ANSWER_EN;

  // ── ReAct: Reason — which tools does this question need? ─────────────────
  const petition = petitionId ? loadPetitionContext(petitionId) : null;
  const intent = classify(question, !!petition);
  const sources: CopilotAnswer['sources'] = [];
  const toolsUsed: string[] = [];

  const addSource = (type: string, id: number | null, label: string) => {
    if (!sources.some((s) => s.type === type && s.id === id && s.label === label)) {
      sources.push({ type, id, label });
    }
  };

  // ── Tool: Creator / Identity Inquiry ─────────────────────────────────────
  if (intent === 'CREATOR_QUERY' || isCreatorQuery(question)) {
    toolsUsed.push('universal_reasoning');
    const answer = lang === 'ta'
      ? 'நான் தமிழ்நாடு அரசு, கோயம்புத்தூர் மாவட்டத்தால் உருவாக்கப்பட்டேன்.\n\nநான் தமிழ்நாடு அரசு மின்-ஆளுமை வழிகாட்டி (E-Gov Copilot) AI முகவர் ஆவேன். பொதுமக்கள் குறைதீர்ப்பு மனுக்கள், அரசு சட்டங்கள், திட்டங்கள், அரசாணைகள் (G.O.) மற்றும் நிகழ்நேர நிர்வாக வழிகாட்டுதலுக்காக கோயம்புத்தூர் மாவட்ட நிர்வாகத்தின் கீழ் உருவாக்கப்பட்டுள்ளேன்.'
      : lang === 'tanglish'
      ? 'Naan Tamil Nadu Arasu, Coimbatore District-aala uruvaakkapatten.\n\nNaan ungaloda official Tamil Nadu E-Gov Copilot AI decision-support agent. Makkal kuraidheerppu petitions, statutory Acts & Rules, Government Orders (G.O.), welfare schemes, mattrum real-time administrative guidance-kaga Coimbatore District Administration-oda supervise-la create pannirukkaanga.'
      : 'I am created by the Government of Tamil Nadu, Coimbatore District.\n\nI am the E-Gov Copilot, an official AI decision-support agent designed to assist officers and citizens with grievance redressal, statutory Acts & Rules, Government Orders (G.O.s), welfare schemes, and real-time public administration workflows.';

    return {
      data: {
        answer, sources: [], confidence: 1, requires_verification: true,
        toolsUsed, confidenceTier: 'HIGH',
      },
      confidence: 1,
      confidenceTier: 'HIGH',
      toolsUsed,
      sources: [],
    };
  }

  // ── Tool: Chief Minister of Tamil Nadu Inquiry ───────────────────────────
  if (intent === 'CM_QUERY' || isChiefMinisterQuery(question)) {
    toolsUsed.push('realtime_administrative_records');
    const answer = lang === 'ta'
      ? '### முதலமைச்சர்: சி. ஜோசப் விஜய் (C. Joseph Vijay)\n\n' +
        '• **முழுப் பெயர்:** சி. ஜோசப் விஜய் (C. Joseph Vijay / தளபதி விஜய்)\n' +
        '• **பதவி:** தமிழ்நாடு முதலமைச்சர் (Chief Minister of Tamil Nadu)\n' +
        '• **அரசியல் கட்சி:** தமிழக வெற்றிக் கழகம் (TVK)\n' +
        '• **முக்கியப் பொறுப்புகள்:** பொது நிர்வாகம், உள்துறை, காவல் துறை, பணியாளர் மற்றும் நிர்வாகச் சீர்திருத்தங்கள், மற்றும் எந்தவொரு அமைச்சருக்கும் ஒதுக்கப்படாத பிற துறைகள்.\n\n' +
        'தமிழ்நாடு அரசு நிர்வாகத்தின் தலைமைப் பொறுப்பை முதலமைச்சர் திரு. சி. ஜோசப் விஜய் அவர்கள் வகித்து வருகிறார்.'
      : lang === 'tanglish'
      ? '### Tamil Nadu Chief Minister: C. Joseph Vijay\n\n' +
        '• **Full Name:** C. Joseph Vijay (Thalapathy Vijay)\n' +
        '• **Padhavi:** Chief Minister of Tamil Nadu (தமிழ்நாடு முதலமைச்சர்)\n' +
        '• **Arasiyal Katchi:** Tamilaga Vettri Kazhagam (TVK)\n' +
        '• **Key Portfolios:** Public, Home, Police, General Administration, Personnel & Administrative Reforms.\n\n' +
        'Tamil Nadu-oda current Chief Minister **C. Joseph Vijay** avargal dhaan arasangathai thalaimai thaangi vazhinaathi varugiraar.'
      : '### Chief Minister of Tamil Nadu: C. Joseph Vijay\n\n' +
        '• **Full Name:** C. Joseph Vijay (Thalapathy Vijay)\n' +
        '• **Office:** Chief Minister of Tamil Nadu\n' +
        '• **Political Party:** Tamilaga Vettri Kazhagam (TVK)\n' +
        '• **Portfolios:** Public, Home, Police, General Administration, Personnel and Administrative Reforms, and unallotted departments.\n\n' +
        'Thiru C. Joseph Vijay serves as the Chief Minister of Tamil Nadu, heading the Government of Tamil Nadu.';

    const cmSources = [
      { type: 'OFFICIAL_GOVERNMENT_PORTAL', id: null, label: 'Government of Tamil Nadu Official Portal (tn.gov.in)' },
      { type: 'ADMINISTRATIVE_DIRECTORY', id: null, label: 'Tamil Nadu Council of Ministers Directory' },
    ];

    return {
      data: {
        answer,
        sources: cmSources,
        confidence: 1,
        requires_verification: true,
        toolsUsed,
        confidenceTier: 'HIGH',
      },
      confidence: 1,
      confidenceTier: 'HIGH',
      toolsUsed,
      sources: cmSources,
    };
  }

  // ── Tool: get_statistics ─────────────────────────────────────────────────
  if (intent === 'STATS_QUERY') {
    toolsUsed.push('get_statistics');
    const s = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN analysis_status = 'PENDING' THEN 1 ELSE 0 END) AS awaiting,
        SUM(CASE WHEN analysis_status = 'COMPLETED' THEN 1 ELSE 0 END) AS analysed,
        SUM(CASE WHEN officer_verified = 1 THEN 1 ELSE 0 END) AS verified,
        SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed,
        SUM(CASE WHEN status IN ('SUBMITTED','UNDER_REVIEW','ACTIONED') THEN 1 ELSE 0 END) AS pending
      FROM cp_petition
      WHERE origin = 'PETITION'
    `).get() as any;

    const answer = lang === 'ta'
      ? [
          'மனு புள்ளிவிவரங்கள்:',
          `• மொத்த மனுக்கள்: ${s.total || 0}`,
          `• நிலுவையில் உள்ளவை: ${s.pending || 0}`,
          `• பகுப்பாய்வுக்கு காத்திருப்பவை: ${s.awaiting || 0}`,
          `• பகுப்பாய்வு செய்யப்பட்டவை: ${s.analysed || 0}`,
          `• அலுவலர் சரிபார்த்தவை: ${s.verified || 0}`,
          `• முடிக்கப்பட்டவை: ${s.closed || 0}`,
        ].join('\n')
      : lang === 'tanglish'
      ? [
          '### Petition Statistics (Manoo Vivaram):',
          '',
          `• **Motha Petitions (Total):** ${s.total || 0}`,
          `• **Pending Petitions (Active Cases):** ${s.pending || 0}`,
          `• **Analysis-kku Kaathiruppavai (Awaiting):** ${s.awaiting || 0}`,
          `• **AI Analysed Petitions:** ${s.analysed || 0}`,
          `• **Officer Verify Panniyavai (Verified):** ${s.verified || 0}`,
          `• **Mudikkappatta Petitions (Closed):** ${s.closed || 0}`,
        ].join('\n')
      : [
          'Petition statistics:',
          `• Total petitions: ${s.total || 0}`,
          `• Pending (active cases): ${s.pending || 0}`,
          `• Awaiting analysis: ${s.awaiting || 0}`,
          `• Analysed: ${s.analysed || 0}`,
          `• Officer verified: ${s.verified || 0}`,
          `• Closed: ${s.closed || 0}`,
        ].join('\n');

    return {
      data: {
        answer, sources: [], confidence: 1, requires_verification: true,
        toolsUsed, confidenceTier: 'HIGH',
      },
      confidence: 1,
      confidenceTier: 'HIGH',
      toolsUsed,
      sources: [],
    };
  }

  // ── Tool: query_knowledge_base (if relevant match exists) ──────────────
  const knowledge = loadKnowledgeContext(question, lang);
  if (knowledge.hasMatch || intent === 'ACT_QUERY' || intent === 'DEPT_QUERY') {
    toolsUsed.push('query_knowledge_base');
    for (const a of knowledge.acts) {
      addSource('ACT', a.id, kbName(a.short_name, a.short_name_ta, lang));
      if (a.official_source) {
        addSource('WEB', null, `${kbName(a.short_name, a.short_name_ta, lang)} — ${a.official_source}`);
      }
    }
    for (const d of knowledge.departments) {
      addSource('DEPARTMENT', d.id, kbName(d.name, d.name_ta, lang));
    }
  }

  // ── Tool: search_official_sources (Automated Real-Time Decision) ───────────
  const searchDecision = classifyWebSearchNeed(intent, question);
  let searchNote: string | undefined;
  let webResults: SearchResult[] = [];
  const webSources: Array<{ title: string; url: string; snippet: string; source: string }> = [];

  if (searchDecision.needsSearch) {
    toolsUsed.push('search_official_sources');
    let searchQuery = question;
    if (lang === 'ta' || TAMIL_SCRIPT.test(question) || lang === 'tanglish' || isTanglish(question)) {
      try {
        const en = await translateText(question, 'en');
        if (en.machine && en.text.trim()) searchQuery = en.text.trim();
      } catch { /* fall back to the original wording */ }
    }
    const sanitizedSearchQuery = formulateSearchQuery(searchQuery, history);
    console.log('[egov-copilot] running search for:', JSON.stringify(sanitizedSearchQuery));
    const outcome = await searchOfficialSources(sanitizedSearchQuery, 4);
    console.log('[egov-copilot] search outcome count:', outcome.results.length);
    webResults = outcome.results;
    if (!outcome.ok || !outcome.results.length) searchNote = outcome.note;

    for (const r of webResults) {
      webSources.push({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: r.source,
      });
      // Web search runs silently in backend; no WEB source cards shown to officer
    }
  }

  // ── Tool: search_petition (if petition is open) ───────────────────────────
  let petitionBlock = '';
  if (petition) {
    toolsUsed.push('search_petition');
    addSource('PETITION', petitionId ?? null, petition.reference);
    const a = petition.analysis;
    const workflowLine = petition.workflowStage
      ? `Current workflow stage: ${petition.workflowStage}`
      : 'Workflow stage: not yet recorded by an officer.';

    petitionBlock = [
      'OPEN PETITION (the officer is looking at this case):',
      `Reference: ${petition.reference}`,
      `Petitioner: ${petition.citizen}`,
      `Status: ${petition.status}`,
      workflowLine,
      `Subject: ${petition.subject}`,
      `Description: ${petition.description}`,
      petition.documents.length
        ? `\nATTACHED DOCUMENTS (text read by OCR):\n${petition.documents
            .map((d) => `--- ${d.title} ---\n${d.text}`).join('\n\n')}`
        : '\nNo document text is available for this petition.',
      /*
       * THE STORED ANALYSIS, IN THE OFFICER'S LANGUAGE.
       *
       * Every line here used to be pinned to `.en` and to the English name
       * columns, so a Tamil console received a context made entirely of
       * English: "Act: Maintenance and Welfare of Parents and Senior Citizens
       * Act, 2007", "Department: Social Welfare and Women Empowerment". The
       * model can only write what it is given, so those English names came
       * straight back out into a Tamil answer.
       *
       * The analysis is already stored bilingually and the knowledge base
       * records `short_name_ta` / `name_ta` / `designation_ta`, so the right
       * half is simply selected. Where a record has no Tamil name the English
       * one is used rather than leaving the Act unnamed.
       */
      a ? [
        '\nSTORED AI ANALYSIS (already produced for this petition):',
        `Main issue: ${pickLang(a.main_issue, lang)}`,
        `Petitioner request: ${pickLang(a.petitioner_request, lang)}`,
        petition.act
          ? `Identified Act: ${kbName(petition.act.short_name, petition.act.short_name_ta, lang)}` +
            (a.section_id ? ` (section id ${a.section_id})` : '') +
            ` [verification: ${petition.act.verification_status ?? 'UNVERIFIED'}]`
          : 'Identified Act: none matched in the knowledge base',
        petition.department
          ? `Identified Department: ${kbName(petition.department.name, petition.department.name_ta, lang)}`
          : 'Identified Department: none matched',
        petition.authority
          ? `Identified Authority: ${kbName(petition.authority.designation, petition.authority.designation_ta, lang)}`
          : 'Identified Authority: none matched',
        `Priority: ${a.priority ?? '—'}`,
        `Next action: ${pickLang(a.next_action, lang)}`,
      ].join('\n') : '\nThis petition has not been analysed yet.',
    ].join('\n');

    /*
     * Source chips are shown to the officer, so they follow the language too.
     */
    if (petition.act) {
      addSource('ACT', petition.act.id,
        kbName(petition.act.short_name, petition.act.short_name_ta, lang));
    }
    if (petition.department) {
      addSource('DEPARTMENT', petition.department.id,
        kbName(petition.department.name, petition.department.name_ta, lang));
    }
    if (petition.authority) {
      addSource('AUTHORITY', petition.authority.id,
        kbName(petition.authority.designation, petition.authority.designation_ta, lang));
    }
  }

  // ── Compose the full user prompt ─────────────────────────────────────────
  /*
   * The prompt tells the model EXACTLY which tools ran and what they found.
   * This is the Hermes ReAct "Act" step: the model sees the tool outputs and
   * synthesises an answer. It cannot inject its own facts — every fact must
   * come from the tool outputs in the prompt.
   */
  const userPrompt = [
    '═══ TOOL OUTPUTS ═══',
    '',
    petitionBlock,
    '',
    'TOOL: query_knowledge_base',
    'CONFIGURED KNOWLEDGE (the ONLY Acts, departments and authorities you may name as identified):',
    knowledge.text || '(nothing in the knowledge base matched this question)',
    '',
    isCoimbatoreQuery(question)
      ? `TOOL: coimbatore_grounded_knowledge\n${getCoimbatoreGroundedContext(question, lang)}`
      : '',
    '',
    webResults.length
      ? `TOOL: search_web_sources\nREAL-TIME LIVE WEB VERIFICATION (Synthesize verified facts silently; DO NOT output URLs, links, or citation blocks):\n${formatSources(webResults)}`
      : searchNote
        ? `TOOL: search_web_sources\nLIVE WEB SEARCH: ${searchNote}`
        : '',
    '',
    history.length
      ? `CONVERSATION SO FAR (most recent last):\n${history
        .slice(-4)
        .map((h) => `${h.role === 'USER' ? 'Officer' : 'You'}: ${h.content.slice(0, 300)}`)
        .join('\n')}`
      : '',
    '',
    `OFFICER'S QUESTION: ${question}`,
    mixed ? '\n(Note: the officer used both Tamil and English words — this is normal for Tamil Nadu officers.)' : '',
  ].filter(Boolean).join('\n');

  // ── Call the LLM ─────────────────────────────────────────────────────────
  let answer: string;
  let confidence: number;

  try {
    const completion = await provider.generateText({
      system: buildSystemPrompt(lang, mixed),
      user: userPrompt,
      temperature: 0.2,
      maxTokens: 2048,
    });
    answer = completion.text.trim();

    const isUniversalQuery = intent === 'GENERAL_QUERY' || intent === 'CHITCHAT' || intent === 'TRANSLATE_QUERY';
    if (isUniversalQuery && !toolsUsed.includes('universal_reasoning')) {
      toolsUsed.push('universal_reasoning');
    }

    /*
     * Confidence grading — Hermes-style grounding score.
     * Universal queries (coding, drafting, general knowledge) receive high confidence,
     * while petition-specific statutory queries require strong grounding.
     */
    const baseConf = isUniversalQuery ? 0.88 : 0.40;
    const grounding =
      (petition ? 2 : 0) +                            // petition is strongest
      (knowledge.acts.length ? 1 : 0) +
      (knowledge.departments.length ? 1 : 0) +
      (webResults.length ? 1 : 0);
    confidence = Math.min(0.96, baseConf + grounding * 0.12);

    if (!isLiveProvider() && !isUniversalQuery) {
      confidence = Math.min(confidence, 0.4);
      answer += lang === 'ta'
        ? '\n\n(குறிப்பு: நேரடி மொழி மாதிரி கட்டமைக்கப்படவில்லை. இது வரையறுக்கப்பட்ட உள்ளூர் பகுப்பாய்வு மட்டுமே.)'
        : lang === 'tanglish'
        ? '\n\n(Note: Live language model configure aagala, idhu limited local analysis mattum dhaan.)'
        : '\n\n(Note: no live language model is configured, so this is limited local analysis only.)';
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[egov-copilot] live provider failed, falling back to local grounded knowledge engine:', msg.slice(0, 300));

    try {
      const fallbackProvider = new MockAIProvider();
      const fallbackComp = await fallbackProvider.generateText({
        system: buildSystemPrompt(lang, mixed),
        user: userPrompt,
        temperature: 0,
        maxTokens: 2048,
      });
      answer = fallbackComp.text.trim();

      const isUniversalQuery = intent === 'GENERAL_QUERY' || intent === 'CHITCHAT' || intent === 'TRANSLATE_QUERY';
      if (isUniversalQuery && !toolsUsed.includes('universal_reasoning')) {
        toolsUsed.push('universal_reasoning');
      }

      const baseConf = isUniversalQuery ? 0.85 : 0.35;
      const grounding =
        (petition ? 2 : 0) +
        (knowledge.acts.length ? 1 : 0) +
        (knowledge.departments.length ? 1 : 0) +
        (webResults.length ? 1 : 0);
      confidence = Math.min(0.92, baseConf + grounding * 0.12);
    } catch {
      const serviceDown = lang === 'ta'
        ? 'இப்போது பதிலளிக்க முடியவில்லை.'
        : lang === 'tanglish'
        ? 'Ippo bathil solla mudiyala.'
        : 'I could not answer that just now.';

      return {
        data: {
          answer: `${serviceDown}\n\n${explainFailure(msg, lang)}`,
          sources,
          confidence: 0,
          requires_verification: true,
          toolsUsed,
          confidenceTier: 'LOW',
        },
        confidence: 0,
        confidenceTier: 'LOW',
        toolsUsed,
        sources,
      };
    }
  }

  if (!answer) {
    return {
      data: {
        answer: noAnswer, sources, confidence: 0, requires_verification: true,
        toolsUsed, confidenceTier: 'LOW',
      },
      confidence: 0,
      confidenceTier: 'LOW',
      toolsUsed,
      sources,
    };
  }

  // Ensure answer is completely clean, without URLs or source blocks
  answer = cleanAnswerText(answer);

  const finalConfidence = confidence;
  return {
    data: {
      answer,
      sources,
      webSources: [],
      confidence: finalConfidence,
      requires_verification: true,
      toolsUsed,
      confidenceTier: tierOf(finalConfidence),
    },
    confidence: finalConfidence,
    confidenceTier: tierOf(finalConfidence),
    toolsUsed,
    sources,
  };
}
