/**
 * Dual English <-> Tamil transliteration & name/place translation dictionary.
 * Runs 100% in-memory without any external API calls or latency (0ms).
 */

const VOWELS: Record<string, string> = {
  'அ': 'a', 'ஆ': 'aa', 'இ': 'i', 'ஈ': 'ee', 'உ': 'u', 'ஊ': 'oo',
  'எ': 'e', 'ஏ': 'ae', 'ஐ': 'ai', 'ஒ': 'o', 'ஓ': 'oa', 'ஔ': 'au',
};

const CONSONANTS: Record<string, string> = {
  'க': 'k', 'ங': 'ng', 'ச': 'ch', 'ஞ': 'nj', 'ட': 't', 'ண': 'n',
  'த': 'th', 'ந': 'n', 'ப': 'p', 'ம': 'm', 'ய': 'y', 'ர': 'r',
  'ல': 'l', 'வ': 'v', 'ழ': 'zh', 'ள': 'l', 'ற': 'r', 'ன': 'n',
  'ஜ': 'j', 'ஷ': 'sh', 'ஸ': 's', 'ஹ': 'h', 'க்ஷ': 'ksh', 'ஸ்ரீ': 'sri',
};

const SIGNS: Record<string, string> = {
  'ா': 'a', 'ி': 'i', 'ீ': 'ee', 'ு': 'u', 'ூ': 'oo',
  'ெ': 'e', 'ே': 'e', 'ை': 'ai', 'ொ': 'o', 'ோ': 'o', 'ௌ': 'au',
};

const PULLI = '்';
const AYTHAM = 'ஃ';

const KNOWN_TA_TO_EN: Record<string, string> = {
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
  'ஹரீஷ்': 'Hareesh',
  'ஹரிஷ்': 'Harish',
  'ஹரீஸ்': 'Hareesh',

  // Localities, areas and towns
  'காந்திபுரம்': 'Gandhipuram',
  'சித்தாப்புதூர்': 'Siddhapudur',
  'சித்தாபுதூர்': 'Siddhapudur',
  'சத்தாப்பூர்': 'Siddhapudur',
  'இத்தாப்பூர்': 'Siddhapudur',
  'சிங்காநல்லூர்': 'Singanallur',
  'சரவணம்பட்டி': 'Saravanampatti',
  'துடியலூர்': 'Thudiyalur',
  'கவுண்டம்பாளையம்': 'Koundampalayam',
  'வடவள்ளி': 'Vadavalli',
  'குனியமுத்தூர்': 'Kuniyamuthur',
  'போத்தனூர்': 'Podanur',
  'உக்கடம்': 'Ukkadam',
  'சாய்பாபா காலனி': 'Saibaba Colony',
  'அன்னூர்': 'Annur',
  'மேட்டுப்பாளையம்': 'Mettupalayam',
  'பொள்ளாச்சி': 'Pollachi',
  'சூலூர்': 'Sulur',
  'கிணத்துக்கடவு': 'Kinathukadavu',
  'வால்பாறை': 'Valparai',
  'கோவை': 'Coimbatore',
  'கோயமுத்தூர்': 'Coimbatore',
  'வேளச்சேரி': 'Velachery',
  'தாம்பரம்': 'Tambaram',
  'அடையாறு': 'Adyar',
  'மயிலாப்பூர்': 'Mylapore',
  'கிண்டி': 'Guindy',
  'கோயம்பேடு': 'Koyambedu',
  'ஆவடி': 'Avadi',
  'அம்பத்தூர்': 'Ambattur',
  'சோழிங்கநல்லூர்': 'Sholinganallur',
  'ஆலந்தூர்': 'Alandur',
  'பல்லாவரம்': 'Pallavaram',
  'குரோம்பேட்டை': 'Chromepet',
  'போரூர்': 'Porur',
  'திருவான்மியூர்': 'Thiruvanmiyur',
  'எழும்பூர்': 'Egmore',
  'ராயப்பேட்டை': 'Royapettah',
  'புரசைவாக்கம்': 'Purasawalkam',
  'திருவல்லிக்கேணி': 'Triplicane',
  'மாம்பலம்': 'Mambalam',
  'சைதாப்பேட்டை': 'Saidapet',
  'கோடம்பாக்கம்': 'Kodambakkam',
  'வடபழனி': 'Vadapalani',
  'அசோக் நகர்': 'Ashok Nagar',
  'நுங்கம்பாக்கம்': 'Nungambakkam',
  'வில்லிவாக்கம்': 'Villivakkam',
  'கொளத்தூர்': 'Kolathur',
  'மாதவரம்': 'Madhavaram',
  'திருவொற்றியூர்': 'Tiruvottiyur',
  'செங்கல்பட்டு': 'Chengalpattu',
  'வீதி': 'Street',
  'சந்து': 'Lane',
  'குறுக்கு': 'Cross',
  'முதன்மை': 'Main',
};

