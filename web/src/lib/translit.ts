/**
 * Tamil to Latin transliteration.
 *
 * Renders a Tamil name or place in Latin letters for the English view, using
 * the spellings Tamil Nadu government correspondence actually uses - "Coimbatore",
 * not the strict-ISO "Kōyamputtūr" - because an officer has to recognise the
 * place, and a citizen has to find it on their other documents.
 *
 * WHAT THIS IS AND IS NOT
 *
 * It is a RENDERING AID, not a translation, and the UI labels it as such. The
 * Tamil remains the record: this is what a reader sees when the console is in
 * English, so that a case file is legible to an officer who does not read Tamil.
 *
 * It cannot be authoritative. Tamil has no single accepted Latin spelling, and
 * the form on a citizen's Aadhaar or ration card may differ from anything a
 * rule can derive. That is why the original is always kept and shown, and why
 * the transliteration is never written back into the record.
 *
 * HOW IT WORKS. Tamil is an abugida: a consonant carries an inherent "a" unless
 * a vowel sign replaces it or a pulli (virama) removes it. So the text is walked
 * cluster by cluster - consonant, then any vowel sign or pulli that follows -
 * rather than character by character, which would produce "ka-aa" for "கா".
 */

/** Independent vowels, which stand alone at the start of a word. */
const VOWELS: Record<string, string> = {
  'அ': 'a', 'ஆ': 'aa', 'இ': 'i', 'ஈ': 'ee', 'உ': 'u', 'ஊ': 'oo',
  'எ': 'e', 'ஏ': 'ae', 'ஐ': 'ai', 'ஒ': 'o', 'ஓ': 'oa', 'ஔ': 'au',
};

/** Consonants, given with their inherent vowel stripped. */
const CONSONANTS: Record<string, string> = {
  'க': 'k', 'ங': 'ng', 'ச': 'ch', 'ஞ': 'nj', 'ட': 't', 'ண': 'n',
  'த': 'th', 'ந': 'n', 'ப': 'p', 'ம': 'm', 'ய': 'y', 'ர': 'r',
  'ல': 'l', 'வ': 'v', 'ழ': 'zh', 'ள': 'l', 'ற': 'r', 'ன': 'n',
  // Grantha letters, used for loan words.
  'ஜ': 'j', 'ஷ': 'sh', 'ஸ': 's', 'ஹ': 'h', 'க்ஷ': 'ksh', 'ஸ்ரீ': 'sri',
};

/** Dependent vowel signs, which replace a consonant's inherent vowel. */
const SIGNS: Record<string, string> = {
  'ா': 'a', 'ி': 'i', 'ீ': 'ee', 'ு': 'u', 'ூ': 'oo',
  'ெ': 'e', 'ே': 'e', 'ை': 'ai', 'ொ': 'o', 'ோ': 'o', 'ௌ': 'au',
};

const PULLI = '்';          // virama: removes the inherent vowel
const AYTHAM = 'ஃ';

/**
 * Place and word spellings in common official use.
 *
 * Checked before the rules, because these are the forms that appear on
 * government correspondence and on citizens' documents. A rule-derived
 * "Koayamputhoor" would be technically defensible and practically useless.
 */
const KNOWN: Record<string, string> = {
  'கோயம்புத்தூர்': 'Coimbatore',
  'சென்னை': 'Chennai',
  'மதுரை': 'Madurai',
  'திருச்சி': 'Trichy',
  'திருச்சிராப்பள்ளி': 'Tiruchirappalli',
  'சேலம்': 'Salem',
  'ஈரோடு': 'Erode',
  'திருப்பூர்': 'Tiruppur',
  'வேலூர்': 'Vellore',
  'தஞ்சாவூர்': 'Thanjavur',
  'திருநெல்வேலி': 'Tirunelveli',
  'கன்னியாகுமரி': 'Kanyakumari',
  'நாகர்கோவில்': 'Nagercoil',
  'தூத்துக்குடி': 'Thoothukudi',
  'கடலூர்': 'Cuddalore',
  'விழுப்புரம்': 'Villupuram',
  'தர்மபுரி': 'Dharmapuri',
  'கிருஷ்ணகிரி': 'Krishnagiri',
  'நாமக்கல்': 'Namakkal',
  'கரூர்': 'Karur',
  'திண்டுக்கல்': 'Dindigul',
  'சிவகங்கை': 'Sivagangai',
  'ராமநாதபுரம்': 'Ramanathapuram',
  'புதுக்கோட்டை': 'Pudukkottai',
  'அரியலூர்': 'Ariyalur',
  'பெரம்பலூர்': 'Perambalur',
  'நீலகிரி': 'Nilgiris',
  'காஞ்சிபுரம்': 'Kanchipuram',
  'திருவள்ளூர்': 'Tiruvallur',
  'திருவண்ணாமலை': 'Tiruvannamalai',
  'பீளமேடு': 'Peelamedu',
  'தெரு': 'Street',
  'சாலை': 'Road',
  'நகர்': 'Nagar',
  'மாவட்டம்': 'District',
  'வட்டம்': 'Taluk',
  'கிராமம்': 'Village',
  'நெ': 'No',
  'காந்தி': 'Gandhi',
  'நேரு': 'Nehru',
  'அண்ணா': 'Anna',
  'காமராஜர்': 'Kamarajar',
  'குப்புசாமி': 'Kuppusami',
  'சாமி': 'Sami',
  'ராமசாமி': 'Ramasami',
  'கிருஷ்ணன்': 'Krishnan',
  'சுப்ரமணியன்': 'Subramanian',
  'முருகன்': 'Murugan',
  'லட்சுமி': 'Lakshmi',
  'பாளையம்': 'Palayam',
  'புரம்': 'puram',
  'பட்டி': 'patti',
  'கோட்டை': 'kottai',
  'திருமதி': 'Tmt',
  'திரு': 'Thiru',
  'செல்வி': 'Selvi',
  'எண்': 'No',
};

