/**
 * Semantic matching for petitions.
 *
 * Replaces exact keyword lookup with meaning-based scoring, so a petition is
 * matched on what it is ABOUT rather than on which words it happens to use.
 *
 * Why this exists: a Tamil petition about patta transfer previously matched
 * nothing, because every configured cue was in English. Adding Tamil synonyms
 * alone would not have been enough either - a citizen writing "நிலம் பறித்து
 * விட்டார்கள்" is describing encroachment without using the configured word
 * for it.
 *
 * Three signals are combined:
 *   1. concept detection  - bilingual concept vocabularies, so Tamil and
 *                           English expressions of the same idea both resolve
 *                           to the same concept
 *   2. lexical overlap    - the configured cues, still useful where they hit
 *   3. character n-grams  - catches Tamil morphological variants that exact
 *                           matching misses (Tamil is agglutinative, so the
 *                           same root appears with many different suffixes)
 *
 * It does NOT invent knowledge. Scoring only ever ranks records that already
 * exist in the knowledge base; a concept with no matching record yields no
 * match, and the caller reports that honestly.
 */

const TAMIL_RE = /[஀-௿]/;

const STOP_EN = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'are', 'was', 'were',
  'not', 'but', 'its', 'into', 'upon', 'when', 'than', 'then', 'also', 'said', 'per', 'who',
  'will', 'can', 'any', 'all', 'may', 'been', 'their', 'they', 'which', 'she', 'her', 'his',
  'him', 'our', 'you', 'your', 'about', 'there', 'would', 'could', 'should', 'please', 'sir',
  'madam', 'respected', 'kindly', 'therefore', 'hence', 'thus',
]);

const STOP_TA = new Set([
  'அவர்கள்', 'இந்த', 'அந்த', 'என்று', 'ஆகிய', 'உள்ள', 'என்ற', 'மற்றும்', 'ஆனால்',
  'இருந்து', 'வேண்டும்', 'செய்ய', 'உள்ளது', 'இல்லை', 'அதன்', 'அவர்', 'நான்', 'எனது',
  'நாங்கள்', 'எங்கள்', 'தாங்கள்', 'வணக்கம்', 'ஐயா', 'அம்மா',
]);

export function tokenise(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9஀-௿\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => {
      if (!w) return false;
      if (TAMIL_RE.test(w)) return w.length >= 2 && !STOP_TA.has(w);
      return w.length > 2 && !STOP_EN.has(w);
    });
}

/**
 * Character n-grams for a Tamil word.
 *
 * Tamil is agglutinative: "பட்டா", "பட்டாவை", "பட்டாவிற்கு" are the same root
 * with different case endings. Exact matching treats them as unrelated words,
 * so shared n-grams recover the relationship without needing a full stemmer.
 */
function ngrams(word: string, n = 3): string[] {
  if (word.length <= n) return [word];
  const out: string[] = [];
  for (let i = 0; i <= word.length - n; i++) out.push(word.slice(i, i + n));
  return out;
}

/**
 * Concept vocabulary.
 *
 * Each concept lists the Tamil and English expressions a citizen might
 * actually use. Matching a concept is far more robust than matching a single
 * configured keyword, because people describe the same problem many ways.
 *
 * These are LINGUISTIC cues only - they carry no legal meaning. A concept
 * merely helps rank the configured records; it never supplies an Act, section
 * or authority of its own.
 */
export interface Concept {
  id: string;
  /** Terms in either language that indicate this concept. */
  terms: string[];
  /** Weight - some concepts are far more decisive than others. */
  weight: number;
}

