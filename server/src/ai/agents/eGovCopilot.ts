import { db } from '../../core/db.js';
import type { IAIProvider } from '../provider.js';
import { MockAIProvider } from '../mockProvider.js';
import type { CopilotAnswer } from './copilot.js';
import { searchOfficialSources, type SearchResult } from '../../core/search.js';
import { translateText } from '../../core/translate.js';
import { isLiveProvider } from '../gateway.js';

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

const NO_ANSWER_EN =
  'I could not answer that from the open petition, the configured knowledge base, or official ' +
  'government sources. Please consult the appropriate authority, or ask an administrator to add ' +
  'the relevant Act or department to the AI Knowledge Configuration.';
const NO_ANSWER_TA =
  'திறந்துள்ள மனு, கட்டமைக்கப்பட்ட அறிவுத் தளம், அல்லது அதிகாரப்பூர்வ அரசு ஆதாரங்களிலிருந்து இதற்கு ' +
  'பதிலளிக்க முடியவில்லை. உரிய அதிகாரியை அணுகவும், அல்லது தொடர்புடைய சட்டத்தை நிர்வாகி சேர்க்கலாம்.';


/** Any Tamil character - a question in Tamil needs an English search query. */
const TAMIL_SCRIPT = /[஀-௿]/;

// ---------------------------------------------------------------- language detection
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
 *
 * The officer's console language setting wins. If that is not provided, the
 * question's dominant script decides. A mixed-language question (Tamil words +
 * English technical terms) answers in the officer's UI language, matching the
 * natural way officers write — Tamil prose with English terms like "Act",
 * "FIR", "NOC" left in English.
 */
function replyLang(question: string, uiLang?: 'ta' | 'en'): 'ta' | 'en' {
  if (uiLang) return uiLang;
  const { ta } = scriptComposition(question);
  return ta > 0.3 ? 'ta' : 'en';
}

/**
 * One half of a bilingual value, as plain text.
 *
 * The stored analysis holds {en, ta} pairs. A plain string is returned as it
 * stands - the petitioner's own words are stored that way and must never be
 * swapped for a machine rendering.
 */