/** Transliterate one Tamil word. */
function word(w: string): string {
  const exact = KNOWN[w];
  if (exact) return exact;

  const chars = [...w];
  let out = '';

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];

    if (VOWELS[c]) { out += VOWELS[c]; continue; }
    if (c === AYTHAM) { out += 'h'; continue; }

    const cons = CONSONANTS[c];
    if (!cons) {
      // Not Tamil (a digit, punctuation, Latin): pass it through untouched.
      out += c;
      continue;
    }

    const next = chars[i + 1];

    if (next === PULLI) {
      // Pulli removes the inherent vowel: a bare consonant.
      out += cons;
      i++;
    } else if (next && SIGNS[next]) {
      out += cons + SIGNS[next];
      i++;
    } else {
      // No sign: the inherent "a" sounds.
      out += `${cons}a`;
    }
  }

  // Tidy the doubled vowels a naive pass produces ("aa" inside a word is fine,
  // but "aaa" is not), and capitalise as a name or place would be written.
  const cleaned = out.replace(/([aeiou])\1{2,}/g, '$1$1');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const TAMIL = /[஀-௿]/;
const LATIN = /[a-zA-Z]/;

/** True when the text contains any Tamil script. */
export function hasTamil(s: unknown): boolean {
  return TAMIL.test(String(s ?? ''));
}

/** True when the text contains any Latin letters. */
export function hasLatin(s: unknown): boolean {
  return LATIN.test(String(s ?? ''));
}

/**
 * Transliterate Tamil within a string, leaving everything else alone.
 *
 * Numbers, Latin words and punctuation pass through unchanged, so
 * "வழுக்குப்பாறை, நெ. 1108" keeps its number and its comma.
 */
export function transliterate(input: unknown): string {
  const s = String(input ?? '');
  if (!TAMIL.test(s)) return s;

  return s
    .split(/(\s+)/)                       // keep the spacing
    .map((token) => {
      if (!TAMIL.test(token)) return token;
      // Split off leading/trailing punctuation so KNOWN lookups still match.
      const m = token.match(/^([^஀-௿]*)([\s\S]*?)([^஀-௿]*)$/);
      if (!m) return word(token);
      const [, before, core, after] = m;
      return before + (core ? word(core) : '') + after;
    })
    .join('');
}

/**
 * English to Tamil dictionary for common official terms, names, and places.
 */
