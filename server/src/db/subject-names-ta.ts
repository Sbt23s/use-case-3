/**
 * Tamil names for the petition issue types ingested from the routing knowledge
 * base.
 *
 * These are the terms Tamil Nadu government correspondence uses for each issue
 * type, so a citizen writing "பட்டா மாற்றம்" and an officer reading the English
 * console see the same category.
 *
 * Matched on a distinctive fragment of the English name rather than the whole
 * string, because the ingested names carry the document's own wrapping
 * ("Patta / land ownership record dispute, patta transfer, patta not issued").
 */
export const SUBJECT_TA: { match: RegExp; ta: string }[] = [
  // --- Land, revenue, property ---
  { match: /land encroachment|unauthorised occupation/i, ta: 'நில ஆக்கிரமிப்பு / அனுமதியற்ற ஆக்கிரமிப்பு' },
  { match: /patta \/ land ownership|patta transfer|patta not issued/i, ta: 'பட்டா / நில உரிமைப் பதிவு தகராறு, பட்டா மாற்றம்' },
  { match: /land ceiling|surplus land/i, ta: 'நில உச்சவரம்பு / உபரி நிலத் தகராறு' },
  { match: /boundary dispute|survey stone|re-survey/i, ta: 'எல்லைத் தகராறு / சர்வே கல் / மறுஅளவை' },
  { match: /stamp duty registration|undervaluation|refusal to register/i, ta: 'சொத்து / முத்திரைத் தீர்வை பதிவு பிரச்சினை' },
  { match: /disaster relief|flood, cyclone|fire damage/i, ta: 'பேரிடர் நிவாரணம் / வெள்ளம், புயல், தீ சேத இழப்பீடு' },

  // --- Police, law and order ---
  { match: /FIR not registered|police inaction/i, ta: 'எஃப்ஐஆர் பதிவு செய்யப்படவில்லை / காவல்துறை நடவடிக்கை இல்லை' },
  { match: /dowry harassment|cruelty by husband/i, ta: 'வரதட்சணை கொடுமை / கணவர் உறவினர் கொடுமை' },
  { match: /domestic violence/i, ta: 'குடும்ப வன்முறை' },
  { match: /caste|atrocity|SC\/ST/i, ta: 'சாதி ரீதியான கொடுமை' },
  { match: /cheating|fraud|money/i, ta: 'ஏமாற்று / மோசடி' },
  { match: /missing person|kidnap/i, ta: 'காணாமல் போனவர் / கடத்தல்' },
  { match: /cyber|online fraud/i, ta: 'இணைய குற்றம் / ஆன்லைன் மோசடி' },
  { match: /land grabbing|threat/i, ta: 'நில அபகரிப்பு / மிரட்டல்' },
  { match: /illegal liquor|TASMAC/i, ta: 'சட்டவிரோத மது விற்பனை' },

  // --- Municipal and civic ---
  { match: /drinking water|water supply/i, ta: 'குடிநீர் வழங்கல் பிரச்சினை' },
  { match: /drainage|sewage|sanitation/i, ta: 'கழிவுநீர் / சுகாதாரப் பிரச்சினை' },
  { match: /garbage|solid waste/i, ta: 'குப்பை அகற்றல் / திடக்கழிவு மேலாண்மை' },
  { match: /street light/i, ta: 'தெரு விளக்கு பழுது' },
  { match: /road|pothole/i, ta: 'சாலை பழுது / குழி' },
  { match: /building plan|unauthorised construction/i, ta: 'கட்டிட அனுமதி / அனுமதியற்ற கட்டுமானம்' },

  // --- Utilities ---
  { match: /power cut|transformer/i, ta: 'மின் தடை / மின்மாற்றி பழுது' },
  { match: /power theft|illegal power/i, ta: 'மின் திருட்டு புகார்' },
  { match: /electricity bill|billing/i, ta: 'மின் கட்டண தகராறு' },

  // --- Education ---
  { match: /school admission|RTE/i, ta: 'பள்ளி சேர்க்கை / கல்வி உரிமை' },
  { match: /fee|capitation/i, ta: 'அதிகக் கட்டணம் வசூல்' },
  { match: /teacher|staff shortage/i, ta: 'ஆசிரியர் பற்றாக்குறை' },

  // --- Labour and industry ---
  { match: /wages|minimum wage/i, ta: 'ஊதியம் வழங்கப்படவில்லை / குறைந்தபட்ச ஊதியம்' },
  { match: /bonded labour|child labour/i, ta: 'கொத்தடிமை / குழந்தைத் தொழிலாளர்' },
  { match: /industrial dispute|termination/i, ta: 'தொழில் தகராறு / பணிநீக்கம்' },
  { match: /workplace safety|accident/i, ta: 'பணியிட பாதுகாப்பு / விபத்து' },

  // --- Environment, forest, agriculture ---
  { match: /pollution|effluent/i, ta: 'மாசுபாடு / கழிவுநீர் வெளியேற்றம்' },
  { match: /tree cutting|forest/i, ta: 'மரம் வெட்டுதல் / வன ஆக்கிரமிப்பு' },
  { match: /crop|compensation|insurance/i, ta: 'பயிர் இழப்பீடு / பயிர் காப்பீடு' },
  { match: /fertiliser|seed|subsidy/i, ta: 'உரம் / விதை / மானியம்' },

  // --- Consumer, food, health ---
  { match: /ration|PDS|fair price/i, ta: 'ரேஷன் அட்டை / நியாய விலைக் கடை' },
  { match: /food adulteration|hygiene/i, ta: 'உணவு கலப்படம் / சுகாதாரம்' },
  { match: /hospital|medical negligence/i, ta: 'மருத்துவமனை / மருத்துவ கவனக்குறைவு' },
  { match: /consumer|defective|service deficiency/i, ta: 'நுகர்வோர் புகார் / சேவைக் குறைபாடு' },

  // --- Social welfare ---
  { match: /senior citizen|maintenance|parents/i, ta: 'மூத்த குடிமக்கள் பராமரிப்பு' },
  { match: /pension not|old age pension|widow/i, ta: 'ஓய்வூதியம் கிடைக்கவில்லை' },
  { match: /disabled|differently abled/i, ta: 'மாற்றுத்திறனாளி நலன்' },
  { match: /child|POCSO|juvenile/i, ta: 'குழந்தைகள் நலன் / பாதுகாப்பு' },

  // --- Housing, registration, tax, governance ---
  { match: /housing board|allotment/i, ta: 'வீட்டு வசதி வாரியம் / ஒதுக்கீடு' },
  { match: /birth|death certificate/i, ta: 'பிறப்பு / இறப்பு சான்றிதழ்' },
  { match: /property tax|municipal tax/i, ta: 'சொத்து வரி' },
  { match: /RTI|information not/i, ta: 'தகவல் அறியும் உரிமை' },
  { match: /corruption|bribe/i, ta: 'ஊழல் / லஞ்சம்' },

  // --- Transport ---
  { match: /driving licence|RC|fitness/i, ta: 'ஓட்டுநர் உரிமம் / பதிவுச் சான்று' },
  { match: /overcharging|bus|auto|cab/i, ta: 'அதிகக் கட்டணம் வசூல் (பேருந்து / ஆட்டோ)' },
  { match: /public transport|bus service/i, ta: 'பொதுப் போக்குவரத்து சேவை' },
];

/** The Tamil name for an ingested subject, or null when none is recorded. */
export function tamilForSubject(name: string): string | null {
  for (const { match, ta } of SUBJECT_TA) {
    if (match.test(name)) return ta;
  }
  return null;
}