export const KNOWN_EN_TO_TA: Record<string, string> = {
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

  // Government Departments & Official Terminology
  'rural development & panchayat raj': 'ஊரக வளர்ச்சி மற்றும் ஊராட்சித் துறை',
  'rural development and panchayat raj': 'ஊரக வளர்ச்சி மற்றும் ஊராட்சித் துறை',
  'rural development & panchayat raj department': 'ஊரக வளர்ச்சி மற்றும் ஊராட்சித் துறை',
  'rural development and panchayat raj department': 'ஊரக வளர்ச்சி மற்றும் ஊராட்சித் துறை',
  'rural development': 'ஊரக வளர்ச்சி',
  'panchayat raj': 'ஊராட்சித் துறை',
  'panchayat': 'ஊராட்சி',
  'village panchayat': 'கிராம ஊராட்சி',
  'town panchayat': 'பேரூராட்சி',
  'revenue & disaster management': 'வருவாய் மற்றும் பேரிடர் மேலாண்மைத் துறை',
  'revenue and disaster management': 'வருவாய் மற்றும் பேரிடர் மேலாண்மைத் துறை',
  'municipal administration & water supply': 'நகராட்சி நிர்வாகம் மற்றும் குடிநீர் வழங்கல் துறை',
  'municipal administration and water supply': 'நகராட்சி நிர்வாகம் மற்றும் குடிநீர் வழங்கல் துறை',
  'social welfare and women empowerment': 'சமூக நலம் மற்றும் மகளிர் உரிமைத் துறை',
  'social welfare & women empowerment': 'சமூக நலம் மற்றும் மகளிர் உரிமைத் துறை',
  'housing and urban development': 'வீட்டுவசதி மற்றும் நகர்ப்புற வளர்ச்சித் துறை',
  'housing & urban development': 'வீட்டுவசதி மற்றும் நகர்ப்புற வளர்ச்சித் துறை',
  'highways and minor ports': 'நெடுஞ்சாலைகள் மற்றும் சிறு துறைமுகங்கள் துறை',
  'highways & minor ports': 'நெடுஞ்சாலைகள் மற்றும் சிறு துறைமுகங்கள் துறை',
  'school education': 'பள்ளிக் கல்வித் துறை',
  'higher education': 'உயர் கல்வித் துறை',
  'health and family welfare': 'மக்கள் நல்வாழ்வு மற்றும் குடும்ப நலத்துறை',
  'health & family welfare': 'மக்கள் நல்வாழ்வு மற்றும் குடும்ப நலத்துறை',
  'agriculture and farmers welfare': 'வேளாண்மை மற்றும் உழவர் நலத்துறை',
  'agriculture & farmers welfare': 'வேளாண்மை மற்றும் உழவர் நலத்துறை',
  'commercial taxes and registration': 'வணிக வரிகள் மற்றும் பதிவுத் துறை',
  'commercial taxes & registration': 'வணிக வரிகள் மற்றும் பதிவுத் துறை',
  'public works': 'பொதுப்பணித் துறை',
  'public works department': 'பொதுப்பணித் துறை',
  'home, prohibition and excise': 'உள்துறை, மதுவிலக்கு மற்றும் ஆயத்தீர்வைத் துறை',

  // Legal & Section Terms
  'sec': 'பிரிவு',
  'sec.': 'பிரிவு',
  'section': 'பிரிவு',
  'sections': 'பிரிவுகள்',
  'encroachment on public roads': 'பொதுச் சாலைகளில் ஆக்கிரமிப்பு',
  'powers of inspection': 'ஆய்வு அதிகாரம்',
  'drinking water supply': 'குடிநீர் விநியோகம்',
  'panchayat audit and dissolution': 'ஊராட்சி தணிக்கை மற்றும் கலைப்பு',
  'claim for maintenance': 'பராமரிப்பு கோரிக்கை',
  'tribunal order': 'தீர்ப்பாய உத்தரவு',
  'maintenance': 'பராமரிப்பு',
  'protection': 'பாதுகாப்பு',
  'welfare': 'நலன்',

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
  'tiruvannamalai': 'திருவண்ணாமலை',
  'peelamedu': 'பீளமேடு',
  'gandhipuram': 'காந்திபுரம்',
  'siddhapudur': 'சித்தாப்புதூர்',
  'siddhaputhur': 'சித்தாப்புதூர்',
  'sidhapudur': 'சித்தாப்புதூர்',
  'chaththappoor': 'சித்தாப்புதூர்',
  'kanthipuram': 'காந்திபுரம்',
  'saibaba colony': 'சாய்பாபா காலனி',
  'singanallur': 'சிங்காநல்லூர்',
  'saravanampatti': 'சரவணம்பட்டி',
  'thudiyalur': 'துடியலூர்',
  'koundampalayam': 'கவுண்டம்பாளையம்',
  'vadavalli': 'வடவள்ளி',
  'kuniyamuthur': 'குனியமுத்தூர்',
  'podanur': 'போத்தனூர்',
  'ukkadam': 'உக்கடம்',
  'annur': 'அன்னூர்',
  'mettupalayam': 'மேட்டுப்பாளையம்',
  'pollachi': 'பொள்ளாச்சி',
  'sulur': 'சூலூர்',
  'kinathukadavu': 'கிணத்துக்கடவு',
  'valparai': 'வால்பாறை',
  'kovai': 'கோயம்புத்தூர்',
  'velachery': 'வேளச்சேரி',
  'tambaram': 'தாம்பரம்',
  'adyar': 'அடையாறு',
  'mylapore': 'மயிலாப்பூர்',
  'guindy': 'கிண்டி',
  'koyambedu': 'கோயம்பேடு',
  'avadi': 'ஆவடி',
  'ambattur': 'அம்பத்தூர்',
  'sholinganallur': 'சோழிங்கநல்லூர்',
  'alandur': 'ஆலந்தூர்',
  'pallavaram': 'பல்லாவரம்',
  'chromepet': 'குரோம்பேட்டை',
  'porur': 'போரூர்',
  'thiruvanmiyur': 'திருவான்மியூர்',
  'egmore': 'எழும்பூர்',
  'royapettah': 'ராயப்பேட்டை',
  'purasawalkam': 'புரசைவாக்கம்',
  'triplicane': 'திருவல்லிக்கேணி',
  'mambalam': 'மாம்பலம்',
  'saidapet': 'சைதாப்பேட்டை',
  'kodambakkam': 'கோடம்பாக்கம்',
  'vadapalani': 'வடபழனி',
  'ashok nagar': 'அசோக் நகர்',
  'nungambakkam': 'நுங்கம்பாக்கம்',
  'villivakkam': 'வில்லிவாக்கம்',
  'kolathur': 'கொளத்தூர்',
  'madhavaram': 'மாதவரம்',
  'tiruvottiyur': 'திருவொற்றியூர்',
  'chengalpattu': 'செங்கல்பட்டு',

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
  'a. kavitha': 'ஏ. கவிதா',
  'a.kavitha': 'ஏ. கவிதா',
  'a. kavitha, grievance officer': 'ஏ. கவிதா',
  'a.': 'ஏ.',
  's.': 'எஸ்.',
  'm.': 'எம்.',
  'k.': 'கே.',
  'r.': 'ஆர்.',
  'v.': 'வி.',
  'p.': 'பி.',
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

const TA_INIT_VOWEL: Record<string, string> = {
  'aa': 'ஆ', 'ai': 'ஐ', 'au': 'ஔ', 'ee': 'ஈ', 'oo': 'ஊ',
  'a': 'அ', 'i': 'இ', 'u': 'உ', 'e': 'எ', 'o': 'ஒ',
};

const TA_VOWEL_SIGN: Record<string, string> = {
  'aa': 'ா', 'ai': 'ை', 'au': 'ௌ', 'ee': 'ீ', 'oo': 'ூ',
  'a': '', 'i': 'ி', 'u': 'ு', 'e': 'ெ', 'o': 'ொ',
};

const TA_CONSONANTS: Record<string, string> = {
  'sh': 'ஷ', 'th': 'த', 'dh': 'த', 'ch': 'ச', 'zh': 'ழ', 'ng': 'ங',
  'nj': 'ஞ', 'ph': 'ப', 'kh': 'க', 'gh': 'க', 'bh': 'ப',
  'k': 'க', 'c': 'க', 'g': 'க', 's': 'ச', 'j': 'ஜ', 't': 'ட',
  'd': 'ட', 'p': 'ப', 'b': 'ப', 'm': 'ம', 'y': 'ய', 'r': 'ர',
  'l': 'ல', 'v': 'வ', 'w': 'வ', 'h': 'ஹ', 'n': 'ன',
};

const TAMIL_REGEX = /[஀-௿]/;
const LATIN_REGEX = /[a-zA-Z]/;

export function hasTamil(s: unknown): boolean {
  return TAMIL_REGEX.test(String(s ?? ''));
}

export function hasLatin(s: unknown): boolean {
  return LATIN_REGEX.test(String(s ?? ''));
}

function latinWordToTamil(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (!lower) return raw;
  if (KNOWN_EN_TO_TA[lower]) return KNOWN_EN_TO_TA[lower];

  let out = '';
  let i = 0;
  let isStart = true;

  while (i < lower.length) {
    const v2 = lower.slice(i, i + 2);
    if (isStart && TA_INIT_VOWEL[v2]) {
      out += TA_INIT_VOWEL[v2];
      i += 2;
      isStart = false;
      continue;
    }
    const v1 = lower[i];
    if (isStart && TA_INIT_VOWEL[v1]) {
      out += TA_INIT_VOWEL[v1];
      i++;
      isStart = false;
      continue;
    }

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
      if (cons === 'ன' && out.length === 0) cons = 'ந';

      const nextV2 = lower.slice(i, i + 2);
      if (TA_VOWEL_SIGN[nextV2] !== undefined) {
        out += cons + TA_VOWEL_SIGN[nextV2];
        i += 2;
      } else if (TA_VOWEL_SIGN[lower[i]] !== undefined) {
        out += cons + TA_VOWEL_SIGN[lower[i]];
        i++;
      } else {
        out += cons + PULLI;
      }
    } else {
      out += lower[i];
      i++;
      isStart = false;
    }
  }

  return out;
}