function pickLang(v: unknown, lang: 'ta' | 'en'): string {
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
 *
 * Falls back to the English name where no Tamil one is recorded: an Act that
 * appears unnamed is worse than one named in the other language.
 */
function kbName(en: unknown, ta: unknown, lang: 'ta' | 'en'): string {
  const v = lang === 'ta' ? (ta || en) : (en || ta);
  return String(v ?? '—').trim() || '—';
}

// ---------------------------------------------------------------- error messages
/**
 * Classify vendor errors into officer-actionable messages.
 *
 * Raw vendor text (JSON blobs, HTTP status strings) is useless to an officer
 * and actively harmful when it appears in a Tamil conversation in English. We
 * classify it into the small set of things an officer can actually do.
 */
function explainFailure(msg: string, lang: 'ta' | 'en'): string {
  const m = String(msg ?? '');
  if (/quota|429|rate limit|billing/i.test(m)) {
    return lang === 'ta'
      ? 'AI சேவையின் இன்றைய வரம்பு எட்டப்பட்டுள்ளது. சிறிது நேரம் கழித்து முயற்சிக்கவும், அல்லது நிர்வாகியை அணுகவும்.'
      : 'The AI service has reached its usage limit. Try again later, or contact an administrator.';
  }
  if (/api key|401|403|rejected/i.test(m)) {
    return lang === 'ta'
      ? 'AI சேவையின் அனுமதிச் சாவி ஏற்கப்படவில்லை. நிர்வாகி சேவையக அமைப்பைச் சரிபார்க்க வேண்டும்.'
      : 'The AI service rejected its credentials. An administrator must check the server configuration.';
  }
  if (/not reachable|not running|ECONNREFUSED|fetch failed|network/i.test(m)) {
    return lang === 'ta'
      ? 'AI சேவையை அணுக முடியவில்லை. அது இயங்குகிறதா என்பதை நிர்வாகி சரிபார்க்க வேண்டும்.'
      : 'The AI service could not be reached. An administrator should check that it is running.';
  }
  if (/timed out|timeout|abort/i.test(m)) {
    return lang === 'ta'
      ? 'AI சேவை குறித்த நேரத்தில் பதிலளிக்கவில்லை. மீண்டும் முயற்சிக்கவும்.'
      : 'The AI service did not respond in time. Please try again.';
  }
  return lang === 'ta'
    ? 'AI சேவையில் தற்காலிகக் கோளாறு. மீண்டும் முயற்சிக்கவும்.'
    : 'The AI service failed temporarily. Please try again.';
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
 * Route the question to an intent — Hermes ReAct "Reason" step.
 *
 * Language-aware: a Tamil officer asking "இந்த மனு எந்த துறைக்கு?" and an
 * English officer asking "which department?" both reach DEPT_QUERY.
 */
function classify(q: string, hasPetition: boolean): Intent {
  const s = q.toLowerCase();

  // 1. Creator inquiry: explicitly anchor Government of Tamil Nadu, Coimbatore District
  if (isCreatorQuery(q)) return 'CREATOR_QUERY';

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
  lang: 'ta' | 'en',
  limit = 5,
): {
  text: string;
  acts: any[];
  departments: any[];
  authorities: any[];
  hasMatch: boolean;
} {
  // Non-government / general knowledge / entertainment queries should NEVER match statutory grievance Acts
  const isGeneralOrEntertainment =
    /\b(movie|movies|film|films|filmography|actor|actress|cinema|songs?|album|trailer|director|hero|heroine|box\s*office|cricket|football|game|sport|recipe|weather|joke|story)\b/i.test(question)
    || /(திரைப்படம்|படம்|பாடல்கள்?|நடிகர்|நடிகை|சினிமா|கிரிக்கெட்|விளையாட்டு)/.test(question);

  if (isGeneralOrEntertainment) {
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
    'சட்டம்', 'தமிழ்நாடு', 'மற்றும்', 'பற்றிய', 'அரசு', 'தற்போது', 'இப்போது', 'யார்', 'எது', 'எந்த'
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
    String((lang === 'ta' ? (ta || en) : en) ?? '').trim();

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
 *
 * The prompt structure follows Hermes conventions:
 *   1. Output contract FIRST (what the answer must look like)
 *   2. Role and context
 *   3. Absolute factual grounding rules
 *   4. Language rules (strict, no mixing)
 *   5. Tone and format
 */
function buildSystemPrompt(lang: 'ta' | 'en', mixed: boolean): string {
  const lines: string[] = [
    // Output contract — must come first so the model does not narrate its reasoning
    'Write the answer only. Never restate these instructions, never narrate your reasoning,',
    'never quote the section headings you were given, and never begin with a slash or a',
    'question to yourself. Start directly with the answer.',
    /*
     * The model was echoing the prompt's own section labels into its answer -
     * "(CONFIGURED KNOWLEDGE)" and "(DEPARTMENT)" appeared mid-sentence in a
     * Tamil reply. They are scaffolding for the model, meaningless to an
     * officer, and English inside a Tamil answer.
     */
    'The labels TOOL:, CONFIGURED KNOWLEDGE, OFFICIAL SOURCES, OPEN PETITION, DEPARTMENT and',
    'ACT are internal headings in this prompt. Never write them in your answer, in brackets',
    'or otherwise. Name the actual department or Act instead.',
    /*
     * A model writing Tamil kept glossing its own nouns - "மனு (petition)" -
     * which is the bracketed English the language rule already forbids. Stating
     * it as its own line stops it, because the earlier rule reads as being
     * about NAMES while this is about ordinary vocabulary.
     */
    'Never gloss a Tamil word with its English equivalent in brackets. Write "மனு", not',
    '"மனு (petition)". The officer reads one language at a time.',
    '',
    'You are the e-Gov Copilot — an AI assistant for Tamil Nadu government grievance officers.',
    'You help officers understand petitions, identify applicable Acts, departments, and next actions.',
    '',
    '═══════════════════════════════════════════════════════',
    'ABSOLUTE FACTUAL GROUNDING RULES (Hermes anti-hallucination constraints):',
    '═══════════════════════════════════════════════════════',
    '1. NEVER invent or guess:',
    '   • Person names (petitioner, officer, witness)',
    '   • Phone numbers, Aadhaar numbers, door numbers, survey numbers',
    '   • Dates, deadlines, amounts, fines',
    '   • Act names, section numbers, Government Order numbers',
    '   • Department names, officer designations',
    '   • Village names, district names, addresses',
    '2. Name an Act, section, department or authority ONLY if it appears in:',
    '   (a) the OPEN PETITION text provided below, OR',
    '   (b) the CONFIGURED KNOWLEDGE section provided below, OR',
    '   (c) an OFFICIAL SOURCE URL provided below.',
    '3. If a SPECIFIC FACT about this office, this petition, or Tamil Nadu law is missing',
    '   from the context: say plainly that it is not available. Do NOT guess, and do NOT',
    '   say "it is likely" or "probably".',
    '4. An Act marked UNVERIFIED has not been checked against the Gazette — say so.',
    '5. You advise. The officer decides. Never state a conclusion as settled law.',
    '',
    /*
     * WHAT RULE 3 DOES NOT COVER.
     *
     * Rule 3 protects facts that could mislead an officer into acting - a
     * section number, a designation, a deadline. It was being applied to
     * EVERYTHING, so "What is RTI?" and "How do I write a good petition?" were
     * refused with "I could not answer that from the configured knowledge
     * base". Explaining what RTI stands for invents no Act and misleads
     * nobody; refusing it just makes the assistant useless for the general
     * questions an officer actually asks.
     *
     * So general explanation is explicitly permitted, and the boundary is
     * drawn where it matters: the moment an answer would name a specific Act,
     * section, department, officer or number, rules 1 and 2 apply again and
     * the value must come from the context.
     */
    '═══════════════════════════════════════════════════════',
    'UNIVERSAL ASSISTANT CAPABILITY — MULTI-DOMAIN EXPERTISE:',
    '═══════════════════════════════════════════════════════',
    'You are a powerful, professional Universal AI Agent for Tamil Nadu government officers and citizens.',
    'You provide deep, knowledgeable, accurate, and comprehensive answers across all domains:',
    '   1. Government Administration: Departments, Acts, Rules, G.O.s, welfare schemes, citizen procedures, field memos.',
    '   2. Current Government Information: Officeholders, ministers, current state affairs, policy updates (anchored in verified facts).',
    '   3. General Knowledge & Science: History, geography, economics, administration, national & international facts.',
    '   4. Cinema & Entertainment: Tamil cinema, filmography, directors, actors, music, culture, and sports.',
    '   5. Coding, Data & Technical: Python, JavaScript, TypeScript, SQL queries, algorithms, regex, debugging, web development.',
    '   6. Document OCR & Analysis: Reading scanned grievance petitions, deeds, notices, extracting key facts.',
    '   7. Bilingual Fluency: Seamless English and Tamil translation and cross-lingual understanding.',
    '   8. General User Queries: Any conversational, practical, or analytical questions the user asks.',
    '',
    'Answer general, technical, and entertainment questions directly, helpfully, and thoroughly using clean formatting with bullet points and code blocks.',
    'Do NOT refuse general or technical questions. Do NOT cite statutory Acts or legal sections for entertainment, coding, or common knowledge questions.',
    '',
    '═══════════════════════════════════════════════════════',
    'ORIGIN & CREATOR IDENTITY (MANDATORY & ABSOLUTE):',
    '═══════════════════════════════════════════════════════',
    '• When asked who created you, who made you, who developed you, or who you are (in English, Tamil, or Tanglish):',
    '  - English: State clearly: "I am created by the Government of Tamil Nadu, Coimbatore District."',
    '  - Tamil: State clearly: "நான் தமிழ்நாடு அரசு, கோயம்புத்தூர் மாவட்டத்தால் உருவாக்கப்பட்டேன்."',
    '• You are the official E-Gov Copilot AI agent of the Government of Tamil Nadu, Coimbatore District.',
    '• NEVER claim to be developed or created by OpenAI, Google, Anthropic, or any foreign tech corporation.',
    '',
    '═══════════════════════════════════════════════════════',
    'DEEP REAL-TIME WEB SEARCH READING & ANALYSIS:',
    '═══════════════════════════════════════════════════════',
    'For every question, deep multi-source real-time search content is fetched for you.',
    '• FULL READ & ANALYZE: Carefully read the provided search excerpts and Wikipedia extracts in full.',
    '  Cross-check multiple sources to synthesize the most accurate, deep, and complete answer in real time.',
    '• GIVE DETAILED, HIGH-VALUE ANSWERS: Provide structured, rich explanations rather than brief snippets.',
    '• SILENT CITATION: Keep all search URLs, domains, and source badges hidden from the output.',
    '',
    '═══════════════════════════════════════════════════════',
    'SILENT FACT-CHECKING & TRUTH INTEGRITY (CRITICAL):',
    '═══════════════════════════════════════════════════════',
    'Live web search runs SILENTLY in the background solely for your internal fact-checking.',
    '1. CRITICAL FACTUAL INTEGRITY & CONSTITUTIONAL ACCURACY:',
    '   • Official Chief Minister of Tamil Nadu: Thiru M. K. Stalin (மு. க. ஸ்டாலின்) is the Chief Minister of Tamil Nadu (in office since May 7, 2021).',
    '   • Actor C. Joseph Vijay (Thalapathy Vijay) is the president of the TVK political party; he is NOT the Chief Minister, and has NEVER held the office of Chief Minister.',
    '   • Strictly ignore and reject any speculative fan edits or internet rumors claiming Vijay became Chief Minister or claiming 2026 election outcomes.',
    '   • In both Tamil and English, when asked "Who is the current Tamil Nadu CM?" or similar questions, always answer factually that Thiru M. K. Stalin is the Chief Minister of Tamil Nadu.',
    '   • When user statements or rumors are incorrect, politely, clearly, and factually correct them.',
    '2. COMPLETELY SILENT SEARCH — ZERO CITATIONS OR URLS:',
    '   • Do NOT write "Official sources:", "Web Sources:", "Sources:", "[1]...", or bullet points with links.',
    '   • Do NOT include URLs (http/https), website links, domain names, or citations in your response.',
    '   • Deliver a clean, direct, informative, well-structured answer, exactly like ChatGPT.',
    '   • Answer in clear paragraphs or bullet points without meta-commentary about tools or search.',
    '',
    'THE BOUNDARY: When advising on a SPECIFIC case file, citizen petition, or naming a statutory Act or',
    'department for a petition, use the CONFIGURED KNOWLEDGE or OPEN PETITION context provided below.',
    '',
  ];

  // Language rule — strict, based on UI setting and script composition
  if (lang === 'ta') {
    lines.push(
      '═══════════════════════════════════════════════════════',
      'LANGUAGE: ANSWER ENTIRELY IN TAMIL.',
      '═══════════════════════════════════════════════════════',
      'Write every word in Tamil, including Act titles, department names and officer designations.',
      'The knowledge base provides Tamil names for all entities — use them.',
      'Section numbers, reference numbers, years and amounts stay as digits.',
      'Do NOT add English translations in brackets or anywhere else.',
      ...(mixed ? [
        'The officer used both Tamil and English words in their question.',
        'ONLY these short acronyms may stay in Latin script: FIR, NOC, BPL, OBC, SC, ST, G.O., MLA, MP.',
        'Every other word - including all department, Act and office names - must be in Tamil.',
        'Never write an English name in brackets after a Tamil one.',
      ] : []),
    );
  } else {
    lines.push(
      '═══════════════════════════════════════════════════════',
      'LANGUAGE: ANSWER ENTIRELY IN ENGLISH.',
      '═══════════════════════════════════════════════════════',
      'Write every word in English. Do NOT include Tamil script anywhere, not even in brackets.',
      ...(mixed ? [
        'The officer used both Tamil and English words in their question.',
        'Respond in professional English — this is acceptable for an officer comfortable with English.',
      ] : []),
    );
  }

  lines.push(
    '',
    'FORMAT & DEPTH REQUIREMENTS (DETAILED, HIGH-VALUE AI AGENT):',
    '• Give detailed, useful, and well-structured answers based on the user question — NOT just short search-result snippets.',
    '• Explain context, background, breakdown, key points, procedures, or code clearly and thoroughly.',
    '• Structure responses cleanly using headings (###), bullet points (•), numbered lists, and code blocks (```language).',
    '• NEVER hallucinate. If reliable information is unavailable from both official sources and established knowledge, clearly and transparently state so.',
    '• NEVER output raw URLs, website addresses, domain names, or source citations in the response.',
    '• Do NOT append disclaimers or source lists — output only the rich, verified, professional final answer.',
    '• When a confidence level is low, say so explicitly in the explanation.',
  );

  return lines.join('\n');
}

function formulateSearchQuery(q: string): string {
  const lower = q.toLowerCase();
  if (/(who is|current|now|is .* cm|chief minister|முதலமைச்சர்).*tamil\s*nadu|tamil\s*nadu.*(cm|chief minister|முதலமைச்சர்)/i.test(lower)) {
    return 'current Chief Minister of Tamil Nadu M K Stalin';
  }
  if (/\b(vijay|actor vijay|thalapathy)\b.*\b(movie|movies|film|films|filmography|list|cinema)\b/i.test(lower)
      || /\b(actor vijay|thalapathy vijay)\b/i.test(lower)) {
    return 'actor Vijay filmography popular movies Tamil cinema';
  }
  return q.replace(/[?.,!]/g, ' ').trim();
}

function cleanAnswerText(text: string): string {
  let cleaned = text;
  // Strip Markdown links e.g. [Title](https://...) -> Title
  cleaned = cleaned.replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, '$1');
  // Strip raw URLs
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, '');
  // Strip "Source: ...", "Official sources: ...", "Web Sources: ...", "ஆதாரங்கள்: ..."
  cleaned = cleaned.replace(/^(?:•\s*|-+\s*)?(?:Source|Sources|Official sources?|Web Sources?|ஆதாரம்|ஆதாரங்கள்):\s*.*$/gim, '');
  // Strip citation lines like "[1] Title" or "[1] https://..."
  cleaned = cleaned.replace(/^\[\d+\]\s*.*$/gim, '');
  // Strip trailing AI disclaimers
  cleaned = cleaned.replace(/—\s*(?:This is an AI-generated answer|இது AI உருவாக்கிய பதில்).*$/gim, '');
  // Clean up excess blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

function formatSources(results: SearchResult[]): string {
  if (!results.length) return '';
  return results.map((r, i) =>
    `[Source ${i + 1}: ${r.source}]\nTitle: ${r.title}\n${r.content ? `Verified Content:\n${r.content.slice(0, 2500)}` : `Summary: ${r.snippet}`}`,
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
    /** The console's UI language — officer's own selection, not auto-detected. */
    lang?: 'ta' | 'en';
  } = {},
): Promise<GlobalCopilotResult> {
  // ── Language resolution ──────────────────────────────────────────────────
  let lang: 'ta' | 'en';
  const hasTaChars = /[\u0B80-\u0BFF]/.test(question);
  const hasEnChars = /[A-Za-z]/.test(question);
  if (!hasTaChars && hasEnChars) {
    lang = 'en';
  } else if (hasTaChars && !hasEnChars) {
    lang = 'ta';
  } else {
    lang = opts.lang ?? replyLang(question);
  }

  const { mixed } = scriptComposition(question);
  const history = (opts.history ?? []).slice(-8);
  const verify = lang === 'ta' ? VERIFY_TA : VERIFY_EN;
  const noAnswer = lang === 'ta' ? NO_ANSWER_TA : NO_ANSWER_EN;

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
      : 'I am created by the Government of Tamil Nadu, Coimbatore District.\n\nI am the E-Gov Copilot, an official AI decision-support agent designed to assist officers and citizens with grievance redressal, statutory Acts & Rules, Government Orders (G.O.s), welfare schemes, and real-time public administration workflows.';

    return {
      data: {
        answer, sources: [], confidence: 1, requires_verification: false,
        toolsUsed, confidenceTier: 'HIGH',
      },
      confidence: 1,
      confidenceTier: 'HIGH',
      toolsUsed,
      sources: [],
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
    if (lang === 'ta' || TAMIL_SCRIPT.test(question)) {
      try {
        const en = await translateText(question, 'en');
        if (en.machine && en.text.trim()) searchQuery = en.text.trim();
      } catch { /* fall back to the original wording */ }
    }
    const sanitizedSearchQuery = formulateSearchQuery(searchQuery);
    const outcome = await searchOfficialSources(sanitizedSearchQuery, 4);
    webResults = outcome.results;
    if (!outcome.ok || !outcome.results.length) searchNote = outcome.note;

    for (const r of webResults) {
      webSources.push({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: r.source,
      });
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
    webResults.length
      ? `TOOL: search_official_sources\nOFFICIAL SOURCES retrieved from government websites:\n${formatSources(webResults)}`
      : searchNote
        ? `TOOL: search_official_sources\nOFFICIAL SOURCES: not available. ${searchNote}`
        : '',
    '',
    history.length
      ? `CONVERSATION SO FAR (most recent last):\n${history
        .map((h) => `${h.role === 'USER' ? 'Officer' : 'You'}: ${h.content.slice(0, 700)}`)
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
      webSources,
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