const KNOWN_EN_TO_TA: Record<string, string> = {
  // Official & petition placeholders
  'test petitioner': 'தேர்வு மனுதாரர்',
  'test': 'தேர்வு',
  'petitioner': 'மனுதாரர்',
  'citizen': 'குடிமகன்',
  'applicant': 'விண்ணப்பதாரர்',
  'resident': 'குடியிருப்பாளர்',
  'complainant': 'புகார்தாரர்',
  'unknown': 'தெரியாதவர்',
  'na': '—',
  'n/a': '—',

  // Titles
  'tmt': 'திருமதி',
  'thiru': 'திரு',
  'selvi': 'செல்வி',
  'mr': 'திரு',
  'mrs': 'திருமதி',
  'ms': 'செல்வி',
  'no': 'எண்',

  // Places & addresses
  'street': 'தெரு',
  'road': 'சாலை',
  'nagar': 'நகர்',
  'district': 'மாவட்டம்',
  'taluk': 'வட்டம்',
  'village': 'கிராமம்',
  'palayam': 'பாளையம்',
  'puram': 'புரம்',
  'patti': 'பட்டி',
  'kottai': 'கோட்டை',
  'chennai': 'சென்னை',
  'coimbatore': 'கோயம்புத்தூர்',
  'madurai': 'மதுரை',
  'trichy': 'திருச்சி',
  'tiruchirappalli': 'திருச்சிராப்பள்ளி',
  'salem': 'சேலம்',
  'erode': 'ஈரோடு',
  'tiruppur': 'திருப்பூர்',
  'vellore': 'வேலூர்',
  'thanjavur': 'தஞ்சாவூர்',
  'tirunelveli': 'திருநெல்வேலி',
  'kanyakumari': 'கன்னியாகுமரி',
  'nagercoil': 'நாகர்கோவில்',
  'thoothukudi': 'தூத்துக்குடி',
  'cuddalore': 'கடலூர்',
  'villupuram': 'விழுப்புரம்',
  'dharmapuri': 'தர்மபுரி',
  'krishnagiri': 'கிருஷ்ணகிரி',
  'namakkal': 'நாமக்கல்',
  'karur': 'கரூர்',
  'dindigul': 'திண்டுக்கல்',
  'sivagangai': 'சிவகங்கை',
  'ramanathapuram': 'ராமநாதபுரம்',
  'pudukkottai': 'புதுக்கோட்டை',
  'ariyalur': 'அரியலூர்',
  'perambalur': 'பெரம்பலூர்',
  'nilgiris': 'நீலகிரி',
  'kanchipuram': 'காஞ்சிபுரம்',
  'tiruvallur': 'திருவள்ளூர்',
  'tiruvannamalai': 'திருவண்ணாமலை',
  'peelamedu': 'பீளமேடு',

  // Common Tamil names
  'gandhi': 'காந்தி',
  'nehru': 'நேரு',
  'anna': 'அண்ணா',
  'kamarajar': 'காமராஜர்',
  'kuppusami': 'குப்புசாமி',
  'kuppusamy': 'குப்புசாமி',
  'sami': 'சாமி',
  'ramasami': 'ராமசாமி',
  'ramasamy': 'ராமசாமி',
  'krishnan': 'கிருஷ்ணன்',
  'subramanian': 'சுப்பிரமணியன்',
  'subramaniam': 'சுப்பிரமணியம்',
  'murugan': 'முருகன்',
  'lakshmi': 'லட்சுமி',
  'ammal': 'அம்மாள்',
  'kumar': 'குமார்',
  'raman': 'ராமன்',
  'priya': 'பிரியா',
  'kavitha': 'கவிதா',
  'raja': 'ராஜா',
  'devi': 'தேவி',
  'suresh': 'சுரேஷ்',
  'ramesh': 'ரமேஷ்',
  'selvan': 'செல்வன்',
  'selvi_name': 'செல்வி',
  'mani': 'மணி',
  'anbu': 'அன்பு',
  'bala': 'பாலா',
  'balasubramanian': 'பாலசுப்பிரமணியன்',
  'arun': 'அருண்',
  'karthik': 'கார்த்திக்',
  'vimal': 'விமல்',
  'dinesh': 'தினேஷ்',
  'prakash': 'பிரகாஷ்',
  'vijay': 'விஜய்',
  'ajith': 'அஜித்',
  'suriya': 'சூர்யா',
  'radha': 'ராதா',
  'shanthi': 'சாந்தி',
  'meena': 'மீனா',
  'vasanthi': 'வசந்தி',
  'chitra': 'சித்ரா',
  'sundaram': 'சுந்தரம்',
  'moorthy': 'மூர்த்தி',
  'ganesan': 'கணேசன்',
  'govind': 'கோவிந்த்',
  'govindan': 'கோவிந்தன்',
  'muthu': 'முத்து',
  'perumal': 'பெருமாள்',
  'saravanan': 'சரவணன்',
  'senthil': 'செந்தில்',
  'velu': 'வேலு',
  'vijayan': 'விஜயன்',
};

// Initial vowels in Tamil
const TA_INIT_VOWEL: Record<string, string> = {
  'aa': 'ஆ', 'ai': 'ஐ', 'au': 'ஔ', 'ee': 'ஈ', 'oo': 'ஊ',
  'a': 'அ', 'i': 'இ', 'u': 'உ', 'e': 'எ', 'o': 'ஒ',
};

// Dependent vowel signs
const TA_VOWEL_SIGN: Record<string, string> = {
  'aa': 'ா', 'ai': 'ை', 'au': 'ௌ', 'ee': 'ீ', 'oo': 'ூ',
  'a': '', 'i': 'ி', 'u': 'ு', 'e': 'ெ', 'o': 'ொ',
};

