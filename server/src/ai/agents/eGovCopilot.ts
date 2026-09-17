import { db } from '../../core/db.js';
import type { IAIProvider } from '../provider.js';
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
  /** Greetings and small talk - answered directly, never searched. */
  | 'CHITCHAT'
  | 'GENERAL_QUERY';

/**
 * Route the question to an intent — Hermes ReAct "Reason" step.
 *
 * Language-aware: a Tamil officer asking "இந்த மனு எந்த துறைக்கு?" and an
 * English officer asking "which department?" both reach DEPT_QUERY.
 */
function classify(q: string, hasPetition: boolean): Intent {
  const s = q.toLowerCase();

  // A greeting is not a research question; answer it directly and fast.
  if (isChitChat(q)) return 'CHITCHAT';

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

  // Act / Law
  if (/(which|what).*(act|law|section|provision)|\bact\b/.test(s)
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

/** Does this question benefit from live official web search? */
/*
 * WEB SEARCH IS THE DEFAULT for anything a citizen could be misinformed about.
 *
 * It used to fire only for a scheme question, or when the officer happened to
 * use a word like "latest" or "procedure". So "Which Act covers patta
 * transfer?" - precisely the kind of question where a stale or invented answer
 * does real harm - was answered from the model's own memory, with no source
 * for the officer to check.
 *
 * The rule is now inverted. Any legal, government or current-information
 * question searches automatically; only the cases that genuinely cannot
 * benefit are excluded:
 *
 *   STATS_QUERY       answered from this database - the web cannot know it
 *   PETITION_CONTEXT  answered from the open document - the web cannot know it
 *   TRANSLATE_QUERY   a language task, not a research one
 *   CHITCHAT          "hello" - searching would be absurd, and slow
 *
 * Everything else searches, so an officer can click through to the source.
 */
function needsWebSearch(intent: Intent, _q: string): boolean {
  return intent !== 'STATS_QUERY'
    && intent !== 'PETITION_CONTEXT'
    && intent !== 'TRANSLATE_QUERY'
    && intent !== 'CHITCHAT';
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
  limit = 25,
): {
  text: string;
  acts: any[];
  departments: any[];
  authorities: any[];
} {
  const terms = question.toLowerCase()
    .replace(/[^a-z0-9஀-௿\s]/g, ' ')
    .split(/\s+/).filter((w) => w.length > 2);

  const score = (row: any, fields: string[]) => {
    const hay = fields.map((f) => String(row[f] ?? '')).join(' ').toLowerCase();
    return terms.filter((t) => hay.includes(t)).length;
  };

  const acts = (db.prepare(
    'SELECT id, short_name, short_name_ta, full_title, act_number, year, summary, applies_when, ' +
    'keywords, verification_status FROM kb_act WHERE active = 1',
  ).all() as any[])
    .map((a) => ({ a, s: score(a, ['short_name', 'short_name_ta', 'full_title', 'summary', 'applies_when', 'keywords']) }))
    .filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, limit).map((x) => x.a);

  const departments = (db.prepare(
    'SELECT id, code, name, name_ta, responsibilities, keywords FROM kb_department WHERE active = 1',
  ).all() as any[])
    .map((d) => ({ d, s: score(d, ['name', 'name_ta', 'responsibilities', 'keywords']) }))
    .filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 12).map((x) => x.d);

  const authorities = (db.prepare(
    'SELECT id, designation, designation_ta, office_name, responsibilities, jurisdiction_level ' +
    'FROM kb_authority WHERE active = 1',
  ).all() as any[])
    .map((a) => ({ a, s: score(a, ['designation', 'designation_ta', 'office_name', 'responsibilities']) }))
    .filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 12).map((x) => x.a);

  const fallbackActs = acts.length ? acts : (db.prepare(
    'SELECT id, short_name, short_name_ta, full_title, summary, applies_when, verification_status ' +
    'FROM kb_act WHERE active = 1 LIMIT 15',
  ).all() as any[]);
  const fallbackDepts = departments.length ? departments : (db.prepare(
    'SELECT id, code, name, name_ta, responsibilities FROM kb_department WHERE active = 1 LIMIT 15',
  ).all() as any[]);

  /*
   * Give the model ONE name per record - the one it is meant to write.
   *
   * The context used to list both, as "Public Department / பொதுத்துறை", and a
   * model answering in Tamil then faithfully echoed both: "பொதுத்துறை (Public
   * Department)". No amount of prompt wording fixed that, because the model was
   * copying what it had been shown. Removing the other language from the
   * context removes the thing it was copying.
   *
   * The Tamil name falls back to the English one where a record has none, so a
   * department is always named rather than silently dropped.
   */
  const pick = (en: unknown, ta: unknown) =>
    String((lang === 'ta' ? (ta || en) : en) ?? '').trim();

  const text = [
    ...fallbackActs.map((a) => `ACT [id ${a.id}] ${pick(a.short_name, a.short_name_ta)}` +
      (a.act_number ? ` (${a.act_number}${a.year ? `, ${a.year}` : ''})` : '') +
      (a.applies_when ? `\n  Applies when: ${a.applies_when}` : '') +
      `\n  Verification status: ${a.verification_status ?? 'UNVERIFIED'}`),
    ...fallbackDepts.map((d) => `DEPARTMENT [id ${d.id}] ${pick(d.name, d.name_ta)}` +
      (d.responsibilities ? `\n  Handles: ${String(d.responsibilities).slice(0, 300)}` : '')),
    ...authorities.map((a) => `AUTHORITY [id ${a.id}] ${pick(a.designation, a.designation_ta)}` +
      (a.office_name ? `, ${a.office_name}` : '') +
      (a.jurisdiction_level ? ` (${a.jurisdiction_level})` : '')),
  ].join('\n\n');

  return { text, acts: fallbackActs, departments: fallbackDepts, authorities };
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
    'GENERAL QUESTIONS ARE WELCOME:',
    '═══════════════════════════════════════════════════════',
    'You may answer from your own general knowledge when the question asks for:',
    '   • What a term means (RTI, patta, chitta, FIR, encumbrance certificate, G.O.)',
    '   • How something generally works, or how to write or structure a document',
    '   • Drafting, summarising, rephrasing, or translating text the officer gives you',
    '   • Everyday administrative or common-knowledge questions',
    'Answer these directly and helpfully. Do not refuse them, and do not tell the officer',
    'to ask an administrator — that reply is only for a missing Act, department or case fact.',
    '',
    'THE BOUNDARY: the moment your answer would name a SPECIFIC Act, section, Government',
    'Order, department, officer, date, amount or case detail, rules 1 and 2 apply again —',
    'that value must come from the context below, or you must say it is not available.',
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
      /*
       * The mixed-language clause used to say "you may retain widely-used
       * English administrative terms", which a model read as permission to
       * gloss every name: "பொதுத்துறை (Public Department)". That is the
       * bracketed English the line above forbids. The allowance is now limited
       * to the short acronyms that genuinely have no Tamil form, and the ban
       * on glossing is restated where the model will act on it.
       */
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
    'FORMAT:',
    '• Use bullet points (•) for lists of items.',
    '• Keep answers concise and practical — an officer is reading this while handling a case.',
    '• If citing a source, name it clearly so the officer can open it.',
    '• When a confidence level is low, say so explicitly.',
  );

  return lines.join('\n');
}