export const CONCEPTS: Concept[] = [
  // ---- land and property ----
  { id: 'land_record', weight: 3, terms: [
    'patta', 'chitta', 'adangal', 'survey number', 'land record', 'revenue record',
    'subdivision', 'mutation', 'name change', 'land document', 'title deed',
    'பட்டா', 'சிட்டா', 'அடங்கல்', 'சர்வே', 'புல எண்', 'நில பதிவேடு', 'வருவாய் பதிவேடு',
    'உட்பிரிவு', 'பெயர் மாற்றம்', 'நில ஆவணம்', 'பட்டா மாற்றம்',
  ] },
  { id: 'encroachment', weight: 3, terms: [
    'encroach', 'encroachment', 'occupied', 'unauthorised occupation', 'land grab',
    'poramboke', 'government land', 'trespass', 'illegally occupied',
    'ஆக்கிரமிப்பு', 'ஆக்கிரமித்து', 'அத்துமீறல்', 'புறம்போக்கு', 'அரசு நிலம்',
    'பறித்து', 'ஆக்கிரமித்தல்', 'அபகரித்து',
  ] },
  { id: 'property_sale', weight: 3, terms: [
    'sale deed', 'sold', 'sale', 'registered document', 'sub registrar', 'registration',
    'encumbrance', 'gift deed', 'settlement deed', 'transfer of property', 'conveyance',
    'கிரய பத்திரம்', 'விற்பனை', 'விற்று', 'விற்றார்', 'பதிவு', 'சார்பதிவாளர்',
    'வில்லங்க', 'தானப் பத்திரம்', 'சொத்து மாற்றம்', 'பத்திரம்',
  ] },
  { id: 'without_consent', weight: 3, terms: [
    'without my knowledge', 'without knowledge', 'without consent', 'without acknowledgement',
    'did not inform', 'unaware', 'not informed', 'forged', 'fraudulently',
    'அறியாமல்', 'சம்மதம் இல்லாமல்', 'தெரியாமல்', 'ஒப்புதல் இல்லாமல்', 'கையெழுத்து இல்லாமல்',
  ] },

  // ---- welfare ----
  { id: 'senior_citizen', weight: 3, terms: [
    'senior citizen', 'elderly', 'aged', 'old age', 'parent', 'grandmother', 'grandfather',
    'unable to maintain', 'destitute', 'abandoned', 'maintenance',
    'முதியோர்', 'மூத்த குடிமகன்', 'வயதான', 'வயதானவர்', 'பெற்றோர்', 'பாட்டி', 'தாத்தா',
    'பராமரிப்பு', 'ஜீவனாம்சம்', 'ஆதரவற்ற', 'கைவிடப்பட்ட',
  ] },
  /*
   * Social-security pension is kept separate from disability pension.
   *
   * A single 'pension' concept matched the Rights of Persons with Disabilities
   * Act for an old-age pension petition, because that Act's cues mention
   * "disability pension". Splitting them keeps each petition with the right
   * subject.
   */
  { id: 'pension', weight: 3, terms: [
    'old age pension', 'widow pension', 'social security pension', 'monthly assistance',
    'pension not received', 'pension application', 'destitute pension',
    'முதியோர் ஓய்வூதியம்', 'விதவை ஓய்வூதியம்', 'மாத உதவி', 'சமூக பாதுகாப்பு ஓய்வூதியம்',
    'ஓய்வூதியம் கிடைக்கவில்லை',
  ] },
  { id: 'pension_generic', weight: 1, terms: [
    'pension', 'ஓய்வூதியம்', 'ஓய்வூதிய',
  ] },
  { id: 'livelihood', weight: 2, terms: [
    'livelihood', 'no income', 'difficulty', 'food', 'medical expenses', 'poverty',
    'unable to survive', 'starving',
    'வாழ்வாதாரம்', 'வருமானம் இல்லை', 'சிரமம்', 'கஷ்டம்', 'உணவு', 'மருத்துவ செலவு',
  ] },
  { id: 'ration', weight: 3, terms: [
    'ration card', 'ration', 'fair price shop', 'pds', 'provisions', 'rice', 'smart card',
    'family card',
    'ரேஷன்', 'ரேஷன் அட்டை', 'நியாய விலை', 'குடும்ப அட்டை', 'அரிசி', 'மளிகை',
  ] },
  { id: 'disability', weight: 3, terms: [
    'disability', 'differently abled', 'disabled', 'handicapped', 'wheelchair', 'blind', 'deaf',
    'மாற்றுத்திறனாளி', 'ஊனமுற்ற', 'மாற்றுத்திறன்', 'சக்கர நாற்காலி', 'பார்வையற்ற',
  ] },

  // ---- civic ----
  /*
   * Water supply and water pollution are deliberately separate concepts.
   *
   * A single "water" concept let the Water (Prevention and Control of
   * Pollution) Act claim a petition about a street with no drinking water -
   * an outage is not a pollution matter, and routing it to the Pollution
   * Control Board would waste the petitioner's time.
   */
  { id: 'water_supply', weight: 3, terms: [
    'drinking water', 'water supply', 'tap', 'no water', 'water connection', 'borewell',
    'overhead tank', 'water shortage', 'no drinking water', 'water not supplied',
    'குடிநீர்', 'தண்ணீர்', 'குழாய்', 'தண்ணீர் இல்லை', 'நீர் விநியோகம்', 'ஆழ்துளை',
    'குடிநீர் வரவில்லை', 'தண்ணீர் வரவில்லை',
  ] },
  { id: 'water_pollution', weight: 3, terms: [
    'water pollution', 'effluent', 'sewage discharge', 'contaminated water', 'polluted water',
    'river pollution', 'industrial discharge', 'chemical in water',
    'நீர் மாசு', 'கழிவுநீர் கலப்பு', 'மாசுபட்ட நீர், தொழிற்சாலை கழிவு',
  ] },
  { id: 'drainage', weight: 3, terms: [
    'drainage', 'sewerage', 'sewage', 'underground drainage', 'gutter', 'waste water',
    'சாக்கடை', 'கழிவுநீர்', 'நிலத்தடி சாக்கடை', 'கழிவு நீர்',
  ] },
  { id: 'garbage', weight: 2, terms: [
    'garbage', 'solid waste', 'rubbish', 'sanitation', 'cleaning', 'dump',
    'குப்பை', 'கழிவு', 'சுகாதாரம்', 'தூய்மை',
  ] },
  { id: 'street_light', weight: 3, terms: [
    'street light', 'streetlight', 'lamp', 'lighting', 'dark street',
    'தெரு விளக்கு', 'விளக்கு', 'இருட்டு',
  ] },
  { id: 'road', weight: 3, terms: [
    'road', 'pothole', 'road repair', 'damaged road', 'bridge', 'footpath', 'highway',
    'சாலை', 'ரோடு', 'குண்டும் குழியும்', 'சாலை பழுது', 'பாலம்', 'நெடுஞ்சாலை',
  ] },
  { id: 'electricity', weight: 3, terms: [
    'electricity', 'power', 'current', 'transformer', 'power cut', 'eb', 'tangedco',
    'meter', 'electricity bill', 'new connection', 'voltage',
    'மின்சாரம்', 'கரண்ட்', 'மின்மாற்றி', 'மின்வெட்டு', 'மின்சார வாரியம்', 'மீட்டர்',
    'மின் கட்டணம்', 'மின் இணைப்பு',
  ] },

  // ---- education ----
  { id: 'school', weight: 3, terms: [
    'school', 'student', 'teacher', 'admission', 'headmaster', 'class', 'mid day meal',
    'பள்ளி', 'மாணவர்', 'ஆசிரியர்', 'சேர்க்கை', 'தலைமையாசிரியர்', 'வகுப்பு', 'சத்துணவு',
  ] },
  { id: 'school_fee', weight: 3, terms: [
    'school fee', 'excess fee', 'fee collection', 'donation', 'capitation',
    'பள்ளிக் கட்டணம்', 'அதிக கட்டணம்', 'நன்கொடை', 'கட்டணம்',
  ] },
  { id: 'college', weight: 2, terms: [
    'college', 'university', 'degree', 'ragging', 'hostel',
    'கல்லூரி', 'பல்கலைக்கழகம்', 'பட்டம்', 'விடுதி',
  ] },

  // ---- safety and law ----
  /*
   * "complaint" and "புகார்" are deliberately NOT terms here.
   *
   * Every petition is a complaint, so those words fired the police concept on
   * water-supply and pension matters alike, which then asked the citizen for a
   * "copy of any complaint already given to the police". The terms below name a
   * police matter specifically rather than the act of complaining.
   */
  { id: 'police', weight: 3, terms: [
    'police', 'fir', 'police station', 'investigation', 'not registering',
    'law and order', 'police complaint', 'first information report',
    'காவல்துறை', 'போலீஸ்', 'காவல் நிலையம்', 'எஃப்ஐஆர்', 'வழக்கு',
    'காவல் நிலைய புகார்',
  ] },
  { id: 'crime', weight: 3, terms: [
    'theft', 'cheating', 'fraud', 'assault', 'threat', 'forgery', 'robbery', 'attacked',
    'திருட்டு', 'ஏமாற்று', 'மோசடி', 'தாக்குதல்', 'மிரட்டல்', 'அடிதடி', 'கொள்ளை',
  ] },
  { id: 'moneylending', weight: 3, terms: [
    'moneylender', 'exorbitant interest', 'usury', 'private loan', 'meter interest',
    'blank cheque', 'loan harassment',
    'கந்து வட்டி', 'அதிக வட்டி', 'தனியார் கடன்', 'வட்டி', 'மீட்டர் வட்டி', 'வெற்று காசோலை',
  ] },
  { id: 'women_safety', weight: 3, terms: [
    'domestic violence', 'harassment', 'dowry', 'cruelty', 'wife', 'husband beat',
    'eve teasing', 'women safety',
    'குடும்ப வன்முறை', 'துன்புறுத்தல்', 'வரதட்சணை', 'கொடுமை', 'மனைவி', 'பெண் பாதுகாப்பு',
  ] },
  { id: 'child', weight: 3, terms: [
    'child', 'minor', 'child labour', 'orphan', 'child protection', 'children home',
    'குழந்தை', 'சிறுவர்', 'குழந்தை தொழிலாளர்', 'அனாதை', 'சிறார்',
  ] },

  // ---- employment ----
  { id: 'wages', weight: 3, terms: [
    'wages', 'salary', 'not paid', 'wage arrears', 'minimum wage', 'underpaid',
    'சம்பளம்', 'ஊதியம்', 'கூலி', 'சம்பள பாக்கி', 'கிடைக்கவில்லை',
  ] },
  { id: 'employment_scheme', weight: 3, terms: [
    'mgnrega', 'nrega', 'job card', 'hundred days work', 'rural employment', 'work demand',
    'நூறு நாள் வேலை', 'வேலை அட்டை', 'ஊரக வேலைவாய்ப்பு',
  ] },

  // ---- other ----
  { id: 'agriculture', weight: 3, terms: [
    'crop', 'farmer', 'agriculture', 'seed', 'fertiliser', 'irrigation', 'paddy',
    'crop loss', 'crop insurance',
    'விவசாயம்', 'விவசாயி', 'பயிர்', 'விதை', 'உரம', 'பாசனம்', 'நெல்', 'பயிர் சேதம்',
  ] },
  { id: 'health', weight: 3, terms: [
    'hospital', 'doctor', 'treatment', 'medicine', 'patient', 'ambulance', 'phc',
    'medical negligence',
    'மருத்துவமனை', 'டாக்டர்', 'சிகிச்சை', 'மருந்து', 'நோயாளி', 'ஆம்புலன்ஸ்',
  ] },
  { id: 'waterbody', weight: 3, terms: [
    'tank', 'lake', 'pond', 'canal', 'waterbody', 'eri', 'kulam', 'channel',
    'ஏரி', 'குளம்', 'கண்மாய்', 'நீர்நிலை', 'கால்வாய்', 'நீர் நிலை',
  ] },
  { id: 'rent_tenancy', weight: 3, terms: [
    'rent', 'landlord', 'tenant', 'eviction', 'rental agreement', 'advance amount', 'vacate',
    'வாடகை', 'வீட்டு உரிமையாளர்', 'குடியிருப்பாளர்', 'வெளியேற்றம்', 'முன்பணம்',
  ] },
  { id: 'rti', weight: 3, terms: [
    'right to information', 'rti', 'information request', 'pio', 'information denied',
    'தகவல் அறியும் உரிமை', 'தகவல் கோரிக்கை', 'தகவல் மறுப்பு',
  ] },
  { id: 'panchayat', weight: 2, terms: [
    'panchayat', 'village panchayat', 'gram sabha', 'panchayat president',
    'ஊராட்சி', 'கிராம ஊராட்சி', 'கிராம சபை', 'பஞ்சாயத்து',
  ] },
  { id: 'municipality', weight: 2, terms: [
    'municipality', 'corporation', 'municipal', 'ward', 'councillor', 'town panchayat',
    'நகராட்சி', 'மாநகராட்சி', 'வார்டு',
  ] },
  { id: 'temple', weight: 3, terms: [
    'temple', 'hr ce', 'endowment', 'trustee', 'temple land',
    'கோயில்', 'அறநிலையத்துறை', 'அறக்கட்டளை', 'கோயில் நிலம்',
  ] },
  { id: 'transport', weight: 3, terms: [
    'driving licence', 'vehicle', 'rto', 'permit', 'registration certificate', 'bus',
    'accident',
    'ஓட்டுநர் உரிமம்', 'வாகனம்', 'ஆர்டிஓ', 'பேருந்து', 'விபத்து',
  ] },
  { id: 'pollution', weight: 3, terms: [
    'pollution', 'effluent', 'smoke', 'noise', 'contamination', 'industrial waste',
    'மாசு', 'கழிவு', 'புகை', 'சத்தம்', 'மாசுபாடு',
  ] },
  { id: 'building', weight: 2, terms: [
    'building approval', 'planning permission', 'unauthorised construction', 'layout',
    'deviation', 'setback',
    'கட்டிட அனுமதி', 'கட்டுமானம்', 'அனுமதியற்ற கட்டிடம்',
  ] },
  { id: 'housing', weight: 2, terms: [
    'house', 'housing', 'slum', 'tenement', 'shelter', 'homeless',
    'வீடு', 'வீட்டுவசதி', 'குடிசை', 'குடியிருப்பு',
  ] },
  { id: 'land_acquisition', weight: 3, terms: [
    'land acquisition', 'compensation', 'acquired land', 'rehabilitation', 'award',
    'நில கையகப்படுத்தல்', 'இழப்பீடு', 'நஷ்டஈடு', 'மறுவாழ்வு',
  ] },
  { id: 'caste_atrocity', weight: 3, terms: [
    'atrocity', 'scheduled caste', 'scheduled tribe', 'caste discrimination', 'untouchability',
    'ஆதிதிராவிடர்', 'தீண்டாமை', 'சாதி பாகுபாடு', 'பழங்குடி',
  ] },
  { id: 'certificate', weight: 2, terms: [
    'certificate', 'community certificate', 'income certificate', 'nativity', 'legal heir',
    'சான்றிதழ்', 'சாதி சான்றிதழ்', 'வருமான சான்றிதழ்', 'வாரிசு சான்று',
  ] },
];

