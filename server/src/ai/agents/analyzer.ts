import { db } from '../../core/db.js';
import { isLiveProvider } from '../gateway.js';
import type { IAIProvider } from '../provider.js';
import {
  detectConcepts, similarity, tokenise, CONCEPT_LABELS,
  type DetectedConcept,
} from '../semantic.js';

/**
 * Petition Analyzer.
 *
 * Reads the petition and its documents in Tamil or English, works out what the
 * matter is ABOUT, and ranks the configured knowledge records against that
 * understanding.
 *
 * Two properties hold by construction, not by instruction:
 *
 *   1. It can only name an Act, section, department or authority that exists
 *      as a row in the knowledge base. Records are selected by id; there is no
 *      code path that produces a legal reference of its own. When nothing
 *      matches, it says so.
 *
 *   2. It never asserts. Every conclusion is a recommendation carrying its
 *      reasoning, its confidence, and the verification requirement - in both
 *      Tamil and English, so an officer reading either sees the same caveat.
 */

const VERIFY_EN = 'Requires Officer Verification.';
const VERIFY_TA = 'அதிகாரி சரிபார்ப்பு தேவை.';

export interface Bilingual { en: string; ta: string }

export interface AnalysisResult {
  summary: Bilingual;
  main_issue: Bilingual;
  sub_issues: Bilingual[];
  petitioner_request: Bilingual;
  important_facts: Bilingual[];
  detected_concepts: { id: string; label: Bilingual; evidence: string[] }[];
  entities: {
    people: string[]; places: string[]; dates: string[]; amounts: string[];
    documents_mentioned: string[];
  };
  /*
   * NAMES ARE BILINGUAL.
   *
   * The Tamil name of every Act, department and authority is held in the
   * knowledge base (short_name_ta, name_ta, designation_ta). Emitting the
   * English string alone left the Tamil view showing "Tamil Nadu Urban Local
   * Bodies framework" in English in the middle of an otherwise Tamil analysis.
   *
   * Where a record has no Tamil name recorded, `bi()` falls back to the
   * English one rather than showing a blank - an officer must always see the
   * name of the Act being proposed.
   */
  act: {
    id: number | null; short_name: Bilingual | null; full_title: Bilingual | null;
    act_number: string | null; year: number | null;
    jurisdiction_scope: string | null;
    verification_status: string | null; source_reference: string | null;
    section_id: number | null; section_no: string | null;
    section_heading: Bilingual | null;
    section_text: Bilingual | null;
    reason: Bilingual; confidence: number;
    /** Other Acts that scored closely - shown so the officer can compare. */
    alternatives: { id: number; short_name: Bilingual; confidence: number }[];
  };
  department: {
    id: number | null; code: string | null; name: Bilingual | null;
    reason: Bilingual; confidence: number;
  };
  authority: {
    id: number | null; designation: Bilingual | null; office_name: Bilingual | null;
    jurisdiction_level: string | null; jurisdiction_area: string | null;
    reason: Bilingual;
  };
  escalation: { designation: Bilingual | null; office_name: Bilingual | null } | null;
  next_action: Bilingual;
  workflow: Bilingual[];
  required_documents: Bilingual[];
  priority: string;
  priority_reason: Bilingual;
  missing_information: Bilingual[];
  /*
   * Both halves are bilingual.
   *
   * `step` used to be a plain English string, so a Tamil console showed
   * "Petition → Issue → Act → Section" in English above Tamil values - the
   * mixing the console must not do. `step` is kept as well, unchanged, so any
   * stored analysis and any caller that reads it still works.
   */
  reasoning_flow: { step: string; step_label: Bilingual; value: Bilingual }[];
  overall_confidence: number;
  requires_verification: true;
}

const TAMIL_RE = /[஀-௿]/;
const DATE_RE = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi;
/*
 * Money, written either way round.
 *
 * A Tamil order writes "ரூபாய் 3,000" and also "ரூ 1,500". Requiring the
 * currency word immediately before the digits missed the first form, so a
 * maintenance award of Rs 3,000 a month never reached the officer.
 */
const AMOUNT_RE =
  /(?:rs\.?|inr|₹|ரூ[பாய்‌‍]*)\s*[\d,]+(?:\/-)?/gi;
/*
 * A person's name, in either script.
 *
 * The Latin-only pattern left the people list empty on a Tamil order that
 * named the petitioner and both her sons. Tamil names follow an honorific
 * exactly as English ones do, and OCR mangles the first letter of
 * "திரு" often enough that a near-miss is accepted.
 */
const NAME_RE =
  /(?:Mr\.?|Mrs\.?|Ms\.?|Thiru\.?|Tmt\.?|Selvi\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
const TA_NAME_RE =
  /(?:திருமதி|திரு|செல்வி|[஀-௿]{0,2}ருமதி|[஀-௿]{0,2}ரு)\s*\.\s*([஀-௿][஀-௿‌‍]{2,30})/g;
/*
 * A place is "<Name> Village", "<Name> Taluk", "<Name> Street".
 *
 * The proper noun comes BEFORE the type word, in English as in Tamil. The
 * previous pattern matched the type word and then took up to forty characters
 * AFTER it, which captured whatever prose followed: "I request the District
 * Collector to help us" was recorded as a place named "District Collector to
 * help us", and "Demo Taluk was sold" as "Taluk was sold". The first is an
 * office rather than a place at all, and both were then shown to the officer
 * under "Places mentioned".
 *
 * Capturing the capitalised name in front of the type word gets the actual
 * place and nothing else, and a bare "District Collector" no longer matches
 * because "Collector" is not one of the type words.
 */
const PLACE_RE =
  /\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})\s+(?:Village|Taluk|District|Street|Road|Nagar|Colony)\b/g;
const TA_PLACE_RE = /[஀-௿]+\s*(?:கிராமம்|வட்டம்|மாவட்டம்|தெரு|நகர்|சாலை)/g;
const DOC_RE = /\b(?:patta|chitta|sale deed|aadhaar|ration card|certificate|fir|receipt|bill|adangal|encumbrance)\b/gi;
const TA_DOC_RE = /(?:பட்டா|சிட்டா|கிரய பத்திரம்|ஆதார்|ரேஷன் அட்டை|சான்றிதழ்|ரசீது|அடங்கல்|வில்லங்க)/g;

/*
 * English names for the documents the pattern above recognises.
 *
 * A LOOKUP, not a translation: these are a closed set of official record types
 * with settled English names, so an English console should read "Aadhaar"
 * rather than "ஆதார்". Sending them to a language model would risk a paraphrase
 * of a document's official name, which is exactly what must not happen.
 */
const DOC_NAME_EN: Record<string, string> = {
  'பட்டா': 'patta',
  'சிட்டா': 'chitta',
  'கிரய பத்திரம்': 'sale deed',
  'ஆதார்': 'Aadhaar',
  'ரேஷன் அட்டை': 'ration card',
  'சான்றிதழ்': 'certificate',
  'ரசீது': 'receipt',
  'அடங்கல்': 'adangal',
  'வில்லங்க': 'encumbrance certificate',
};

/** The English name of a document type, or the original where none is recorded. */
const docNameEn = (d: string) => DOC_NAME_EN[d.trim()] ?? d;