function formatSources(results: SearchResult[]): string {
  if (!results.length) return '';
  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\n    ${r.url}\n    ${(r.content || r.snippet || '').slice(0, 1500)}`,
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
  const lang = opts.lang ?? replyLang(question);
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

  // ── Tool: query_knowledge_base ───────────────────────────────────────────
  toolsUsed.push('query_knowledge_base');
  const knowledge = loadKnowledgeContext(question, lang);
  /*
   * The source chips are shown to the officer, so they follow the language
   * too. They were pinned to the English columns, which put
   * "Maintenance and Welfare of Parents and Senior Citizens Act, 2007" under
   * an otherwise Tamil answer.
   */
  for (const a of knowledge.acts.slice(0, 5)) {
    addSource('ACT', a.id, kbName(a.short_name, a.short_name_ta, lang));
  }
  for (const d of knowledge.departments.slice(0, 4)) {
    addSource('DEPARTMENT', d.id, kbName(d.name, d.name_ta, lang));
  }

  // ── Tool: search_official_sources (conditional) ───────────────────────────
  let searchNote: string | undefined;
  let webResults: SearchResult[] = [];
  if (needsWebSearch(intent, question)) {
    toolsUsed.push('search_official_sources');
    /*
     * SEARCH IN ENGLISH, ANSWER IN THE OFFICER'S LANGUAGE.
     *
     * tn.gov.in, indiacode.nic.in and the Gazette are indexed in English, so a
     * Tamil question sent verbatim to a web index finds nothing - "பட்டா
     * மாற்றத்திற்கு எந்த சட்டம்?" returned zero sources while the same question
     * in English returned three official pages.
     *
     * The QUERY is therefore translated; the ANSWER is still written in Tamil
     * from the Tamil prompt. Where translation is unavailable the original is
     * used, which is no worse than before.
     */
    let searchQuery = question;
    if (lang === 'ta' || TAMIL_SCRIPT.test(question)) {
      try {
        const en = await translateText(question, 'en');
        if (en.machine && en.text.trim()) searchQuery = en.text.trim();
      } catch { /* fall back to the original wording */ }
    }
    const outcome = await searchOfficialSources(searchQuery, 3);
    webResults = outcome.results;
    if (!outcome.ok || !outcome.results.length) searchNote = outcome.note;
    for (const r of webResults) addSource('WEB', null, `${r.title} (${r.source})`);
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
      maxTokens: 1400,
    });
    answer = completion.text.trim();

    /*
     * Confidence grading — Hermes-style grounding score.
     *
     * HIGH: petition + KB + web sources all contributed.
     * MEDIUM: KB + at least one other source.
     * LOW: general reasoning with limited grounding.
     */
    const grounding =
      (petition ? 2 : 0) +                            // petition is strongest
      (knowledge.acts.length ? 1 : 0) +
      (knowledge.departments.length ? 1 : 0) +
      (webResults.length ? 1 : 0);
    confidence = Math.min(0.92, 0.30 + grounding * 0.13);

    if (!isLiveProvider()) {
      confidence = Math.min(confidence, 0.4);
      answer += lang === 'ta'
        ? '\n\n(குறிப்பு: நேரடி மொழி மாதிரி கட்டமைக்கப்படவில்லை. இது வரையறுக்கப்பட்ட உள்ளூர் பகுப்பாய்வு மட்டுமே.)'
        : '\n\n(Note: no live language model is configured, so this is limited local analysis only.)';
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[egov-copilot] answer failed:', msg.slice(0, 300));

    /*
     * Say what actually went wrong.
     *
     * This branch is reached when the MODEL CALL FAILED - quota, network, a
     * rejected key - and has nothing to do with the knowledge base. Prefixing
     * it with "I could not answer that from the configured knowledge base ...
     * ask an administrator to add the relevant Act" sent the officer to fix
     * something that was not broken, and was plainly wrong for a general
     * question like "What is RTI?", which needs no Act at all.
     *
     * The service reason alone is the honest answer here.
     */
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

  // Append cited web sources so the officer can verify
  if (webResults.length) {
    answer += lang === 'ta' ? '\n\nஅதிகாரப்பூர்வ ஆதாரங்கள்:' : '\n\nOfficial sources:';
    webResults.forEach((r, i) => { answer += `\n[${i + 1}] ${r.title} — ${r.url}`; });
  } else if (searchNote) {
    /*
     * The note is written by the search module in English, so it cannot be
     * pasted into a Tamil answer - that is the mixing this console must not
     * do. The two outcomes an officer can act on are stated in their own
     * language instead; the English detail stays in the server log.
     */
    const noSource = /no official government source/i.test(searchNote);
    const taNote = noSource
      ? 'அதிகாரப்பூர்வ அரசு ஆதாரம் எதுவும் கிடைக்கவில்லை.'
      : 'நேரடி இணையத் தேடலை இப்போது அணுக முடியவில்லை.';
    answer += lang === 'ta'
      ? `\n\nநேரடி தேடல்: ${taNote}`
      : `\n\nLive search: ${searchNote}`;
  }

  answer += `\n\n— ${verify}`;

  const finalConfidence = confidence;
  return {
    data: {
      answer, sources, confidence: finalConfidence, requires_verification: true,
      toolsUsed, confidenceTier: tierOf(finalConfidence),
    },
    confidence: finalConfidence,
    confidenceTier: tierOf(finalConfidence),
    toolsUsed,
    sources,
  };
}