/** Concepts detected in a piece of text, with how strongly each fired. */
export interface DetectedConcept {
  id: string;
  score: number;
  /** The specific expressions that triggered it - shown to the officer. */
  evidence: string[];
}

/**
 * Does `term` appear in `text` as a whole word (or whole phrase)?
 *
 * Plain substring matching produced real misroutes: "damaged" contains "aged",
 * which fired the senior-citizen concept for a petition about a broken
 * transformer. Latin terms are therefore matched on word boundaries.
 *
 * Tamil has no spaces between a root and its suffixes, so a Tamil term is
 * still matched as a substring - that is what makes "ஓய்வூதியத்திற்கு" match
 * "ஓய்வூதியம்" - but it must start at a word boundary to avoid matching
 * mid-word by accident.
 */
const TAMIL_TERM = /[஀-௿]/;

function containsTerm(text: string, term: string): boolean {
  const t = term.toLowerCase();
  if (!t) return false;

  if (TAMIL_TERM.test(t)) {
    const idx = text.indexOf(t);
    if (idx < 0) return false;

    /*
     * TAMIL IS AGGLUTINATIVE, so a word-start rule is wrong for it.
     *
     * A petition about street lights writes "தெருவிளக்குகள்" as one word, and
     * requiring "விளக்கு" to begin a word meant that petition matched NO
     * concept at all: it was filed to Revenue instead of Municipal
     * Administration, with no Act. The same happens throughout the language -
     * "காவல்துறை" contains "காவல்", "மின்சாரம்" contains "மின்".
     *
     * So a sufficiently long Tamil term counts wherever it appears. Four
     * characters is the floor: shorter runs are common syllables that would
     * match almost anything, and those keep the stricter word-start rule.
     */
    if (t.length >= 4) return true;
    return idx === 0 || /\s/.test(text[idx - 1]);
  }

  // Latin: whole word or whole phrase only.
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i').test(text);
}