function sentences(text: string): string[] {
  return String(text || '')
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
}

const isTamil = (t: string) => TAMIL_RE.test(String(t || ''));

/**
 * Is this "subject" only a stand-in?
 *
 * A Copilot upload starts life labelled with the filename or a generic marker.
 * Neither says anything about the grievance, and feeding one to the classifier
 * or the summariser would put it in front of an officer as though the
 * petitioner had written it.
 */
const SUBJECT_LABELS = new Set([
  'uploaded document', 'document', 'petition', 'untitled', '-', '--',
]);

function looksLikeLabel(s: unknown): boolean {
  const v = String(s ?? '').trim();
  if (v.length < 4) return true;
  if (/\.(pdf|docx?|jpe?g|png|txt)$/i.test(v)) return true;
  return SUBJECT_LABELS.has(v.toLowerCase());
}

/** Present a value in both languages, marking what was not translated. */
function bi(en: string, ta: string): Bilingual {
  return { en, ta };
}

/**
 * Echo source text into both fields.
 *
 * The petitioner's own words are never machine-translated - a case record must
 * carry what the citizen actually wrote. Where only one language is available,
 * that text appears in both fields rather than being replaced by a rendering.
 */
function echo(text: string): Bilingual {
  return { en: text, ta: text };
}

/**
 * The bilingual name of a knowledge-base record.
 *
 * Falls back to the English name when no Tamil name has been recorded, because
 * an officer reading the Tamil view must still see WHICH Act is being proposed.
 * A blank there would be worse than an untranslated name. Returns null only
 * when the record has no name at all.
 */
/*
 * Jurisdiction levels are a closed set defined by the schema, not free text,
 * so rendering them in Tamil is a lookup rather than a translation. An
 * unrecognised value falls through as-is instead of being guessed at.
 */
/*
 * Tamil names for the documents Acts commonly require.
 *
 * A lookup, not a translator: only terms with a settled Tamil form appear
 * here. Anything absent is shown in English, which is honest - a citizen can
 * still be told what to bring.
 */
const REQUIRED_DOC_TA: Record<string, string> = {
  'proof of age': 'வயது சான்று',
  'proof of relationship': 'உறவுமுறை சான்று',
  'identity proof': 'அடையாளச் சான்று',
  'proof of identity': 'அடையாளச் சான்று',
  'address proof': 'முகவரிச் சான்று',
  'ration card': 'ரேஷன் அட்டை',
  'aadhaar card': 'ஆதார் அட்டை',
  'income certificate': 'வருமானச் சான்றிதழ்',
  'community certificate': 'சாதிச் சான்றிதழ்',
  'birth certificate': 'பிறப்புச் சான்றிதழ்',
  'death certificate': 'இறப்புச் சான்றிதழ்',
  'medical certificate': 'மருத்துவச் சான்றிதழ்',
  'property document if a transfer is alleged':
    'சொத்து மாற்றம் கூறப்பட்டால் அதற்கான ஆவணம்',
  'property documents': 'சொத்து ஆவணங்கள்',
  'patta or chitta': 'பட்டா அல்லது சிட்டா',
  'sale deed': 'கிரய பத்திரம்',
  'encumbrance certificate': 'வில்லங்கச் சான்றிதழ்',
  'bank passbook': 'வங்கி கணக்குப் புத்தகம்',
  'photograph': 'புகைப்படம்',
  'copy of the complaint': 'புகார் நகல்',
  'first information report': 'முதல் தகவல் அறிக்கை',
};

const JURISDICTION_TA: Record<string, string> = {
  STATE: 'மாநிலம்',
  DISTRICT: 'மாவட்டம்',
  TALUK: 'வட்டம்',
  BLOCK: 'ஒன்றியம்',
  VILLAGE: 'கிராமம்',
  ZONE: 'மண்டலம்',
  WARD: 'வார்டு',
  NATIONAL: 'தேசிய',
};

function kbName(en: unknown, ta: unknown): Bilingual | null {
  const e = typeof en === 'string' && en.trim() ? en.trim() : null;
  const t = typeof ta === 'string' && ta.trim() ? ta.trim() : null;
  if (!e && !t) return null;
  return { en: e ?? t!, ta: t ?? e! };
}