// Consonant mapping
const TA_CONSONANTS: Record<string, string> = {
  'sh': 'ஷ', 'th': 'த', 'dh': 'த', 'ch': 'ச', 'zh': 'ழ', 'ng': 'ங',
  'nj': 'ஞ', 'ph': 'ப', 'kh': 'க', 'gh': 'க', 'bh': 'ப',
  'k': 'க', 'c': 'க', 'g': 'க', 's': 'ச', 'j': 'ஜ', 't': 'ட',
  'd': 'ட', 'p': 'ப', 'b': 'ப', 'm': 'ம', 'y': 'ய', 'r': 'ர',
  'l': 'ல', 'v': 'வ', 'w': 'வ', 'h': 'ஹ', 'n': 'ன',
};

/** Phonetic transliteration from English Latin letters to Tamil script. */
function latinWordToTamil(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (!lower) return raw;
  if (KNOWN_EN_TO_TA[lower]) return KNOWN_EN_TO_TA[lower];

  let out = '';
  let i = 0;
  let isStart = true;

  while (i < lower.length) {
    // Check 2-letter vowel digraph
    const v2 = lower.slice(i, i + 2);
    if (isStart && TA_INIT_VOWEL[v2]) {
      out += TA_INIT_VOWEL[v2];
      i += 2;
      isStart = false;
      continue;
    }
    // Check 1-letter vowel at start
    const v1 = lower[i];
    if (isStart && TA_INIT_VOWEL[v1]) {
      out += TA_INIT_VOWEL[v1];
      i++;
      isStart = false;
      continue;
    }

    // Check consonant digraphs
    const c2 = lower.slice(i, i + 2);
    let cons = TA_CONSONANTS[c2];
    let consLen = 2;
    if (!cons) {
      cons = TA_CONSONANTS[lower[i]];
      consLen = 1;
    }

    if (cons) {
      i += consLen;
      isStart = false;
      // Special: word-initial 'n' uses 'ந'
      if (cons === 'ன' && out.length === 0) cons = 'ந';

      // Look ahead for vowel following consonant
      const nextV2 = lower.slice(i, i + 2);
      if (TA_VOWEL_SIGN[nextV2] !== undefined) {
        out += cons + TA_VOWEL_SIGN[nextV2];
        i += 2;
      } else if (TA_VOWEL_SIGN[lower[i]] !== undefined) {
        out += cons + TA_VOWEL_SIGN[lower[i]];
        i++;
      } else {
        // No vowel follows: bare consonant with virama (pulli)
        out += cons + PULLI;
      }
    } else {
      // Punctuation, digits or unrecognised character: pass through
      out += lower[i];
      i++;
      isStart = false;
    }
  }

  return out;
}

/**
 * Transliterate/translate English text into Tamil.
 *
 * Checks dictionary for known names and official terms (like "Test Petitioner" -> "தேர்வு மனுதாரர்"),
 * then uses phonetic syllabic transliteration for other words.
 */
export function transliterateToTamil(input: unknown): string {
  const s = String(input ?? '').trim();
  if (!s) return '';
  if (hasTamil(s) && !hasLatin(s)) return s;

  // Check whole phrase dictionary match (e.g. "Test Petitioner")
  const phraseKey = s.toLowerCase();
  if (KNOWN_EN_TO_TA[phraseKey]) return KNOWN_EN_TO_TA[phraseKey];

  return s
    .split(/(\s+)/)
    .map((token) => {
      if (!hasLatin(token)) return token;
      const m = token.match(/^([^a-zA-Z]*)([a-zA-Z]+)([^a-zA-Z]*)$/);
      if (!m) return token;
      const [, before, core, after] = m;
      return before + latinWordToTamil(core) + after;
    })
    .join('');
}

/**
 * Cleanly display a citizen's name in the selected console language.
 *
 * When lang is 'ta':
 * - If already in Tamil, returns as-is.
 * - If in English, transliterates/translates to Tamil.
 *
 * When lang is 'en':
 * - If in Tamil, transliterates to Latin English.
 * - If in English, returns as-is.
 */
export function displayName(name: unknown, lang: 'en' | 'ta'): string {
  const s = String(name ?? '').trim();
  if (!s) return '';
  if (lang === 'ta') {
    return hasTamil(s) ? s : transliterateToTamil(s);
  }
  return hasTamil(s) ? transliterate(s) : s;
}

/**
 * Cleanly display an address in the selected console language.
 */
export function displayAddress(address: unknown, lang: 'en' | 'ta'): string {
  const s = String(address ?? '').trim();
  if (!s) return '';
  if (lang === 'ta') {
    return hasTamil(s) ? s : transliterateToTamil(s);
  }
  return hasTamil(s) ? transliterate(s) : s;
}
