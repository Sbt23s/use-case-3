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

/** True when the text contains any Tamil script. */
export function hasTamil(s: unknown): boolean {
  return TAMIL.test(String(s ?? ''));
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