export async function runAnalysis(
  provider: IAIProvider,
  petitionId: number,
): Promise<{ data: AnalysisResult; confidence: number; sources: unknown[] }> {
  const p = db.prepare('SELECT * FROM cp_petition WHERE id = ?').get(petitionId) as any;
  if (!p) throw new Error('Petition not found');

  const docs = db.prepare(
    'SELECT title, extracted_text, ocr_corrected_text FROM cp_document WHERE petition_id = ?',
  ).all(petitionId) as any[];

  // Prefer the corrected text (officer-reviewed or AI-assisted) over the raw OCR output.
  // Both are preserved in the database; only the best version is used for analysis.
  /*
   * The PDF extractor prefixes each page with a "--- Page n ---" marker so an
   * officer reading the extracted text can see where pages break. That marker
   * is scaffolding, not content: left in, it appears at the front of the
   * summary as though the petitioner had written it. It is stripped here while
   * the stored text keeps it.
   */
  const PAGE_MARKER = /^[ \t]*---\s*Page\s+\d+\s*---[ \t]*$/gim;
  const docText = docs
    .map((d) => d.ocr_corrected_text || d.extracted_text || '')
    .filter(Boolean)
    .join('\n\n')
    .replace(PAGE_MARKER, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  /*
   * A document submitted to the e-Gov Copilot has no citizen-written subject or
   * description - the file IS the petition. Its stored subject is only a label
   * ("Uploaded document", or the filename), so including it would put that
   * label into the summary and the main issue as though the petitioner had
   * written it. For a COPILOT record the document text alone is the content.
   */
  const isCopilotDoc = p.origin === 'COPILOT';

  /*
   * A subject worth weighing, as opposed to a label.
   *
   * The Copilot path used to drop the subject entirely, because the row was
   * created with the filename. It now carries the petition's OWN subject line,
   * read out of the document ("பொருள் : தெருவிளக்குகள் எரியாததால் …"), which is
   * the single most informative sentence in the whole petition: it is the
   * petitioner's own statement of what the matter is.
   *
   * It is REPEATED so it outweighs the body. A petition about street lights
   * mentioned elderly residents in passing, and the body's incidental words
   * outvoted the subject: the case was classified under the Senior Citizens
   * Act instead of the municipal one. Weighting the subject line fixes the
   * ranking without hard-coding any particular subject or Act.
   */
  const realSubject = looksLikeLabel(p.subject) ? null : String(p.subject).trim();
  const corpus = (isCopilotDoc
    ? [realSubject, realSubject, docText]
    : [p.subject, p.subject, p.description, docText]
  ).filter(Boolean).join('\n\n');
  const tamilSource = isTamil(corpus);

  /*
   * The short line that stands for the petition.
   *
   * Normally the citizen's own subject. For a Copilot document there is no
   * such subject, so the document's first substantive line is used - the
   * stored label ("Uploaded document") would otherwise be reported as the
   * matter of the grievance.
   */
  const headline = (() => {
    /*
     * The petition's own subject line, whenever there is a real one.
     *
     * The first line of the document is a poor stand-in: a Tamil petition
     * opens with "அனுப்புநர் ," ("From,"), which was then reported as the
     * matter of the grievance and carried into the summary and the reasoning
     * flow. The subject is now read out of the document during extraction, so
     * it is available here and is far better.
     */
    if (realSubject) return realSubject;
    if (!isCopilotDoc) return String(p.subject ?? '');

    const lines = String(docText)
      .split('\n')
      .map((l) => l.trim())
      // Skip the page markers the PDF extractor inserts.
      .filter((l) => l && !/^---\s*Page\s+\d+\s*---$/i.test(l));

    /*
     * Failing that, skip the letter's scaffolding. "From", "To" and the
     * salutation are addressing, not content, and any of them standing as the
     * headline tells an officer nothing about the case.
     */
    const SCAFFOLD =
      /^(?:from|to|sir|madam|respected|அனுப்புநர்|ப[பெொ]*றுநர்|மதிப்பிற்குரிய|ஐயா|அய்யா)\s*[,:：.]?\s*$/i;
    const firstReal = lines.find((l) => l.length > 3 && !SCAFFOLD.test(l));
    return firstReal ?? lines.find((l) => l.length > 3) ?? String(p.subject ?? '');
  })();

  // ---------------- understand what the petition is about ----------------
  const concepts = detectConcepts(corpus);
  const ss = sentences(corpus);

  // ---------------- entities ----------------
  const dates = [...new Set([...corpus.matchAll(DATE_RE)].map((m) => m[0]))];
  const amounts = [...new Set([...corpus.matchAll(AMOUNT_RE)].map((m) => m[0]))];
  const people = [...new Set([
    ...[...corpus.matchAll(NAME_RE)].map((m) => m[1]),
    ...[...corpus.matchAll(TA_NAME_RE)].map((m) => m[1].trim()),
  ])].filter((n) => n.length > 2);
  const places = [...new Set([
    ...[...corpus.matchAll(PLACE_RE)].map((m) => m[0].trim()),
    ...[...corpus.matchAll(TA_PLACE_RE)].map((m) => m[0].trim()),
  ])];
  const docsMentioned = [...new Set([
    ...[...corpus.matchAll(DOC_RE)].map((m) => m[0].toLowerCase()),
    ...[...corpus.matchAll(TA_DOC_RE)].map((m) => m[0]),
  ])];

  /* ---------------- Issue type (configured subject) ----------------
   *
   * Which configured ISSUE TYPE this petition is, decided before the Act.
   *
   * This is the knowledge base's own routing table: an administrator records
   * "Street light not working, drainage blocked…" together with the department
   * that handles it. That mapping is a curated fact, and it is therefore a far
   * better signal than counting shared words against 145 Acts.
   *
   * It is computed HERE, ahead of the Act and department, because it informs
   * both. A petition about street lights mentioned elderly residents in
   * passing; both concepts scored identically, and the case was filed under
   * the Senior Citizens Act with Social Welfare. Letting the configured issue
   * type break that tie fixes the ranking without hard-coding any subject,
   * Act or department - remove the row from the knowledge base and the
   * behaviour goes with it.
   */
  const subjects = db.prepare('SELECT * FROM kb_subject WHERE active = 1').all() as any[];
  const subjScored = subjects.map((s) => ({
    row: s,
    sim: similarity(corpus, concepts,
      [s.keywords, s.description, s.name, s.name_ta].filter(Boolean).join(' . ')),
  })).filter((x) => x.sim.score >= 8).sort((x, y) => y.sim.score - x.sim.score);

  const matchedSubject = subjScored[0]?.row ?? null;

  /*
   * The concepts that the matched issue type is actually about.
   *
   * Used to prefer an Act that shares them. The issue type's own text is a
   * clean, administrator-written description, so its concepts are not subject
   * to the OCR damage that the petition text carries.
   */
  const subjectConceptIds = new Set(
    matchedSubject
      ? detectConcepts(
        [matchedSubject.keywords, matchedSubject.description, matchedSubject.name]
          .filter(Boolean).join(' . '),
      ).map((c) => c.id)
      : [],
  );

  /*
   * Promote the concepts the matched ISSUE TYPE is about.
   *
   * `concepts` is ranked by how often each idea appears in the petition text,
   * and a passing mention ties with the actual subject: a street-light
   * petition that mentioned elderly residents once scored `senior_citizen` and
   * `street_light` at exactly 3.0 each, so the case was reported as "Senior
   * citizen" in the summary, the main issue and the reasoning flow.
   *
   * The configured issue type is administrator-written and free of the OCR
   * damage the petition text carries, so it is the better judge of what the
   * matter is. Ordering is stable, so concepts it does not name keep their
   * relative rank rather than being discarded.
   */
  if (subjectConceptIds.size) {
    concepts.sort((a, b) => {
      const av = subjectConceptIds.has(a.id) ? 1 : 0;
      const bv = subjectConceptIds.has(b.id) ? 1 : 0;
      if (av !== bv) return bv - av;
      return b.score - a.score;
    });
  }

  // ---------------- Act ----------------
  const acts = db.prepare('SELECT * FROM kb_act WHERE active = 1').all() as any[];
  const actScored = acts.map((a) => {
    const recordText = [
      a.keywords, a.keywords_ta, a.petition_type, a.rules, a.section,
      a.applies_when, a.applies_when_ta, a.summary,
      a.full_title, a.full_title_ta, a.short_name, a.short_name_ta,
    ].filter(Boolean).join(' . ');
    const sim = similarity(corpus, concepts, recordText);

    /*
     * An Act that is about the SAME ISSUE TYPE the petition matched is
     * preferred over one that merely shares vocabulary with it.
     *
     * The boost is modest on purpose: it breaks a tie and corrects a
     * near-miss, but it cannot lift an Act over the relevance floor on its
     * own, so a petition whose subject the knowledge base does not cover still
     * reports no Act rather than being handed the least-bad one.
     */
    if (subjectConceptIds.size) {
      const agree = sim.sharedConcepts.filter((c) => subjectConceptIds.has(c.split('|')[0]));
      if (agree.length) sim.score += 6 * agree.length;
    }
    return { row: a, sim };
  }).filter((x) => x.sim.score > 0).sort((x, y) => y.sim.score - x.sim.score);

  /*
   * Break ties deterministically, and treat a tie as a reason for less
   * confidence rather than more.
   *
   * Four Acts once scored identically on the single concept "encroachment" -
   * land, forest, tanks and preventive detention all mention it. Picking the
   * first by database order and presenting it confidently would be arbitrary.
   *
   * The tiebreaker prefers the record whose own subject is most concentrated
   * on the matched concepts: an Act about encroachment specifically beats one
   * that merely mentions it among many other subjects.
   */
  for (const cand of actScored) {
    const recordConcepts = detectConcepts(
      [cand.row.keywords, cand.row.keywords_ta, cand.row.petition_type, cand.row.rules, cand.row.applies_when, cand.row.summary].filter(Boolean).join(' . '),
    );
    const focus = recordConcepts.length
      ? cand.sim.sharedConcepts.length / recordConcepts.length
      : 0;
    (cand as any).focus = focus;
    // A small adjustment - enough to order a tie, not enough to overturn a
    // genuinely better match.
    cand.sim.score += focus * 4;
  }
  actScored.sort((x, y) => y.sim.score - x.sim.score);

  const topAct = actScored[0];
  const runnerAct = actScored[1];

  /*
   * How contested is the top match? When several Acts score within a few
   * points of each other the officer needs to know the choice was close, so
   * the near-ties are surfaced and confidence is reduced.
   */
  const contenders = topAct
    ? actScored.filter((x) => x.sim.score >= topAct.sim.score * 0.9).slice(0, 4)
    : [];
  const contested = contenders.length > 1;

  /*
   * Relevance floor.
   *
   * Similarity always returns something for any overlapping word, so a floor
   * is needed or every petition would be assigned an Act. A petition about a
   * subject the knowledge base does not cover must report no match rather than
   * be handed the least-bad option.
   */
  const MIN_ACT_SCORE = 12;
  const actQualifies = !!topAct
    && topAct.sim.score >= MIN_ACT_SCORE
    && topAct.sim.sharedConcepts.length > 0;

  const actMargin = actQualifies
    ? (topAct.sim.score - (runnerAct?.sim.score ?? 0)) / (topAct.sim.score || 1)
    : 0;
  const actConfidence = actQualifies
    ? Math.min(0.9, 0.35 + Math.min(topAct.sim.score / 80, 0.35) + actMargin * 0.2)
      * (contested ? 0.7 : 1)
    : 0;

  // Best section within the chosen Act, only where it genuinely matches.
  let section: any = null;
  if (actQualifies) {
    const sections = db.prepare(
      'SELECT * FROM kb_section WHERE act_id = ? AND active = 1',
    ).all(topAct.row.id) as any[];
    const secScored = sections.map((s) => ({
      row: s,
      sim: similarity(corpus, concepts,
        [s.keywords, s.applies_when, s.heading, s.text].filter(Boolean).join(' . ')),
    })).filter((x) => x.sim.score >= 8 && x.sim.sharedConcepts.length > 0)
      .sort((x, y) => y.sim.score - x.sim.score);
    section = secScored[0]?.row ?? null;
    if (!section && topAct.row.section) {
      section = {
        id: null,
        section_no: topAct.row.section.split('(')[0]?.trim() || 'Key Provision',
        heading: topAct.row.section,
        heading_ta: topAct.row.section,
        text: `${topAct.row.section} (${topAct.row.rules || topAct.row.short_name})`,
        text_ta: `${topAct.row.section} (${topAct.row.rules || topAct.row.short_name_ta || topAct.row.short_name})`,
      };
    }
  }

  // ---------------- Department ----------------
  const departments = db.prepare('SELECT * FROM kb_department WHERE active = 1').all() as any[];
  const deptScored = departments.map((d) => ({
    row: d,
    sim: similarity(corpus, concepts,
      [d.keywords, d.responsibilities, d.description, d.name].filter(Boolean).join(' . ')),
  })).filter((x) => x.sim.score > 0).sort((x, y) => y.sim.score - x.sim.score);

  /*
   * The department configured AGAINST THE MATCHED ISSUE TYPE.
   *
   * An administrator recording "Street light not working" also records that
   * Municipal Administration handles it. That is a direct routing instruction,
   * so it outranks word overlap - a street-light petition was otherwise sent
   * to Revenue, which does not deal with street lights at all.
   *
   * It is applied before the Act's administering department so that, where
   * both are configured, the Act - the more specific finding - still wins.
   */
  if (matchedSubject?.default_department_id) {
    const id = matchedSubject.default_department_id as number;
    const existing = deptScored.find((d) => d.row.id === id);
    // Both names, in the same `en|ta` form the `administers:` marker uses,
    // so the reason renders in the officer's language rather than leaving
    // an English issue-type name inside a Tamil sentence.
    const why = `issuetype:${matchedSubject.name}|${matchedSubject.name_ta || matchedSubject.name}`;
    if (existing) {
      existing.sim.score += 50;
      existing.sim.sharedConcepts.push(why);
    } else {
      const row = departments.find((d) => d.id === id);
      if (row) deptScored.push({ row, sim: { score: 50, sharedConcepts: [why], sharedTerms: [] } });
    }
    deptScored.sort((x, y) => y.sim.score - x.sim.score);
  }

  /*
   * A department configured as administering the identified Act is a curated
   * relationship and far stronger than textual similarity. Without this, a
   * petition about a moneylender matched departments on the words "loan" and
   * "money" rather than the office that actually administers the Act.
   */
  if (actQualifies) {
    const administering = db.prepare(
      'SELECT department_id FROM kb_department_act WHERE act_id = ?',
    ).all(topAct.row.id).map((r: any) => r.department_id) as number[];

    if (administering.length) {
      for (const ds of deptScored) {
        if (administering.includes(ds.row.id)) {
          ds.sim.score += 100;
          ds.sim.sharedConcepts.push(`administers:${topAct.row.short_name}|${topAct.row.short_name_ta || topAct.row.short_name}`);
        }
      }
      const present = new Set(deptScored.map((d) => d.row.id));
      for (const id of administering) {
        if (present.has(id)) continue;
        const row = departments.find((d) => d.id === id);
        if (row) {
          deptScored.push({
            row,
            sim: { score: 100, sharedConcepts: [`administers:${topAct.row.short_name}|${topAct.row.short_name_ta || topAct.row.short_name}`], sharedTerms: [] },
          });
        }
      }
      deptScored.sort((x, y) => y.sim.score - x.sim.score);
    }
  }

  const topDept = deptScored[0];
  const runnerDept = deptScored[1];
  const MIN_DEPT_SCORE = 10;
  const deptQualifies = !!topDept
    && (topDept.sim.score >= MIN_DEPT_SCORE || topDept.sim.score >= 100);

  const deptMargin = deptQualifies
    ? (topDept.sim.score - (runnerDept?.sim.score ?? 0)) / (topDept.sim.score || 1)
    : 0;
  const deptConfidence = deptQualifies
    ? Math.min(0.92, 0.4 + Math.min(topDept.sim.score / 150, 0.35) + deptMargin * 0.17)
    : 0;

  // ---------------- Authority ----------------
  let authority: any = null;
  let escalation: any = null;
  if (deptQualifies) {
    const auths = db.prepare(
      'SELECT * FROM kb_authority WHERE active = 1 AND department_id = ?',
    ).all(topDept.row.id) as any[];

    const authScored = auths.map((a) => {
      const sim = similarity(corpus, concepts,
        [a.keywords, a.responsibilities, a.designation, a.office_name].filter(Boolean).join(' . '));
      // The petition rarely names a designation, so being the configured
      // authority for the chosen department is itself the primary signal.
      return { row: a, score: sim.score + 10 };
    }).sort((x, y) => y.score - x.score);

    authority = authScored[0]?.row ?? null;
    if (!authority && topAct?.row?.authority) {
      authority = {
        id: null,
        designation: topAct.row.authority,
        designation_ta: topAct.row.authority_ta || topAct.row.authority,
        office_name: topDept.row.name,
        office_name_ta: topDept.row.name_ta,
        jurisdiction_level: 'DISTRICT',
      };
    }

    // Escalation: a higher jurisdiction level in the same department.
    if (authority) {
      const RANK: Record<string, number> = { VILLAGE: 1, TALUK: 2, DISTRICT: 3, STATE: 4 };
      const mine = RANK[authority.jurisdiction_level] ?? 0;
      escalation = auths
        .filter((a) => (RANK[a.jurisdiction_level] ?? 0) > mine)
        .sort((a, b) => (RANK[a.jurisdiction_level] ?? 0) - (RANK[b.jurisdiction_level] ?? 0))[0] ?? null;
    }
  }

  // ---------------- Priority ----------------
  // The issue type was matched earlier, before the Act, because it informs the
  // Act and department choice as well as the priority.
  const priority = matchedSubject?.default_priority ?? 'NORMAL';

  // ---------------- narrative ----------------
  const summaryOut = await provider.summarize(corpus);
  /*
   * Summarise the SUBSTANCE, not the letterhead.
   *
   * Taking the first three sentences produced "Sub-divisional Magistrate,
   * Coimbatore South Division, Parents and Senior Citizens Maintenance..." -
   * the printed heading of the order, which tells an officer nothing about the
   * grievance. An official document opens with its issuing office, so the
   * opening lines are the least informative part of it.
   *
   * Sentences are instead scored on what a summary needs: the concepts the
   * analyser detected, the presence of a claim or a request, money, dates and
   * names. The best few, in their original order, become the summary.
   */
  const conceptTerms = concepts.flatMap((c) => c.evidence ?? []);
  const CLAIM_RE =
    /(?:கோரி|கோரியுள்ளார்|வேண்டி|மனு|புகார்|request|seek|pray|kindly|claim|alleg|complain)/i;
  const HEADER_RE =
    /(?:நடுவர்|கோட்டாட்சியர்|தீர்ப்பாயம்|செயல்முறைகள்|பிறப்பிப்பவர்|ப\.மு|magistrate|tribunal|proceedings|office of)/i;

  const scored = ss.map((sentence, index) => {
    let score = 0;
    for (const term of conceptTerms) {
      if (term && sentence.toLowerCase().includes(String(term).toLowerCase())) score += 3;
    }
    if (CLAIM_RE.test(sentence)) score += 4;
    if (AMOUNT_RE.test(sentence)) score += 2;
    AMOUNT_RE.lastIndex = 0;
    if (/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/.test(sentence)) score += 1;
    // The letterhead names the issuing office, not the matter.
    if (HEADER_RE.test(sentence)) score -= 5;
    // Very short fragments are usually OCR debris.
    if (sentence.length < 30) score -= 2;
    return { sentence, index, score };
  });

  const leadSentences = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index)          // restore document order
    .map((x) => x.sentence)
    .join(' ');

  /*
   * The scored selection is preferred over the provider's own summary.
   *
   * The local provider returns the first three sentences, which is exactly the
   * letterhead problem above; a live model's summary is better and is used when
   * one is configured. So: a real model's text first, then the scored
   * selection, then the opening lines as a last resort.
   */
  const summaryText = (
    (isLiveProvider() ? summaryOut.text : '')
    || leadSentences
    || summaryOut.text
    || ss.slice(0, 3).join(' ')
    || corpus
  ).trim().slice(0, 800);

  const requestSentence = ss.find((s) =>
    /request|seek|pray|kindly|help|assist|action|redress/i.test(s)
    || /கோருகிறேன்|வேண்டுகிறேன்|உதவி|நடவடிக்கை|கோரிக்கை/.test(s));

  const conceptList = concepts.slice(0, 6).map((c) => ({
    id: c.id,
    label: CONCEPT_LABELS[c.id] ?? { en: c.id, ta: c.id },
    evidence: c.evidence,
  }));

  // Sub-issues: the concepts beyond the principal one.
  const subIssues: Bilingual[] = concepts.slice(1, 5).map((c) => {
    const l = CONCEPT_LABELS[c.id] ?? { en: c.id, ta: c.id };
    return bi(l.en, l.ta);
  });

  // ---------------- facts ----------------
  const facts: Bilingual[] = [];
  if (dates.length) facts.push(bi(`Dates mentioned: ${dates.join(', ')}`, `குறிப்பிடப்பட்ட தேதிகள்: ${dates.join(', ')}`));
  if (amounts.length) facts.push(bi(`Amounts mentioned: ${amounts.join(', ')}`, `குறிப்பிடப்பட்ட தொகை: ${amounts.join(', ')}`));
  if (people.length) facts.push(bi(`People named: ${people.join(', ')}`, `குறிப்பிடப்பட்ட நபர்கள்: ${people.join(', ')}`));
  if (places.length) facts.push(bi(`Places mentioned: ${places.slice(0, 4).join(', ')}`, `குறிப்பிடப்பட்ட இடங்கள்: ${places.slice(0, 4).join(', ')}`));
  if (docsMentioned.length) {
    facts.push(bi(
      `Documents referred to: ${docsMentioned.map(docNameEn).join(', ')}`,
      `குறிப்பிடப்பட்ட ஆவணங்கள்: ${docsMentioned.join(', ')}`,
    ));
  }
  for (const s of ss.slice(0, 3)) facts.push(echo(s.length > 200 ? `${s.slice(0, 200)}...` : s));
  if (docs.length) {
    facts.push(bi(
      `${docs.length} document(s) submitted: ${docs.map((d) => d.title).join(', ')}`,
      `${docs.length} ஆவணம் சமர்ப்பிக்கப்பட்டது: ${docs.map((d) => d.title).join(', ')}`,
    ));
  }

  // ---------------- reasons ----------------
  const actReason: Bilingual = actQualifies
    ? bi(
        `Matched on ${topAct.sim.sharedConcepts.map((c) => CONCEPT_LABELS[c]?.en ?? c).join(', ')}. ` +
        (topAct.row.applies_when ? `The knowledge base records this as applying when: ${topAct.row.applies_when}. ` : '') +
        (section ? `Section ${section.section_no}${section.heading ? ` (${section.heading})` : ''} appears relevant. ` : '') +
        (contested
          ? `This was a close call - ${contenders.slice(1).map((c) => c.row.short_name).join('; ')} scored similarly and may be more apt. `
          : '') +
        `This is a suggested match from the configured knowledge base, not a legal opinion. ${VERIFY_EN}`,
        `பொருந்தும் காரணம்: ${topAct.sim.sharedConcepts.map((c) => CONCEPT_LABELS[c]?.ta ?? c).join(', ')}. ` +
        (section ? `பிரிவு ${section.section_no} தொடர்புடையதாக தெரிகிறது. ` : '') +
        (contested
          ? `இது நெருக்கமான தேர்வு - ${contenders.slice(1).map((c) => c.row.short_name).join('; ')} ஆகியவையும் ஏறக்குறைய சமமாக பொருந்துகின்றன. `
          : '') +
        `இது கட்டமைக்கப்பட்ட அறிவுத் தளத்திலிருந்து பரிந்துரைக்கப்பட்ட பொருத்தம் மட்டுமே, சட்ட ஆலோசனை அல்ல. ${VERIFY_TA}`,
      )
    : bi(
        `No Act in the configured knowledge base matched this petition, so none is suggested. ` +
        `An administrator can add the relevant Act in AI Knowledge Configuration. ${VERIFY_EN}`,
        `கட்டமைக்கப்பட்ட அறிவுத் தளத்தில் இந்த மனுவுக்குப் பொருந்தும் சட்டம் எதுவும் காணப்படவில்லை. ` +
        `தொடர்புடைய சட்டத்தை நிர்வாகி சேர்க்கலாம். ${VERIFY_TA}`,
      );

  const deptReason: Bilingual = deptQualifies
    ? bi(
        `Matched on ${topDept.sim.sharedConcepts.map((c) => (
          c.startsWith('administers:') ? `it administers ${c.slice(12).split('|')[0]}`
            : c.startsWith('issuetype:') ? `issue type: ${c.slice(10).split('|')[0]}`
              : (CONCEPT_LABELS[c]?.en ?? c))).join(', ')}. ` +
        (topDept.row.responsibilities ? `Configured responsibilities: ${String(topDept.row.responsibilities).slice(0, 200)}. ` : '') +
        VERIFY_EN,
        `பொருந்தும் காரணம்: ${topDept.sim.sharedConcepts.map((c) => (
          c.startsWith('administers:')
            ? `${c.slice(12).split('|')[1] ?? c.slice(12).split('|')[0]} சட்டத்தை நிர்வகிக்கிறது`
            : c.startsWith('issuetype:')
              ? `பிரச்சினை வகை: ${c.slice(10).split('|')[1] ?? c.slice(10).split('|')[0]}`
              : (CONCEPT_LABELS[c]?.ta ?? c))).join(', ')}. ${VERIFY_TA}`,
      )
    : bi(
        `No department in the configured knowledge base matched this petition. ${VERIFY_EN}`,
        `கட்டமைக்கப்பட்ட அறிவுத் தளத்தில் பொருந்தும் துறை காணப்படவில்லை. ${VERIFY_TA}`,
      );

  /*
   * Names for use inside prose.
   *
   * A Tamil sentence that splices in an English name reads as half-translated:
   * "மனுவை Municipal Administration and Water Supply துறைக்கு அனுப்பவும்".
   * These resolve to the Tamil name where the knowledge base records one and
   * fall back to English where it does not, so a Tamil sentence stays Tamil
   * wherever the data allows.
   */
  const actNameEn = topAct?.row ? (topAct.row.short_name ?? '') : '';
  const actNameTa = topAct?.row ? (topAct.row.short_name_ta || topAct.row.short_name || '') : '';
  const deptNameEn = topDept?.row ? (topDept.row.name ?? '') : '';
  const deptNameTa = topDept?.row ? (topDept.row.name_ta || topDept.row.name || '') : '';
  const authDesigEn = authority ? (authority.designation ?? '') : '';
  const authDesigTa = authority ? (authority.designation_ta || authority.designation || '') : '';
  const authOfficeEn = authority ? (authority.office_name ?? '') : '';
  const authOfficeTa = authority ? (authority.office_name_ta || authority.office_name || '') : '';

  const authReason: Bilingual = authority
    ? bi(
        `${authDesigEn}${authOfficeEn ? `, ${authOfficeEn}` : ''} is the configured authority for ${deptNameEn}` +
        (authority.jurisdiction_level ? ` at ${authority.jurisdiction_level.toLowerCase()} level` : '') + `. ${VERIFY_EN}`,
        `${authDesigTa} என்பவர் ${deptNameTa} துறைக்கான கட்டமைக்கப்பட்ட அதிகாரி ஆவார். ${VERIFY_TA}`,
      )
    : bi(
        `No officer or authority is configured for this matter. ${VERIFY_EN}`,
        `இந்த விவகாரத்திற்கு அலுவலர் யாரும் கட்டமைக்கப்படவில்லை. ${VERIFY_TA}`,
      );

  // ---------------- workflow ----------------
  const workflow: Bilingual[] = [];
  workflow.push(bi('Verify the petitioner particulars and the documents produced.',
    'மனுதாரர் விவரங்களையும் சமர்ப்பிக்கப்பட்ட ஆவணங்களையும் சரிபார்க்கவும்.'));
  if (actQualifies) {
    workflow.push(bi(
      `Confirm that ${actNameEn}${section ? `, section ${section.section_no}` : ''} is the correct provision for this matter.`,
      `${actNameTa}${section ? `, பிரிவு ${section.section_no}` : ''} இந்த விவகாரத்திற்கு சரியான விதி என்பதை உறுதிப்படுத்தவும்.`,
    ));
    if (topAct.row.workflow) {
      workflow.push(bi(
        `Statutory redressal workflow: ${topAct.row.workflow}`,
        `சட்டப்படியான தீர்வு நடைமுறை: ${topAct.row.workflow}`,
      ));
    }
  } else {
    workflow.push(bi(
      'Determine the applicable provision; the knowledge base did not match one.',
      'பொருந்தும் விதியை தீர்மானிக்கவும்; அறிவுத் தளத்தில் பொருத்தம் காணப்படவில்லை.',
    ));
  }
  if (deptQualifies) {
    workflow.push(bi(
      `Forward the petition to ${deptNameEn}${authority ? `, for the attention of the ${authDesigEn}` : ''}, with a request for examination and report.`,
      `மனுவை ${deptNameTa}${authority ? ` (${authDesigTa} அவர்களின் கவனத்திற்கு)` : ''} துறைக்கு பரிசீலனை மற்றும் அறிக்கைக்காக அனுப்பவும்.`,
    ));
  }
  workflow.push(bi('Acknowledge receipt to the petitioner with the reference number.',
    'மனு எண்ணுடன் மனுதாரருக்கு ஒப்புகை வழங்கவும்.'));
  if (escalation) {
    workflow.push(bi(
      `If not resolved within the prescribed period, escalate to the ${escalation.designation}.`,
      `குறிப்பிட்ட காலத்திற்குள் தீர்வு கிடைக்கவில்லை எனில், ${escalation.designation} அவர்களிடம் மேல்முறையீடு செய்யவும்.`,
    ));
  }

  // ---------------- required documents ----------------
  const requiredDocs: Bilingual[] = [];
  if (actQualifies && topAct.row.required_documents) {
    /*
     * An Act's required-documents list is stored as free text. Where a Tamil
     * list has been recorded alongside it, the two are paired item by item;
     * otherwise each item is translated from the common-terms table below.
     *
     * Items with no known Tamil form are shown in English rather than
     * machine-translated, because these are the names of actual documents a
     * citizen must produce - an invented Tamil name would send them looking
     * for a document that does not exist under that name.
     */
    const split = (v: unknown) =>
      String(v ?? '').split(/[,.]/).map((x) => x.trim()).filter(Boolean);

    const en = split(topAct.row.required_documents);
    const ta = split(topAct.row.required_documents_ta);

    en.forEach((d, i) => {
      const tamil = ta[i] || REQUIRED_DOC_TA[d.toLowerCase()] || d;
      requiredDocs.push(bi(d, tamil));
    });
  }
  requiredDocs.push(bi('Proof of identity of the petitioner.', 'மனுதாரரின் அடையாளச் சான்று.'));
  if (concepts.some((c) => ['land_record', 'encroachment', 'property_sale', 'land_acquisition'].includes(c.id))) {
    requiredDocs.push(bi('Property particulars - patta, chitta or survey number.',
      'சொத்து விவரங்கள் - பட்டா, சிட்டா அல்லது சர்வே எண்.'));
  }
  if (concepts.some((c) => c.id === 'pension' || c.id === 'senior_citizen')) {
    requiredDocs.push(bi('Proof of age and any earlier application or communication.',
      'வயது சான்று மற்றும் முந்தைய விண்ணப்பம் அல்லது கடிதம்.'));
  }
  if (concepts.some((c) => c.id === 'police' || c.id === 'crime')) {
    requiredDocs.push(bi('Copy of any complaint already given to the police.',
      'காவல்துறையில் ஏற்கனவே அளிக்கப்பட்ட புகாரின் நகல்.'));
  }

  // ---------------- missing information ----------------
  const missing: Bilingual[] = [];
  if (!docs.length) missing.push(bi('No supporting document has been uploaded.', 'ஆதரவு ஆவணம் எதுவும் பதிவேற்றப்படவில்லை.'));
  for (const d of docs) {
    if (!d.extracted_text || !String(d.extracted_text).trim()) {
      missing.push(bi(
        `No text could be read from "${d.title}" - the officer should read it directly.`,
        `"${d.title}" ஆவணத்திலிருந்து உரை படிக்க முடியவில்லை - அலுவலர் நேரடியாக பார்க்கவும்.`,
      ));
    }
  }
  if (!dates.length) missing.push(bi('No specific date is stated in the petition.', 'மனுவில் குறிப்பிட்ட தேதி எதுவும் கூறப்படவில்லை.'));
  if (!p.citizen_phone) missing.push(bi('Petitioner contact number is not recorded.', 'மனுதாரரின் தொலைபேசி எண் பதிவு செய்யப்படவில்லை.'));
  if (!p.citizen_address) missing.push(bi('Petitioner address is not recorded.', 'மனுதாரரின் முகவரி பதிவு செய்யப்படவில்லை.'));
  if (!actQualifies) missing.push(bi('No configured Act matched; the knowledge base may need the relevant Act added.', 'பொருந்தும் சட்டம் காணப்படவில்லை; அறிவுத் தளத்தில் சேர்க்க வேண்டியிருக்கலாம்.'));
  if (!deptQualifies) missing.push(bi('No configured department matched this petition.', 'பொருந்தும் துறை காணப்படவில்லை.'));
  if (corpus.length < 100) missing.push(bi('The petition is very brief; further particulars may be required.', 'மனு மிகச் சுருக்கமாக உள்ளது; கூடுதல் விவரங்கள் தேவைப்படலாம்.'));

  // ---------------- reasoning flow ----------------
  /*
   * The stage names, in both languages.
   *
   * Held here rather than in the console's phrase book because they name the
   * analyser's OWN stages: the pipeline and its labels change together.
   */
  const STEP_TA: Record<string, string> = {
    Petition: 'மனு',
    Issue: 'பிரச்சினை',
    Act: 'சட்டம்',
    Section: 'பிரிவு',
    Department: 'துறை',
    Authority: 'அதிகாரி',
    Jurisdiction: 'அதிகார வரம்பு',
    Action: 'நடவடிக்கை',
  };
  const stepLabel = (step: string): Bilingual => bi(step, STEP_TA[step] ?? step);
  const rawFlow: { step: string; value: Bilingual }[] = [
    { step: 'Petition', value: echo(headline) },
    {
      step: 'Issue',
      value: concepts.length
        ? bi(CONCEPT_LABELS[concepts[0].id]?.en ?? concepts[0].id,
             CONCEPT_LABELS[concepts[0].id]?.ta ?? concepts[0].id)
        : bi('Not determined', 'தீர்மானிக்கப்படவில்லை'),
    },
    {
      step: 'Act',
      value: actQualifies
        ? bi(actNameEn, actNameTa)
        : bi(`No match — ${VERIFY_EN}`, `பொருத்தம் இல்லை — ${VERIFY_TA}`),
    },
    {
      step: 'Section',
      value: section
        /*
         * "Section" is an English word and the heading has a Tamil form in the
         * knowledge base, so echoing the English into both fields put
         * "Section 4 — Maintenance of parents" into an otherwise Tamil flow.
         * The number stays as digits in both.
         */
        ? bi(
          `Section ${section.section_no}${section.heading ? ` — ${section.heading}` : ''}`,
          `பிரிவு ${section.section_no}${section.heading_ta || section.heading
            ? ` — ${section.heading_ta || section.heading}` : ''}`,
        )
        : bi(`Not identified — ${VERIFY_EN}`, `கண்டறியப்படவில்லை — ${VERIFY_TA}`),
    },
    {
      step: 'Department',
      value: deptQualifies
        ? bi(deptNameEn, deptNameTa)
        : bi(`No match — ${VERIFY_EN}`, `பொருத்தம் இல்லை — ${VERIFY_TA}`),
    },
    {
      step: 'Authority',
      value: authority
        ? bi(`${authDesigEn}${authOfficeEn ? `, ${authOfficeEn}` : ''}`, `${authDesigTa}${authOfficeTa ? `, ${authOfficeTa}` : ''}`)
        : bi(`Not configured — ${VERIFY_EN}`, `கட்டமைக்கப்படவில்லை — ${VERIFY_TA}`),
    },
    {
      step: 'Jurisdiction',
      /*
       * The LEVEL is a closed set and translates; the AREA is free text from
       * the knowledge base and may be recorded only in English
       * ("Corporation limit"), which then appeared inside an otherwise Tamil
       * line. The Tamil view therefore shows the level alone unless a Tamil
       * area is recorded - an officer loses no information, because the
       * authority's office is named in full on the line above.
       */
      value: authority?.jurisdiction_level
        ? bi(
            [authority.jurisdiction_level, authority.jurisdiction_area].filter(Boolean).join(' — '),
            [
              JURISDICTION_TA[authority.jurisdiction_level] ?? authority.jurisdiction_level,
              TAMIL_RE.test(String(authority.jurisdiction_area ?? ''))
                ? authority.jurisdiction_area
                : null,
            ].filter(Boolean).join(' — '),
          )
        : bi('Not determined', 'தீர்மானிக்கப்படவில்லை'),
    },
    {
      step: 'Action',
      value: deptQualifies
        ? bi(`Forward to ${deptNameEn} for examination and report.`,
             `${deptNameTa} துறைக்கு பரிசீலனைக்கு அனுப்பவும்.`)
        : bi('Officer to determine the route.', 'அலுவலர் வழியை தீர்மானிக்க வேண்டும்.'),
    },
  ];

  const reasoningFlow = rawFlow.map((f) => ({ ...f, step_label: stepLabel(f.step) }));

  const nextAction: Bilingual = deptQualifies
    ? bi(
        `Verify the particulars with the petitioner, then forward the petition to ${deptNameEn}` +
        (authority ? ` for the attention of the ${authDesigEn}` : '') +
        `, with a request for examination and report. ${VERIFY_EN}`,
        `மனுதாரரிடம் விவரங்களை சரிபார்த்து, மனுவை ${deptNameTa}` +
        (authority ? ` (${authDesigTa})` : '') +
        ` துறைக்கு பரிசீலனை மற்றும் அறிக்கைக்காக அனுப்பவும். ${VERIFY_TA}`,
      )
    : bi(
        `Officer to determine the concerned department and the applicable process. ${VERIFY_EN}`,
        `சம்பந்தப்பட்ட துறையையும் பொருந்தும் நடைமுறையையும் அலுவலர் தீர்மானிக்க வேண்டும். ${VERIFY_TA}`,
      );

  /*
   * The issue type and the priority both have Tamil forms.
   *
   * The English subject name and the raw enum were being interpolated into the
   * Tamil sentence, producing: கட்டமைக்கப்பட்ட பொருள் "Roads and Infrastructure"
   * … முன்னுரிமை NORMAL. The knowledge base records `name_ta`, and priority is
   * a closed set, so both are rendered in the officer's own language.
   */
  const PRIORITY_TA: Record<string, string> = {
    URGENT: 'அவசரம்',
    HIGH: 'உயர்',
    NORMAL: 'இயல்பு',
    LOW: 'குறைவு',
  };
  const priorityTa = PRIORITY_TA[priority] ?? priority;

  const priorityReason: Bilingual = matchedSubject
    ? bi(
        `Matched the configured subject "${matchedSubject.name}", for which the configured priority is ${priority}.`,
        `கட்டமைக்கப்பட்ட பொருள் "${matchedSubject.name_ta || matchedSubject.name}" உடன் பொருந்தியது; அதற்கான முன்னுரிமை ${priorityTa}.`,
      )
    : bi(
        `No configured subject matched; the default priority applies. ${VERIFY_EN}`,
        `பொருந்தும் பொருள் காணப்படவில்லை; இயல்பு முன்னுரிமை பொருந்தும். ${VERIFY_TA}`,
      );

  // ---------------- confidence ----------------
  const signals = [
    corpus.length > 120, docs.length > 0, concepts.length > 0,
    actQualifies, deptQualifies, !!authority, dates.length > 0, !!requestSentence,
  ];
  const overall = Math.min(0.9, 0.12 + 0.1 * signals.filter(Boolean).length);

  const data: AnalysisResult = {
    summary: tamilSource
      ? bi(summaryText, summaryText)
      : bi(`Petitioner states: ${summaryText}`, `மனுதாரர் கூறுவது: ${summaryText}`),
    main_issue: concepts.length
      ? bi(
          `${CONCEPT_LABELS[concepts[0].id]?.en ?? concepts[0].id} — as stated: ${headline}`,
          `${CONCEPT_LABELS[concepts[0].id]?.ta ?? concepts[0].id} — கூறப்பட்டது: ${headline}`,
        )
      : echo(headline),
    sub_issues: subIssues,
    petitioner_request: requestSentence
      ? echo(requestSentence)
      : bi(
          `The petitioner seeks government intervention in the matter stated. Specific relief to be confirmed with the petitioner. ${VERIFY_EN}`,
          `மனுதாரர் அரசின் தலையீட்டை கோருகிறார். குறிப்பிட்ட நிவாரணத்தை மனுதாரரிடம் உறுதிப்படுத்த வேண்டும். ${VERIFY_TA}`,
        ),
    important_facts: facts,
    detected_concepts: conceptList,
    entities: { people, places, dates, amounts, documents_mentioned: docsMentioned },
    act: actQualifies ? {
      id: topAct.row.id,
      short_name: kbName(topAct.row.short_name, topAct.row.short_name_ta),
      /*
       * Most entries record a Tamil short name but no Tamil full title (the
       * full title is usually a restatement of the short one). Falling back to
       * the Tamil short name keeps the Tamil view in Tamil; falling back to
       * English would put an English line in the middle of it. A Tamil full
       * title is never invented - only a name already recorded is used.
       */
      full_title: kbName(
        topAct.row.full_title,
        topAct.row.full_title_ta || topAct.row.short_name_ta,
      ),
      act_number: topAct.row.act_number,
      year: topAct.row.year,
      jurisdiction_scope: topAct.row.jurisdiction,
      verification_status: topAct.row.verification_status ?? 'UNVERIFIED',
      source_reference: topAct.row.source_reference ?? null,
      section_id: section?.id ?? null,
      section_no: section?.section_no ?? null,
      section_heading: kbName(section?.heading, section?.heading_ta),
      section_text: kbName(section?.text, section?.text_ta),
      reason: actReason,
      confidence: actConfidence,
      alternatives: contenders.slice(1).map((c) => ({
        id: c.row.id,
        short_name: kbName(c.row.short_name, c.row.short_name_ta)!,
        confidence: Math.round((c.sim.score / (topAct.sim.score || 1)) * actConfidence * 100) / 100,
      })),
    } : {
      id: null, short_name: null, full_title: null, act_number: null, year: null,
      jurisdiction_scope: null, verification_status: null, source_reference: null,
      section_id: null, section_no: null, section_heading: null, section_text: null,
      reason: actReason, confidence: 0, alternatives: [],
    },
    department: deptQualifies ? {
      id: topDept.row.id, code: topDept.row.code,
      name: kbName(topDept.row.name, topDept.row.name_ta),
      reason: deptReason, confidence: deptConfidence,
    } : {
      id: null, code: null, name: null, reason: deptReason, confidence: 0,
    },
    authority: authority ? {
      id: authority.id,
      designation: kbName(authority.designation, authority.designation_ta),
      office_name: kbName(authority.office_name, authority.office_name_ta),
      jurisdiction_level: authority.jurisdiction_level,
      jurisdiction_area: authority.jurisdiction_area,
      reason: authReason,
    } : {
      id: null, designation: null, office_name: null,
      jurisdiction_level: null, jurisdiction_area: null, reason: authReason,
    },
    escalation: escalation
      ? {
          designation: kbName(escalation.designation, escalation.designation_ta),
          office_name: kbName(escalation.office_name, escalation.office_name_ta),
        }
      : null,
    next_action: nextAction,
    workflow,
    required_documents: requiredDocs,
    priority,
    priority_reason: priorityReason,
    missing_information: missing,
    reasoning_flow: reasoningFlow,
    overall_confidence: overall,
    requires_verification: true,
  };

  const sources = [
    ...(actQualifies ? [{ type: 'ACT', id: topAct.row.id, label: topAct.row.short_name,
      verification: topAct.row.verification_status ?? 'UNVERIFIED' }] : []),
    ...(section ? [{ type: 'SECTION', id: section.id, label: `Section ${section.section_no}` }] : []),
    ...(deptQualifies ? [{ type: 'DEPARTMENT', id: topDept.row.id, label: topDept.row.name }] : []),
    ...(authority ? [{ type: 'AUTHORITY', id: authority.id, label: authority.designation }] : []),
  ];

  return { data, confidence: overall, sources };
}