export function detectConcepts(text: string): DetectedConcept[] {
  const lower = String(text || '').toLowerCase();
  const found: DetectedConcept[] = [];

  for (const c of CONCEPTS) {
    const evidence: string[] = [];
    for (const term of c.terms) {
      if (containsTerm(lower, term)) evidence.push(term);
    }
    if (evidence.length) {
      // More distinct expressions of the same concept is stronger evidence
      // than one word repeated.
      found.push({
        id: c.id,
        score: c.weight * (1 + Math.log2(evidence.length)),
        evidence: evidence.slice(0, 5),
      });
    }
  }
  return found.sort((a, b) => b.score - a.score);
}

/**
 * Similarity between the petition and one knowledge record.
 *
 * Combines concept agreement, lexical overlap and n-gram overlap. Returns both
 * a score and the evidence, because an officer needs to see WHY something
 * matched, not just that it did.
 */
export interface Similarity {
  score: number;
  sharedConcepts: string[];
  sharedTerms: string[];
}

export function similarity(
  petitionText: string,
  petitionConcepts: DetectedConcept[],
  recordText: string,
): Similarity {
  const recordConcepts = detectConcepts(recordText);
  const recordConceptIds = new Set(recordConcepts.map((c) => c.id));

  // ---- 1. concept agreement (the strongest signal) ----
  const sharedConcepts: string[] = [];
  let conceptScore = 0;
  for (const pc of petitionConcepts) {
    if (recordConceptIds.has(pc.id)) {
      sharedConcepts.push(pc.id);
      conceptScore += pc.score * 4;
    }
  }

  // ---- 2. lexical overlap ----
  const pTokens = new Set(tokenise(petitionText));
  const rTokens = tokenise(recordText);
  const sharedTerms: string[] = [];
  let lexScore = 0;
  for (const t of new Set(rTokens)) {
    if (pTokens.has(t)) {
      sharedTerms.push(t);
      // A longer shared term is more discriminating than a short one.
      lexScore += TAMIL_RE.test(t) ? 2.5 : Math.min(t.length / 4, 2);
    }
  }

  // ---- 3. n-gram overlap, mainly for Tamil morphology ----
  let ngramScore = 0;
  const pGrams = new Set<string>();
  for (const t of pTokens) if (TAMIL_RE.test(t)) for (const g of ngrams(t)) pGrams.add(g);
  if (pGrams.size) {
    const rGrams = new Set<string>();
    for (const t of rTokens) if (TAMIL_RE.test(t)) for (const g of ngrams(t)) rGrams.add(g);
    let hits = 0;
    for (const g of rGrams) if (pGrams.has(g)) hits++;
    // Normalised so a long record does not win merely by being long.
    ngramScore = rGrams.size ? (hits / Math.sqrt(rGrams.size)) * 2 : 0;
  }

  /*
   * A record that shares a concept but no actual vocabulary is a weak match.
   *
   * The social security pension entry once outscored the electricity entry for
   * a petition about a broken transformer: it shared a concept through an
   * incidental cue while sharing no words at all, whereas the electricity entry
   * shared both "electricity" and "transformer". Requiring some lexical
   * agreement before concept score counts fully keeps that from recurring.
   */
  const grounded = sharedTerms.length > 0 || ngramScore > 0;
  const effectiveConcept = grounded ? conceptScore : conceptScore * 0.4;

  return {
    score: effectiveConcept + lexScore + ngramScore,
    sharedConcepts,
    sharedTerms: sharedTerms.slice(0, 8),
  };
}

