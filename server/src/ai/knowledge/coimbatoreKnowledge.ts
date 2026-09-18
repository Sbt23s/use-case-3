/**
 * Dedicated Coimbatore Real-Time Knowledge Base for E-Gov Copilot.
 *
 * Covers:
 * - Coimbatore District Administration & Collectorate Hierarchy
 * - 11 Revenue Taluks & Tahsildar Offices
 * - Coimbatore City Municipal Corporation (CCMC) - 5 Zones, 100 Wards
 * - Law Enforcement: Coimbatore City Police Commissionerate & Coimbatore District Police (Rural)
 * - Healthcare & Government Hospitals (CMCH, ESI Hospital)
 * - Transport & Connectivity (Airport, Railways, Bus Terminals, TNSTC)
 * - Economy, Industry & Business ("Manchester of South India", pumps, wet grinders, textiles, IT)
 * - Education & Universities (TNAU, Bharathiar, GCT, CMC)
 * - Tourism, Culture, Geography & Landmarks (Marudhamalai, Perur, Siruvani, Isha/Adiyogi, ATR)
 * - Public Services, Grievance Days & Emergency Contacts
 */

export interface CoimbatoreOfficial {
  titleEn: string;
  titleTa: string;
  departmentEn: string;
  departmentTa: string;
  officeLocationEn: string;
  officeLocationTa: string;
  contactNumber?: string;
  emergencyHelpline?: string;
  officialPortal: string;
  notesEn: string;
  notesTa: string;
}

export const COIMBATORE_ADMIN_CORE = {
  districtNameEn: 'Coimbatore',
  districtNameTa: 'கோயம்புத்தூர் (கோவை)',
  collectorateAddressEn: 'District Collectorate, State Bank Road, Gopalapuram, Coimbatore - 641018',
  collectorateAddressTa: 'மாவட்ட ஆட்சியர் அலுவலகம், ஸ்டேட் பாங்க் ரோடு, கோபாலபுரம், கோயம்புத்தூர் - 641018',
  collectoratePhone: '0422-2301114 / 0422-2301111',
  disasterControlRoom: '1077 / 0422-2301114',
  officialPortal: 'coimbatore.nic.in',
  cmHelpline: '1100',
  policeControlRoom: '100 / 0422-2300970',
  ambulance: '108',
  fireService: '101',
  womenHelpline: '1091 / 181',
  childline: '1098',
  cyberCrime: '1930',
  ccmcHelpline: '0422-2302323 / WhatsApp: 8190000200',
};