export function transliterateToTamil(input: unknown): string {
  const s = String(input ?? '').trim();
  if (!s) return '';
  if (hasTamil(s) && !hasLatin(s)) return s;

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

function wordToLatin(w: string): string {
  const exact = KNOWN_TA_TO_EN[w];
  if (exact) return exact;

  const chars = [...w];
  let out = '';

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (VOWELS[c]) { out += VOWELS[c]; continue; }
    if (c === AYTHAM) { out += 'h'; continue; }

    const cons = CONSONANTS[c];
    if (!cons) { out += c; continue; }

    const next = chars[i + 1];
    if (next === PULLI) {
      out += cons;
      i++;
    } else if (next && SIGNS[next]) {
      out += cons + SIGNS[next];
      i++;
    } else {
      out += `${cons}a`;
    }
  }

  const cleaned = out.replace(/([aeiou])\1{2,}/g, '$1$1');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function transliterateToLatin(input: unknown): string {
  const s = String(input ?? '');
  if (!TAMIL_REGEX.test(s)) return s;

  return s
    .split(/(\s+)/)
    .map((token) => {
      if (!TAMIL_REGEX.test(token)) return token;
      const m = token.match(/^([^஀-௿]*)([\s\S]*?)([^஀-௿]*)$/);
      if (!m) return wordToLatin(token);
      const [, before, core, after] = m;
      return before + (core ? wordToLatin(core) : '') + after;
    })
    .join('');
}

export function cleanNameString(s: string): string {
  let cleaned = String(s || '').trim()
    .replace(/^\s*(?:திருமதி|திரு|செல்வி|செல்வன்)\s*\.?\s*/, '')
    .replace(/^\s*(?:Thiru|Tmt|Selvi|Mr|Mrs|Ms|Dr)\s*\.?\s*/i, '');
  if (/என்\s*பெயர்/i.test(cleaned)) {
    const parts = cleaned.split(/[.。,，;:]|\bஎன்\s*பெயர்\b/i).map((p) => p.trim()).filter(Boolean);
    const valid = parts
      .map((p) => p.replace(/^என்\s*பெயர்\s*[:：]?\s*/i, '').trim())
      .filter((p) => p.length >= 2);
    if (valid.length > 0) cleaned = valid[0];
  }
  if (/my\s*name\s*is/i.test(cleaned)) {
    const parts = cleaned.split(/[.。,，;:]|\bmy\s*name\s*is\b/i).map((p) => p.trim()).filter(Boolean);
    const valid = parts
      .map((p) => p.replace(/^my\s*name\s*is\s*[:：]?\s*/i, '').trim())
      .filter((p) => p.length >= 2);
    if (valid.length > 0) cleaned = valid[0];
  }
  return cleaned.trim();
}

export function displayName(name: unknown, lang: 'en' | 'ta'): string {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  const s = cleanNameString(raw);
  if (!s) return '';
  if (lang === 'ta') {
    return hasTamil(s) ? s : transliterateToTamil(s);
  }
  return hasTamil(s) ? transliterateToLatin(s) : s;
}

export function displayAddress(address: unknown, lang: 'en' | 'ta'): string {
  const s = String(address ?? '').trim();
  if (!s) return '';
  if (lang === 'ta') {
    let ta = hasTamil(s) ? s : transliterateToTamil(s);
    ta = ta.replace(/சத்தாப்பூர்/g, 'சித்தாப்புதூர்')
           .replace(/இத்தாப்பூர்/g, 'சித்தாப்புதூர்')
           .replace(/சித்தாபுதூர்/g, 'சித்தாப்புதூர்');
    return ta;
  }
  let en = hasTamil(s) ? transliterateToLatin(s) : s;
  en = en.replace(/\bChaththappoor\b|\bChiththapputhoor\b|\bIththappoor\b|\bSathappur\b|\bSathapur\b/gi, 'Siddhapudur')
         .replace(/\bKanthipuram\b/gi, 'Gandhipuram');
  return en;
}