/** Human-readable concept labels, in both languages, for the officer's view. */
export const CONCEPT_LABELS: Record<string, { en: string; ta: string }> = {
  land_record: { en: 'Land records / patta', ta: 'நில பதிவேடு / பட்டா' },
  encroachment: { en: 'Encroachment', ta: 'ஆக்கிரமிப்பு' },
  property_sale: { en: 'Property sale / registration', ta: 'சொத்து விற்பனை / பதிவு' },
  without_consent: { en: 'Acted without consent', ta: 'சம்மதம் இல்லாமல் செயல்' },
  senior_citizen: { en: 'Senior citizen', ta: 'மூத்த குடிமகன்' },
  pension: { en: 'Pension', ta: 'ஓய்வூதியம்' },
  livelihood: { en: 'Livelihood difficulty', ta: 'வாழ்வாதார சிரமம்' },
  ration: { en: 'Ration / food supply', ta: 'ரேஷன் / உணவு விநியோகம்' },
  disability: { en: 'Disability', ta: 'மாற்றுத்திறன்' },
  water_supply: { en: 'Water supply', ta: 'குடிநீர் விநியோகம்' },
  drainage: { en: 'Drainage / sewerage', ta: 'சாக்கடை' },
  garbage: { en: 'Garbage / sanitation', ta: 'குப்பை / சுகாதாரம்' },
  street_light: { en: 'Street lighting', ta: 'தெரு விளக்கு' },
  road: { en: 'Roads', ta: 'சாலை' },
  electricity: { en: 'Electricity', ta: 'மின்சாரம்' },
  school: { en: 'School', ta: 'பள்ளி' },
  school_fee: { en: 'School fees', ta: 'பள்ளிக் கட்டணம்' },
  college: { en: 'College / higher education', ta: 'கல்லூரி' },
  police: { en: 'Police / complaint', ta: 'காவல்துறை / புகார்' },
  crime: { en: 'Alleged offence', ta: 'குற்றச்செயல்' },
  moneylending: { en: 'Money lending / interest', ta: 'கந்து வட்டி' },
  women_safety: { en: 'Women safety', ta: 'பெண்கள் பாதுகாப்பு' },
  child: { en: 'Child welfare', ta: 'குழந்தை நலன்' },
  wages: { en: 'Wages', ta: 'ஊதியம்' },
  employment_scheme: { en: 'Employment scheme', ta: 'வேலைவாய்ப்பு திட்டம்' },
  agriculture: { en: 'Agriculture', ta: 'விவசாயம்' },
  health: { en: 'Health / medical', ta: 'மருத்துவம்' },
  waterbody: { en: 'Waterbody / tank', ta: 'நீர்நிலை / ஏரி' },
  rent_tenancy: { en: 'Rent / tenancy', ta: 'வாடகை' },
  rti: { en: 'Right to information', ta: 'தகவல் அறியும் உரிமை' },
  panchayat: { en: 'Panchayat', ta: 'ஊராட்சி' },
  municipality: { en: 'Municipality', ta: 'நகராட்சி' },
  temple: { en: 'Temple / endowment', ta: 'கோயில் / அறநிலையம்' },
  transport: { en: 'Transport / vehicle', ta: 'போக்குவரத்து' },
  pollution: { en: 'Pollution', ta: 'மாசுபாடு' },
  building: { en: 'Building / planning', ta: 'கட்டிடம் / திட்டமிடல்' },
  housing: { en: 'Housing', ta: 'வீட்டுவசதி' },
  land_acquisition: { en: 'Land acquisition', ta: 'நில கையகப்படுத்தல்' },
  caste_atrocity: { en: 'Caste-related', ta: 'சாதி தொடர்பான' },
  certificate: { en: 'Certificate', ta: 'சான்றிதழ்' },
};