export const COIMBATORE_TALUKS = [
  {
    nameEn: 'Coimbatore North',
    nameTa: 'கோயம்புத்தூர் வடக்கு',
    officeEn: 'Tahsildar Office, Balasundaram Road, Coimbatore - 641018',
    officeTa: 'வட்டாட்சியர் அலுவலகம், பாலசுந்தரம் சாலை, கோயம்புத்தூர் - 641018',
    divisionEn: 'Coimbatore North Revenue Division',
    divisionTa: 'கோவை வடக்கு வருவாய் கோட்டம்',
  },
  {
    nameEn: 'Coimbatore South',
    nameTa: 'கோயம்புத்தூர் தெற்கு',
    officeEn: 'Tahsildar Office, Huzur Road, Coimbatore - 641018',
    officeTa: 'வட்டாட்சியர் அலுவலகம், ஹுசூர் ரோடு, கோயம்புத்தூர் - 641018',
    divisionEn: 'Coimbatore South Revenue Division',
    divisionTa: 'கோவை தெற்கு வருவாய் கோட்டம்',
  },
  {
    nameEn: 'Perur',
    nameTa: 'பேரூர்',
    officeEn: 'Tahsildar Office, Siruvani Main Road, Perur, Coimbatore - 641010',
    officeTa: 'வட்டாட்சியர் அலுவலகம், சிறுவாணி மெயின் ரோடு, பேரூர், கோயம்புத்தூர் - 641010',
    divisionEn: 'Coimbatore South Revenue Division',
    divisionTa: 'கோவை தெற்கு வருவாய் கோட்டம்',
  },
  {
    nameEn: 'Madukkarai',
    nameTa: 'மதுக்கரை',
    officeEn: 'Tahsildar Office, Palakkad Main Road, Madukkarai, Coimbatore - 641105',
    officeTa: 'வட்டாட்சியர் அலுவலகம், பாலக்காடு மெயின் ரோடு, மதுக்கரை, கோயம்புத்தூர் - 641105',
    divisionEn: 'Coimbatore South Revenue Division',
    divisionTa: 'கோவை தெற்கு வருவாய் கோட்டம்',
  },
  {
    nameEn: 'Sulur',
    nameTa: 'சூலூர்',
    officeEn: 'Tahsildar Office, Trichy Road, Sulur, Coimbatore - 641402',
    officeTa: 'வட்டாட்சியர் அலுவலகம், திருச்சி ரோடு, சூலூர், கோயம்புத்தூர் - 641402',
    divisionEn: 'Coimbatore South Revenue Division',
    divisionTa: 'கோவை தெற்கு வருவாய் கோட்டம்',
  },
  {
    nameEn: 'Mettupalayam',
    nameTa: 'மேட்டுப்பாளையம்',
    officeEn: 'Tahsildar Office, Annur Road, Mettupalayam, Coimbatore - 641301',
    officeTa: 'வட்டாட்சியர் அலுவலகம், அன்னூர் ரோடு, மேட்டுப்பாளையம், கோயம்புத்தூர் - 641301',
    divisionEn: 'Coimbatore North Revenue Division',
    divisionTa: 'கோவை வடக்கு வருவாய் கோட்டம்',
  },
  {
    nameEn: 'Annur',
    nameTa: 'அன்னூர்',
    officeEn: 'Tahsildar Office, Avinashi Road, Annur, Coimbatore - 641653',
    officeTa: 'வட்டாட்சியர் அலுவலகம், அவிநாசி ரோடு, அன்னூர், கோயம்புத்தூர் - 641653',
    divisionEn: 'Coimbatore North Revenue Division',
    divisionTa: 'கோவை வடக்கு வருவாய் கோட்டம்',
  },
  {
    nameEn: 'Pollachi',
    nameTa: 'பொள்ளாச்சி',
    officeEn: 'Tahsildar Office, Sub-Collector Office Road, Pollachi - 642001',
    officeTa: 'வட்டாட்சியர் அலுவலகம், சார் ஆட்சியர் அலுவலக சாலை, பொள்ளாச்சி - 642001',
    divisionEn: 'Pollachi Revenue Division (Sub-Collector / RDO)',
    divisionTa: 'பொள்ளாச்சி வருவாய் கோட்டம் (சார் ஆட்சியர் / ஆர்.டி.ஓ)',
  },
  {
    nameEn: 'Kinathukadavu',
    nameTa: 'கிணத்துக்கடவு',
    officeEn: 'Tahsildar Office, Pollachi Main Road, Kinathukadavu - 642109',
    officeTa: 'வட்டாட்சியர் அலுவலகம், பொள்ளாச்சி மெயின் ரோடு, கிணத்துக்கடவு - 642109',
    divisionEn: 'Pollachi Revenue Division',
    divisionTa: 'பொள்ளாச்சி வருவாய் கோட்டம்',
  },
  {
    nameEn: 'Anaimalai',
    nameTa: 'ஆனைமலை',
    officeEn: 'Tahsildar Office, Vettaikaranpudur Road, Anaimalai - 642104',
    officeTa: 'வட்டாட்சியர் அலுவலகம், வேட்டைக்காரன்புதூர் ரோடு, ஆனைமலை - 642104',
    divisionEn: 'Pollachi Revenue Division',
    divisionTa: 'பொள்ளாச்சி வருவாய் கோட்டம்',
  },
  {
    nameEn: 'Valparai',
    nameTa: 'வால்பாறை',
    officeEn: 'Tahsildar Office, Main Road, Valparai - 642127',
    officeTa: 'வட்டாட்சியர் அலுவலகம், மெயின் ரோடு, வால்பாறை - 642127',
    divisionEn: 'Pollachi Revenue Division',
    divisionTa: 'பொள்ளாச்சி வருவாய் கோட்டம்',
  },
];

