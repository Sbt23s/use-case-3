/**
 * Bilingual semantic analysis.
 *
 * Verifies that the same grievance, written in Tamil or English, reaches the
 * same conclusion - and that a petition on a subject the knowledge base does
 * not cover is reported honestly rather than assigned the least-bad Act.
 */
const API = process.env.API_BASE || 'http://localhost:4000/api';
let PASSED = 0, FAILED = 0;

const ok = (label, cond, extra = '') => {
  if (cond) PASSED++; else FAILED++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`);
};

async function call(method, path, token, body) {
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (r.status === 429) { console.error('\nRate limit reached. Restart the API.'); process.exit(2); }
  return { status: r.status, json };
}

const login = async (u, p) => {
  const r = await call('POST', '/auth/login', null, { username: u, password: p });
  if (!r.json?.token) throw new Error(`login ${u} failed`);
  return r.json.token;
};

const citizen = await login('citizen1', 'Citizen@123');
const officer = await login('gro', 'Officer@123');

async function analyse(subject, description) {
  const sub = await call('POST', '/cp/petitions', citizen, {
    citizen_name: 'Test Petitioner', citizen_phone: '9000000001',
    citizen_address: 'Test address', subject, description,
  });
  if (sub.status !== 201) throw new Error(`submit failed: ${JSON.stringify(sub.json)}`);
  const a = await call('POST', `/cp/petitions/${sub.json.petitionId}/analyse`, officer);
  return { id: sub.json.petitionId, a: a.json, status: a.status };
}

console.log('=== BILINGUAL SEMANTIC ANALYSIS ===\n');

// Same grievance in both languages must reach the same department.
const PAIRS = [
  {
    name: 'Patta transfer',
    dept: /Revenue/i,
    en: ['patta not transferred to my name',
      'I purchased land two years ago with a registered sale deed. The patta has not been transferred to my name despite applying at the taluk office. Survey number 123/4.'],
    ta: ['பட்டா மாற்றம் செய்யப்படவில்லை',
      'நான் இரண்டு ஆண்டுகளுக்கு முன்பு பதிவு செய்யப்பட்ட கிரய பத்திரத்துடன் நிலம் வாங்கினேன். வட்டாட்சியர் அலுவலகத்தில் விண்ணப்பித்தும் பட்டா என் பெயருக்கு மாற்றப்படவில்லை. புல எண் 123/4.'],
  },
  {
    name: 'Old age pension',
    dept: /Social Welfare/i,
    en: ['old age pension not received for six months',
      'I applied for old age pension one year back. I have not received any pension for six months. I am destitute with no other income.'],
    ta: ['முதியோர் ஓய்வூதியம் கிடைக்கவில்லை',
      'நான் ஒரு வருடத்திற்கு முன்பு முதியோர் ஓய்வூதியத்திற்கு விண்ணப்பித்தேன். ஆறு மாதங்களாக ஓய்வூதியம் கிடைக்கவில்லை. எனக்கு வேறு வருமானம் இல்லை.'],
  },
  {
    name: 'Drinking water',
    dept: /Municipal|Water|Rural/i,
    en: ['no drinking water supply in our street',
      'There has been no drinking water supply in our street for one month. The municipality has not responded to our complaints. Children are affected.'],
    ta: ['எங்கள் தெருவில் குடிநீர் வரவில்லை',
      'எங்கள் தெருவில் ஒரு மாதமாக குடிநீர் வரவில்லை. நகராட்சியில் புகார் அளித்தும் நடவடிக்கை இல்லை. குழந்தைகள் பாதிக்கப்படுகிறார்கள்.'],
  },
  {
    name: 'Land encroachment',
    dept: /Revenue|Water/i,
    en: ['encroachment on government land next to my house',
      'A private party has encroached upon the government poramboke land next to my house and built a compound wall. Please take action to remove the encroachment.'],
    ta: ['எங்கள் வீட்டு அருகே அரசு நிலம் ஆக்கிரமிப்பு',
      'எங்கள் வீட்டுக்கு அருகில் உள்ள அரசு புறம்போக்கு நிலத்தை ஒரு தனியார் ஆக்கிரமித்து சுற்றுச்சுவர் கட்டியுள்ளார். ஆக்கிரமிப்பை அகற்ற நடவடிக்கை எடுக்க வேண்டுகிறேன்.'],
  },
  {
    name: 'Electricity',
    dept: /Energy/i,
    en: ['no electricity for three days, transformer damaged',
      'The transformer in our village is damaged and there has been no electricity for three days. We complained to the EB office but no action was taken.'],
    ta: ['மூன்று நாட்களாக மின்சாரம் இல்லை',
      'எங்கள் கிராமத்தில் மின்மாற்றி பழுதடைந்து மூன்று நாட்களாக மின்சாரம் இல்லை. மின்சார வாரிய அலுவலகத்தில் புகார் அளித்தும் நடவடிக்கை இல்லை.'],
  },
  {
    name: 'Police complaint',
    dept: /Home/i,
    en: ['police refusing to register my complaint',
      'I went to the police station to file a complaint about theft in my house but they refused to register an FIR.'],
    ta: ['காவல்துறை என் புகாரை பதிவு செய்ய மறுக்கிறது',
      'என் வீட்டில் நடந்த திருட்டு குறித்து புகார் அளிக்க காவல் நிலையம் சென்றேன். ஆனால் எஃப்ஐஆர் பதிவு செய்ய மறுத்துவிட்டனர்.'],
  },
];

for (const c of PAIRS) {
  console.log(`\n${c.name}`);
  const en = await analyse(...c.en);
  const ta = await analyse(...c.ta);

  // Act, department and authority names are bilingual: { en, ta }.
  ok(`  English: Act identified`, !!en.a?.act?.id, en.a?.act?.short_name?.en ?? 'NONE');
  ok(`  Tamil:   Act identified`, !!ta.a?.act?.id, ta.a?.act?.short_name?.en ?? 'NONE');
  ok(`  English: department correct`, c.dept.test(en.a?.department?.name?.en ?? ''), en.a?.department?.name?.en);
  ok(`  Tamil:   department correct`, c.dept.test(ta.a?.department?.name?.en ?? ''), ta.a?.department?.name?.en);
  ok(`  Both languages agree on the department`,
    en.a?.department?.id === ta.a?.department?.id,
    `en=${en.a?.department?.name?.en} ta=${ta.a?.department?.name?.en}`);
  // The Tamil half must actually be Tamil where the knowledge base records one.
  ok(`  Department name is carried in Tamil`,
    /[஀-௿]/.test(ta.a?.department?.name?.ta ?? ''),
    ta.a?.department?.name?.ta);
  ok(`  Act name is carried in Tamil`,
    !ta.a?.act?.id || /[஀-௿]/.test(ta.a?.act?.short_name?.ta ?? ''),
    ta.a?.act?.short_name?.ta);
  ok(`  Tamil output is genuinely in Tamil`,
    /[஀-௿]/.test(ta.a?.next_action?.ta ?? ''));
  ok(`  English output is present`, !!en.a?.next_action?.en);
}

// ---------------- honest refusal ----------------
console.log('\nUncovered subject');
const odd = await analyse(
  'satellite launch slot allocation dispute',
  'I wish to raise a dispute concerning the allocation of a geostationary satellite launch slot and the associated orbital frequency coordination.',
);
ok('  Reports no Act rather than assigning the nearest one',
  !odd.a?.act?.id, odd.a?.act?.short_name ?? 'no Act suggested');
ok('  Says verification is required, in English',
  /Requires Officer Verification/i.test(odd.a?.act?.reason?.en ?? ''));
ok('  Says verification is required, in Tamil',
  /அதிகாரி சரிபார்ப்பு தேவை/.test(odd.a?.act?.reason?.ta ?? ''));

// ---------------- reasoning flow ----------------
console.log('\nReasoning flow and governance');
const flow = await analyse(
  'patta not transferred',
  'I purchased land with a registered sale deed but the patta has not been transferred at the taluk office.',
);
const steps = (flow.a?.reasoning_flow ?? []).map((s) => s.step);
ok('  Full reasoning flow is produced',
  ['Petition', 'Issue', 'Act', 'Section', 'Department', 'Authority', 'Jurisdiction', 'Action']
    .every((s) => steps.includes(s)),
  steps.join(' → '));
ok('  Workflow steps are given', (flow.a?.workflow?.length ?? 0) > 0,
  `${flow.a?.workflow?.length} steps`);
ok('  Required documents are listed', (flow.a?.required_documents?.length ?? 0) > 0,
  `${flow.a?.required_documents?.length} documents`);
ok('  Concepts detected and labelled bilingually',
  (flow.a?.detected_concepts?.length ?? 0) > 0
  && !!flow.a.detected_concepts[0].label.ta,
  flow.a?.detected_concepts?.map((c) => c.label.en).join(', '));
ok('  Act carries its verification status',
  !!flow.a?.act?.verification_status, flow.a?.act?.verification_status);
ok('  Result is marked as requiring officer verification',
  flow.a?.requires_verification === true);

// The knowledge-base grounding must hold: every named entity exists as a row.
const acts = await call('GET', `/kb/acts?q=${encodeURIComponent(flow.a.act.short_name.en)}`, officer);
ok('  GOVERNANCE: named Act exists in the knowledge base',
  Array.isArray(acts.json) && acts.json.some((x) => x.id === flow.a.act.id));
const depts = await call('GET', '/kb/departments', officer);
ok('  GOVERNANCE: named department exists in the knowledge base',
  depts.json.some((x) => x.id === flow.a.department.id));

console.log(`\n=== RESULT: ${PASSED} passed, ${FAILED} failed ===`);
process.exit(FAILED === 0 ? 0 : 1);