export const CCMC_ZONES = [
  { nameEn: 'East Zone (கிழக்கு மண்டலம்)', wards: 'Wards 50-57, 62-66', officeEn: 'Singanallur Trichy Road' },
  { nameEn: 'West Zone (மேற்கு மண்டலம்)', wards: 'Wards 16-24, 33-37, 71-75', officeEn: 'RS Puram DB Road' },
  { nameEn: 'North Zone (வடக்கு மண்டலம்)', wards: 'Wards 1-15, 25-32', officeEn: 'Balasundaram Road / Ganapathy' },
  { nameEn: 'South Zone (தெற்கு மண்டலம்)', wards: 'Wards 76-100', officeEn: 'Kuniyamuthur / Sundarapuram' },
  { nameEn: 'Central Zone (மத்திய மண்டலம்)', wards: 'Wards 38-49, 58-61, 67-70', officeEn: 'Town Hall Main Office' },
];

/**
 * Detect if a query is related to Coimbatore district, its administration,
 * officials, local public services, geography, or city topics.
 */
export function isCoimbatoreQuery(q: string): boolean {
  const lower = q.toLowerCase();

  // Direct Coimbatore tokens
  if (/\b(coimbatore|cbe|kovai|coimbatorean|coimbatoreans|ccmc)\b/i.test(lower)
      || /(கோயம்புத்தூர்|கோயமுத்தூர்|கோவை|மாநகராட்சி)/.test(q)) {
    return true;
  }

  // Revenue Taluks and municipal towns in Coimbatore district
  if (/\b(pollachi|mettupalayam|valparai|sulur|annur|kinathukadavu|madukkarai|anaimalai|perur|thondamuthur|karamadai|sirumugai|gudalur\s*cbe|somanur|kangeyampalayam|sultanpet)\b/i.test(lower)
      || /(பொள்ளாச்சி|மேட்டுப்பாளையம்|வால்பாறை|சூலூர்|அன்னூர்|கிணத்துக்கடவு|மதுக்கரை|ஆனைமலை|பேரூர்|தொண்டாமுத்தூர்|காரமடை)/.test(q)) {
    return true;
  }

  // Key city neighborhoods & landmarks
  if (/\b(gandhipuram|rs\s*puram|r\.s\.\s*puram|ukkadam|singanallur|peelamedu|thudiyalur|saravanampatti|saibaba\s*colony|town\s*hall|ramanathapuram\s*cbe|kuniyamuthur|sundarapuram|vilankurichi|vadavalli|ganapathy|race\s*course|podanur|kurichi|marudhamalai|siruvani|noyyal|eachanari|kovai\s*kutralam|dhyanalinga|isha\s*yoga|topslip|parambikulam|monkey\s*falls|valparai\s*hills|codissia|tidel\s*park\s*cbe|tidel\s*park\s*coimbatore)\b/i.test(lower)
      || /(மருதமலை|சிறுவாணி|நொய்யல்|ஈச்சனாரி|பேரூர்\s*பட்டீஸ்வரர்|கோவைக்\s*குற்றாலம்|ஈஷா|டாப்\s*ஸ்லிப்|கொடிசியா)/.test(q)) {
    return true;
  }

  // Prominent Coimbatore educational & medical institutions
  if (/\b(tnau|bharathiar\s*university|cmch|coimbatore\s*medical\s*college|gct\s*coimbatore|psg\s*tech|cit\s*coimbatore|kumaraguru|amrita\s*coimbatore)\b/i.test(lower)
      || /(பாரதியார்\s*பல்கலைக்கழகம்|தமிழ்நாடு\s*வேளாண்மைப்\s*பல்கலைக்கழகம்|கோவை\s*மருத்துவக்\s*கல்லூரி)/.test(q)) {
    return true;
  }

  // Administrative queries in the context of this portal
  if (/\b(collector\s*office|collectorate|district\s*collector|dro|tahsildar|taluk\s*office|corporation\s*commissioner|mayor|commissioner\s*of\s*police|city\s*police|sp\s*rural|siruvani\s*water)\b/i.test(lower)
      && (lower.includes('district') || lower.includes('city') || lower.includes('office') || lower.includes('number') || lower.includes('phone') || lower.includes('contact') || lower.includes('address'))) {
    return true;
  }

  return false;
}

/**
 * Checks if query asks for current officer names, postings, phone numbers,
 * or official contacts that MUST be verified via live web search.
 */
export function requiresOfficialVerification(q: string): boolean {
  const lower = q.toLowerCase();
  return /\b(who\s+is|current|now|present|name|officer|collector|commissioner|mayor|superintendent|sp|dcp|acp|tahsildar|rdo|bdo|contact|phone|mobile|telephone|cell|helpline|email|address|posting|transferred|tenure)\b/i.test(lower)
    || /(யார்|தற்போதைய|ஆட்சியர்|ஆணையர்|மேயர்|காவல்\s*கண்காணிப்பாளர்|வட்டாட்சியர்|தொலைபேசி|எண்|முகவரி|அலுவலகம்)/.test(q);
}

/**
 * Formulate an optimal, high-precision search query targeting official
 * Coimbatore administration and Tamil Nadu Government websites.
 */
export function formulateCoimbatoreSearch(q: string): string {
  const lower = q.toLowerCase();

  // Collector queries
  if (/\b(collector|district\s*magistrate|ஆட்சியர்)\b/i.test(lower)) {
    return 'District Collector of Coimbatore current officer name official coimbatore.nic.in';
  }

  // Corporation Commissioner / Mayor queries
  if (/\b(corporation\s*commissioner|ccmc\s*commissioner|மாநகராட்சி\s*ஆணையர்)\b/i.test(lower)) {
    return 'Coimbatore City Municipal Corporation Commissioner current officer ccmc.gov.in';
  }
  if (/\b(mayor|துணை\s*மேயர்|மேயர்)\b/i.test(lower)) {
    return 'Coimbatore City Municipal Corporation Mayor current ccmc.gov.in';
  }

  // Police Commissioner / SP queries
  if (/\b(police\s*commissioner|commissioner\s*of\s*police|cop|காவல்\s*ஆணையர்)\b/i.test(lower)) {
    return 'Coimbatore City Police Commissioner current officer tnpolice.gov.in';
  }
  if (/\b(superintendent\s*of\s*police|\bsp\b|காவல்\s*கண்காணிப்பாளர்)\b/i.test(lower)) {
    return 'Superintendent of Police Coimbatore District rural current SP tnpolice.gov.in';
  }

  // Taluk and Tahsildar queries
  for (const t of COIMBATORE_TALUKS) {
    if (lower.includes(t.nameEn.toLowerCase()) || q.includes(t.nameTa)) {
      if (lower.includes('tahsildar') || lower.includes('office') || lower.includes('contact') || lower.includes('address') || q.includes('வட்டாட்சியர்')) {
        return `Tahsildar office ${t.nameEn} taluk Coimbatore contact address coimbatore.nic.in`;
      }
    }
  }

  // CMCH / Hospital queries
  if (/\b(hospital|cmch|gh|esi|medical\s*college|மருத்துவமனை)\b/i.test(lower)) {
    return 'Coimbatore Medical College Hospital CMCH government hospital contact services Trichy Road';
  }

  // Grievance / Petitions / Monday grievance day queries
  if (/\b(grievance|petition|complaint|monday|meeting|மனு|குறைதீர்ப்பு)\b/i.test(lower)) {
    return 'Coimbatore district collectorate public grievance day Monday redressal coimbatore.nic.in';
  }

  // Tourism / Places / History queries
  if (/\b(visit|tourism|places|temple|waterfalls|dam|tourist|சுற்றுலா|இடங்கள்)\b/i.test(lower)) {
    return 'places to visit in Coimbatore tourism Marudhamalai Perur Siruvani top attractions';
  }

  // Transport queries
  if (/\b(airport|flight|train|railway|station|bus\s*stand|tnstc|போக்குவரத்து)\b/i.test(lower)) {
    return 'Coimbatore airport railway station bus stand connectivity transport guide';
  }

  // General Coimbatore query fallback
  const cleanQ = q.replace(/[?.,!]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${cleanQ} Coimbatore official administration coimbatore.nic.in`;
}

/**
 * Returns structured, authoritative grounded reference text for Coimbatore
 * to inject into the LLM system/user context.
 */
export function getCoimbatoreGroundedContext(q: string, lang: 'en' | 'ta' | 'tanglish'): string {
  const isTa = lang === 'ta';

  const talukList = COIMBATORE_TALUKS.map(
    (t, i) => `${i + 1}. ${isTa ? t.nameTa : t.nameEn} — ${isTa ? t.officeTa : t.officeEn} (${isTa ? t.divisionTa : t.divisionEn})`
  ).join('\n');

  const zoneList = CCMC_ZONES.map(
    (z) => `• ${z.nameEn}: ${z.wards} (Office: ${z.officeEn})`
  ).join('\n');

  if (isTa) {
    return [
      '═══ அதிகாரப்பூர்வ கோயம்புத்தூர் மாவட்ட தகவல் தளம் (COIMBATORE GROUNDED CONTEXT) ═══',
      '• மாவட்டம்: கோயம்புத்தூர் (கொங்கு மண்டலத்தின் முதன்மைத் தலைநகரம்)',
      `• மாவட்ட ஆட்சியரகம்: ${COIMBATORE_ADMIN_CORE.collectorateAddressTa}`,
      `• ஆட்சியரக தொலைபேசி: ${COIMBATORE_ADMIN_CORE.collectoratePhone}`,
      `• பேரிடர் அவசர உதவி மையம்: ${COIMBATORE_ADMIN_CORE.disasterControlRoom}`,
      `• அதிகாரப்பூர்வ இணையதளம்: ${COIMBATORE_ADMIN_CORE.officialPortal}`,
      '',
      'முக்கிய அவசர மற்றும் பொது உதவி எண்கள்:',
      `• காவல் கட்டுப்பாடு: ${COIMBATORE_ADMIN_CORE.policeControlRoom}`,
      `• ஆம்புலன்ஸ் / அவசர சிகிச்சை: ${COIMBATORE_ADMIN_CORE.ambulance}`,
      `• தீயணைப்பு மற்றும் மீட்பு: ${COIMBATORE_ADMIN_CORE.fireService}`,
      `• பெண்கள் உதவி மையம்: ${COIMBATORE_ADMIN_CORE.womenHelpline}`,
      `• குழந்தைகள் உதவி மையம்: ${COIMBATORE_ADMIN_CORE.childline}`,
      `• சைபர் க்ரைம் புகார்: ${COIMBATORE_ADMIN_CORE.cyberCrime}`,
      `• முதலமைச்சரின் உதவி மையம் (CM Helpline): ${COIMBATORE_ADMIN_CORE.cmHelpline}`,
      `• மாநகராட்சி (CCMC) புகார் எண்: ${COIMBATORE_ADMIN_CORE.ccmcHelpline}`,
      '',
      'கோயம்புத்தூர் மாவட்டத்தின் 11 வருவாய் வட்டங்கள் (தாலுகாக்கள்):',
      talukList,
      '',
      'கோயம்புத்தூர் மாநகராட்சி (CCMC - 100 வார்டுகள், 5 மண்டலங்கள்):',
      '• மேயர், மாநகராட்சி ஆணையர், துணை மேயர் தலைமை நிர்வாகம்.',
      '• தலைமை அலுவலகம்: ராஜா வீதி, டவுன்ஹால், கோயம்புத்தூர் - 641001.',
      zoneList,
      '• குடிநீர் ஆதாரங்கள்: சிறுவாணி, பில்லூர் I, II, III, மற்றும் ஆழியாறு குடிநீர்த் திட்டங்கள்.',
      '',
      'காவல் துறை நிர்வாகம்:',
      '• கோவை மாநகர காவல் ஆணையரகம்: காவல் ஆணையர் (CoP) தலைமையில், துணை ஆணையர்கள் (சட்டம் ஒழுங்கு, போக்குவரத்து, குற்றம், தலைமையிடம்) செயல்படுகின்றனர்.',
      '• கோவை மாவட்ட காவல் (ஊரகம்): மாவட்ட காவல் கண்காணிப்பாளர் (SP) தலைமையில் புறநகர் மற்றும் ஊரக பகுதிகள் செயல்படுகின்றன.',
      '',
      'முக்கிய அரசு மருத்துவமனைகள்:',
      '• கோவை அரசு மருத்துவக் கல்லூரி மருத்துவமனை (CMCH / GH - திருச்சி ரோடு): 1,500+ படுக்கைகள், அதிநவீன தீவிர சிகிச்சை பிரிவு, 24 மணி நேர விபத்து சிகிச்சை.',
      '• இ.எஸ்.ஐ. மருத்துவக் கல்லூரி மருத்துவமனை (சிங்காநல்லூர்): 500 படுக்கைகள் கொண்ட மத்திய/மாநில அரசு மருத்துவமனை.',
      '',
      'போக்குவரத்து & உள்கட்டமைப்பு:',
      '• சர்வதேச விமான நிலையம் (CJB - பீளமேடு, அவினாசி ரோடு).',
      '• ரயில் நிலையங்கள்: கோயம்புத்தூர் சந்திப்பு (CBE), போத்தனூர், கோவை வடக்கு.',
      '• முக்கிய பேருந்து நிலையங்கள்: காந்திபுரம் (மத்திய/விரைவு பேருந்துகள்), உக்கடம் (பொள்ளாச்சி, கேரளா மார்க்கம்), சிங்காநல்லூர் (மதுரை, திருச்சி, சேலம்), மேட்டுப்பாளையம் ரோடு (நீலகிரி, மேட்டுப்பாளையம்).',
      '• அரசுப் போக்குவரத்துக் கழகம்: TNSTC கோயம்புத்தூர் கோட்டம் (மேட்டுப்பாளையம் ரோடு).',
      '',
      'பொருளாதாரம் மற்றும் தொழில் வளம்:',
      '• "தென்னிந்தியாவின் மான்செஸ்டர்" (ஜவுளி மற்றும் நூற்பாலைகள்).',
      '• மோட்டார் மற்றும் பம்ப் உற்பத்தி (இந்தியாவின் 40%+ தேவையை பூர்த்தி செய்கிறது).',
      '• வெட் கிரைண்டர் உற்பத்தி (புவிசார் குறியீடு - GI Tag பெற்றது).',
      '• ஆட்டோமொபைல் உதிரிபாகங்கள், ஃபவுண்டரி வார்ப்படத் தொழில், தங்க நகை உற்பத்தி.',
      '• தகவல் தொழில்நுட்பம்: டைடல் பார்க் (விளாங்குறிச்சி), எல்காட் செஸ் (ELCOT SEZ), கொடிசியா வர்த்தக மையம்.',
      '',
      'முக்கிய வழிபாட்டுத் தலங்கள் & சுற்றுலா இடங்கள்:',
      '• மருதமலை சுப்பிரமணிய சுவாமி திருக்கோயில், பேரூர் பட்டீஸ்வரர் திருக்கோயில், ஈச்சனாரி விநாயகர் கோயில்.',
      '• சிறுவாணி அணை & அருவி (உலகின் மிகச் சுவையான இரண்டாவது குடிநீர்), கோவைக் குற்றாலம்.',
      '• வெள்ளியங்கிரி மலை அடிவாரம் / ஈஷா யோகா மையம் (112 அடி ஆதியோகி சிலை).',
      '• ஆனைமலை புலிகள் காப்பகம் / டாப்ஸ்லிப் / வால்பாறை தேயிலைத் தோட்டங்கள்.',
      '• ஜி.டி. நாயுடு கார் அருங்காட்சியகம் (Gedee Car Museum).',
      '',
      'பொது மக்கள் குறைதீர்க்கும் நடைமுறைகள்:',
      '• வாராந்திர மக்கள் குறைதீர்க்கும் நாள்: ஒவ்வொரு திங்கட்கிழமையும் காலை 10:00 மணிக்கு மாவட்ட ஆட்சியரகத்தில் ஆட்சியர் தலைமையில் நடைபெறும்.',
      '• விவசாயிகள் குறைதீர்க்கும் நாள்: ஒவ்வொரு மாதமும் 3-வது வெள்ளிக்கிழமை ஆட்சியரகத்தில் நடைபெறும்.',
      '• இ-சேவை மையங்கள்: வருமானச் சான்றிதழ், சாதிச் சான்றிதழ், இருப்பிடச் சான்றிதழ், வாரிசுச் சான்றிதழ், பட்டா மாறுதல் ஆகியவை அனைத்து வட்டங்களிலும் ஆன்லைனில் வழங்கப்படுகின்றன.',
    ].join('\n');
  }

  return [
    '═══ AUTHORITATIVE COIMBATORE DISTRICT GROUNDED KNOWLEDGE ═══',
    '• District: Coimbatore (Premier industrial, textile, and institutional capital of Western Tamil Nadu)',
    `• District Collectorate: ${COIMBATORE_ADMIN_CORE.collectorateAddressEn}`,
    `• Collectorate Phone: ${COIMBATORE_ADMIN_CORE.collectoratePhone}`,
    `• Disaster Control Room Helpline: ${COIMBATORE_ADMIN_CORE.disasterControlRoom}`,
    `• Official District Portal: ${COIMBATORE_ADMIN_CORE.officialPortal}`,
    '',
    'Essential Public Emergency & Administrative Helplines:',
    `• Police Control Room: ${COIMBATORE_ADMIN_CORE.policeControlRoom}`,
    `• Ambulance & Medical Emergency: ${COIMBATORE_ADMIN_CORE.ambulance}`,
    `• Fire & Rescue: ${COIMBATORE_ADMIN_CORE.fireService}`,
    `• Women Helpline: ${COIMBATORE_ADMIN_CORE.womenHelpline}`,
    `• Childline: ${COIMBATORE_ADMIN_CORE.childline}`,
    `• Cyber Crime Helpline: ${COIMBATORE_ADMIN_CORE.cyberCrime}`,
    `• Chief Minister Helpline (CM Helpline): ${COIMBATORE_ADMIN_CORE.cmHelpline}`,
    `• Coimbatore City Municipal Corporation (CCMC) 24x7 Helpline: ${COIMBATORE_ADMIN_CORE.ccmcHelpline}`,
    '',
    'Coimbatore District Revenue Taluks (11 Taluks & Tahsildar Offices):',
    talukList,
    '',
    'Coimbatore City Municipal Corporation (CCMC - 100 Wards, 5 Zones):',
    '• Governed by Mayor, Corporation Commissioner, and Deputy Mayor.',
    '• Head Office: Raja Street, Town Hall, Coimbatore - 641001.',
    zoneList,
    '• Water Supply Sources: Siruvani Dam (renowned for natural mineral sweetness), Pillur Scheme I, II, III, Aliyar Scheme.',
    '• Civic Services: Property tax, professional tax, birth & death registration, building plan sanction, underground drainage, trade licenses.',
    '',
    'Law Enforcement & Police Administration:',
    '• Coimbatore City Police Commissionerate: Headed by the Commissioner of Police (CoP - ADGP/IGP rank) covering city limits with Deputy Commissioners (DCP Law & Order, DCP Traffic, DCP Crime, DCP Headquarters), All Women Police Stations (AWPS), and Cyber Crime Wing.',
    '• Coimbatore District Police: Headed by the Superintendent of Police (SP Coimbatore District) covering rural and sub-divisional jurisdictions (Perur, Pollachi, Mettupalayam, Valparai, etc.).',
    '',
    'Healthcare & Major Government Hospitals:',
    '• Coimbatore Medical College Hospital (CMCH / Government Headquarters Hospital, Trichy Road): 1,500+ beds, multi-specialty trauma care, 24x7 emergency, free treatment under Chief Minister Comprehensive Health Insurance Scheme (CMCHIS).',
    '• ESI Medical College & Hospital (Singanallur): 500-bedded multi-specialty government healthcare center.',
    '• Government District Headquarters Hospital, Pollachi, and Taluk Hospitals in Mettupalayam, Valparai, Sulur.',
    '',
    'Transport & Connectivity:',
    '• Airport: Coimbatore International Airport (CJB) located in Peelamedu on Avinashi Road.',
    '• Railways: Coimbatore Junction (CBE - Category A1, Southern Railway), Podanur Junction (PTJ), Coimbatore North (CBF).',
    '• Bus Terminals: Gandhipuram Central Bus Stand (Mofussil & SETC express), Ukkadam Bus Stand (Pollachi, Kerala), Singanallur Bus Stand (Madurai, Trichy, Salem), Saibaba Colony / New Mettupalayam Road Bus Stand (Ooty, Nilgiris).',
    '• Public Bus Transit: Tamil Nadu State Transport Corporation (TNSTC Coimbatore Division, Mettupalayam Road).',
    '',
    'Economy, Manufacturing & Industries:',
    '• "Manchester of South India": Renowned textile and cotton spinning capital.',
    '• "Pump City of Asia": Manufactures over 40% of India’s motors, submersible pumps, and agricultural pumpsets.',
    '• Table-top Wet Grinders: Registered Geographical Indication (GI Tag) industry.',
    '• Precision engineering, foundries, casting, auto-component manufacturing, jewelry and gold craft.',
    '• Information Technology: TIDEL Park Coimbatore (Vilankurichi), ELCOT SEZ, Eachanari IT Corridor, CODISSIA Trade Fair Complex (INTEC, Agri Intex).',
    '',
    'Prominent Educational & Research Institutions:',
    '• Tamil Nadu Agricultural University (TNAU, est. 1971), Bharathiar University (est. 1982), Government College of Technology (GCT, est. 1945), Coimbatore Medical College (est. 1966), PSG College of Technology, Coimbatore Institute of Technology (CIT).',
    '',
    'Key Tourism, Heritage & Nature Destinations:',
    '• Marudhamalai Sri Subrahmanya Swamy Temple, Perur Pateeswarar Temple (Kanaka Sabha, Chola architecture), Eachanari Vinayagar Temple.',
    '• Siruvani Waterfalls and Dam (world’s second sweetest water), Kovai Kutralam (Chadivayal).',
    '• Velliangiri Foothills / Isha Yoga Center (112-ft Adiyogi Shiva statue, Dhyanalinga).',
    '• Anamalai Tiger Reserve (ATR / Topslip / Valparai hill station), Monkey Falls.',
    '• GD Naidu Car Museum (Gedee Car Museum, Avinashi Road), Gas Forest Museum, VOC Park & Zoo.',
    '',
    'Public Services & Grievance Redressal Mechanisms:',
    '• Public Grievance Day: Every Monday at 10:00 AM at the District Collectorate, chaired by the District Collector.',
    '• Farmers Grievance Day: Conducted every 3rd Friday of the month at the Collectorate.',
    '• e-Sevai / TNeGA Centers: Online revenue certificates (Income, Community, Nativity, First Graduate, Legal Heir) and land records (Patta/Chitta via eservices.tn.gov.in) available across all 11 taluks.',
  ].join('\n');
}
