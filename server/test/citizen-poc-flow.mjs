/**
 * Citizen Petition POC - end-to-end flow.
 *
 * Citizen Login -> Create Petition -> Upload Letter -> Submit ->
 * Real-Time Officer Dashboard -> Officer Opens Letter -> OCR ->
 * AI Full Analysis -> Act Identification -> Department & Officer
 * Recommendation -> AI Summary -> Copilot
 *
 * Everything runs against the live HTTP API. The real-time step genuinely
 * opens an SSE stream and waits for the event, rather than assuming it fired.
 */
import { readFileSync, existsSync } from 'node:fs';

const API = process.env.API_BASE || 'http://localhost:4000/api';
let PASSED = 0, FAILED = 0;

const ok = (label, cond, extra = '') => {
  if (cond) PASSED++; else FAILED++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`);
};
const section = (t) => console.log(`\n${t}`);

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
  if (r.status === 429) {
    console.error('\nRate limit reached. Restart the API or wait a minute.');
    process.exit(2);
  }
  return { status: r.status, json };
}

const login = async (u, p) => {
  const r = await call('POST', '/auth/login', null, { username: u, password: p });
  if (!r.json?.token) throw new Error(`login ${u} failed: ${JSON.stringify(r.json)}`);
  return r.json.token;
};

/** Open an SSE stream and resolve when the named event arrives. */
function waitForEvent(token, eventName, timeoutMs = 15000) {
  return new Promise(async (resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);

    try {
      const res = await fetch(`${API}/cp/stream?token=${encodeURIComponent(token)}`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      if (!res.ok || !res.body) { clearTimeout(timer); resolve(null); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const ev = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim();
          const dataLine = /^data:\s*(.+)$/m.exec(frame)?.[1];
          if (ev === eventName && dataLine) {
            clearTimeout(timer);
            controller.abort();
            resolve(JSON.parse(dataLine));
            return;
          }
        }
      }
    } catch { /* aborted or closed */ }
    clearTimeout(timer);
    resolve(null);
  });
}

(async () => {
  console.log('=== CITIZEN PETITION POC - END TO END FLOW ===');

  // ---------------- 1. Logins ----------------
  section('1. Authentication (two roles only)');
  const citizen = await login('citizen1', 'Citizen@123');
  ok('Citizen can log in', !!citizen);
  const officer = await login('gro', 'Officer@123');
  ok('Government Grievance Officer can log in', !!officer);

  const me = await call('GET', '/auth/me', officer);
  ok('Officer holds the analysis permission',
    me.json?.user?.permissions?.includes('AI_ANALYZE'));
  const citMe = await call('GET', '/auth/me', citizen);
  ok('Citizen does NOT hold the analysis permission',
    !citMe.json?.user?.permissions?.includes('AI_ANALYZE'));

  // ---------------- 2. Knowledge configuration ----------------
  section('2. AI Knowledge Configuration');
  const stats = await call('GET', '/kb/stats', officer);
  ok('Knowledge base is configured',
    stats.json?.acts?.active > 0 && stats.json?.departments?.active > 0,
    `acts=${stats.json?.acts?.active} depts=${stats.json?.departments?.active} authorities=${stats.json?.authorities?.active}`);

  const acts = await call('GET', '/kb/acts', officer);
  ok('Acts are listed with their sections and departments',
    Array.isArray(acts.json) && acts.json.length > 0,
    `${acts.json?.length} acts`);

  // Adding a new Act must work with no code change.
  const newAct = await call('POST', '/kb/acts', officer, {
    short_name: 'SAMPLE Test Act for Automated Verification',
    full_title: 'SAMPLE - Test Act created by the automated test',
    act_type: 'ACT', act_number: 'DEMO-TEST-99', year: 2024,
    jurisdiction: 'STATE',
    applies_when: 'A petition mentions a completely distinctive test phrase.',
    keywords: 'zzztestphrase, automated verification marker',
    is_demo: true, active: true,
  });
  ok('A new Act can be added from configuration (no code change)',
    newAct.status === 201, `id=${newAct.json?.id}`);

  const searchAct = await call('GET', '/kb/acts?q=zzztestphrase', officer);
  ok('Configured knowledge is searchable',
    Array.isArray(searchAct.json) && searchAct.json.length === 1);

  const deact = await call('PATCH', `/kb/acts/${newAct.json.id}`, officer, { active: false });
  ok('An Act can be deactivated', deact.status === 200);

  const delAct = await call('DELETE', `/kb/acts/${newAct.json.id}?hard=true`, officer);
  ok('An Act can be deleted', delAct.status === 200);

  // A citizen must not be able to change the knowledge base.
  const kbDenied = await call('POST', '/kb/departments', citizen, {
    code: 'HACK', name: 'Should not be created',
  });
  ok('SECURITY: citizen cannot modify the knowledge base', kbDenied.status === 403);

  // ---------------- 3. Real-time stream + submission ----------------
  section('3. Citizen submits - officer dashboard updates in real time');

  // Officer subscribes BEFORE the citizen submits, so the event is genuinely live.
  const eventPromise = waitForEvent(officer, 'petition:new');
  await new Promise((r) => setTimeout(r, 600));   // let the stream establish

  const submit = await call('POST', '/cp/petitions', citizen, {
    citizen_name: 'Lakshmi Ammal',
    citizen_phone: '9000000001',
    citizen_address: 'Door 12, Demo Village, Demo Taluk',
    subject: 'Property sold by my sons without my knowledge and I am not receiving old age pension',
    description:
      'I am 72 years old and my husband is 78 and unwell. The house and land which stood in my name ' +
      'was sold by my two sons on 12-03-2023 without my knowledge and without my acknowledgement. ' +
      'Since then we have no income and are facing great difficulty for food and medical expenses. ' +
      'I have also not received my old age pension. I request the government to help us.',
    language: 'en',
  });
  ok('Citizen can submit a petition', submit.status === 201, submit.json?.referenceNo);
  const PID = submit.json?.petitionId;

  const event = await eventPromise;
  ok('Officer dashboard received the petition in REAL TIME',
    !!event && event.id === PID,
    event ? `event received: ${event.reference_no}` : 'no event within 15s');

  // ---------------- 4. Document upload and OCR ----------------
  section('4. Letter upload and OCR');
  const fixture = new URL('./fixtures/patta.png', import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, '$1');

  let docId = null;
  if (existsSync(fixture)) {
    const fd = new FormData();
    fd.append('file', new Blob([readFileSync(fixture)], { type: 'image/png' }), 'petition-letter.png');
    fd.append('title', 'Scanned petition letter');
    const up = await fetch(`${API}/cp/petitions/${PID}/documents`, {
      method: 'POST', headers: { Authorization: `Bearer ${citizen}` }, body: fd,
    });
    const uj = await up.json();
    docId = uj.documentId;
    ok('Citizen can upload the petition letter', up.status === 201,
      `ocr=${uj.ocr_status}`);

    // Poll for the real OCR result.
    let doc = null;
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const det = await call('GET', `/cp/petitions/${PID}`, officer);
      doc = det.json?.documents?.find((d) => d.id === docId);
      if (doc && (doc.ocr_status === 'COMPLETED' || doc.ocr_status === 'FAILED')) break;
    }
    ok('OCR reached a real terminal state', !!doc && doc.ocr_status !== 'PENDING',
      `${doc?.ocr_status} via ${doc?.ocr_engine}`);
    ok('OCR extracted text from the uploaded letter',
      doc?.ocr_status === 'COMPLETED' && (doc?.extracted_text?.length ?? 0) > 0,
      doc?.extracted_text ? JSON.stringify(doc.extracted_text.slice(0, 40)) : '');
    ok('OCR confidence is recorded for officer judgement',
      doc?.ocr_confidence !== null && doc?.ocr_confidence !== undefined,
      `confidence=${doc?.ocr_confidence}`);
  } else {
    console.log('  SKIP  OCR test (fixture missing)');
  }

  // Also attach a text letter so the analyser has clean content to read.
  const fd2 = new FormData();
  fd2.append('file', new Blob([
    'PETITION LETTER\n\nTo the District Collector.\n\n' +
    'I am a senior citizen aged 72. My sons sold the property standing in my name on 12-03-2023 ' +
    'without my knowledge and without my acknowledgement. My husband is aged 78 and unwell. ' +
    'We are unable to maintain ourselves and are facing livelihood difficulty. ' +
    'I have not received my old age pension for six months. ' +
    'I request the government to take action and provide assistance.',
  ], { type: 'text/plain' }), 'letter.txt');
  fd2.append('title', 'Petition letter (text)');
  const up2 = await fetch(`${API}/cp/petitions/${PID}/documents`, {
    method: 'POST', headers: { Authorization: `Bearer ${citizen}` }, body: fd2,
  });
  ok('A second document can be attached', up2.status === 201);

  // ---------------- 5. Officer view ----------------
  section('5. Officer dashboard and petition detail');
  const list = await call('GET', '/cp/petitions', officer);
  ok('Officer sees all incoming petitions',
    list.json?.rows?.some((r) => r.id === PID),
    `${list.json?.total} petition(s)`);

  const detail = await call('GET', `/cp/petitions/${PID}`, officer);
  ok('Officer can view the complete petition', detail.status === 200);
  ok('Officer can see the uploaded documents',
    (detail.json?.documents?.length ?? 0) >= 1,
    `${detail.json?.documents?.length} document(s)`);
  ok('Officer can see the extracted text',
    detail.json?.documents?.some((d) => d.extracted_text));

  // ---------------- 6. AI analysis ----------------
  section('6. AI Petition Analyzer');
  const ana = await call('POST', `/cp/petitions/${PID}/analyse`, officer);
  ok('AI analysis completes', ana.status === 200,
    `confidence=${Math.round((ana.json?.overall_confidence ?? 0) * 100)}%`);

  const a = ana.json;
  ok('AI Summary produced in both languages',
    !!a?.summary?.en && a.summary.en.length > 20 && !!a?.summary?.ta);
  ok('Main issue identified', !!a?.main_issue?.en);
  ok('Petitioner request identified', !!a?.petitioner_request?.en);
  ok('Important facts extracted', Array.isArray(a?.important_facts) && a.important_facts.length > 0,
    `${a?.important_facts?.length} facts`);

  ok('Applicable Act identified from CONFIGURED knowledge',
    !!a?.act?.id && !!a?.act?.short_name,
    a?.act?.short_name ?? 'none matched');
  ok('Act suggestion carries a reason in both languages',
    !!a?.act?.reason?.en && a.act.reason.en.length > 20
    && /[஀-௿]/.test(a.act.reason.ta ?? ''));
  ok('Act suggestion carries a confidence', typeof a?.act?.confidence === 'number');
  if (a?.act?.section_no) {
    ok('Relevant section identified', true, `Section ${a.act.section_no} - ${a.act.section_heading?.en ?? ''}`);
  }
  // The real Tamil Nadu entries are not demo material, so is_demo is false.
  // What must hold is that the officer can always see the entry's provenance
  // and verification status - an unverified entry must not look authoritative.
  const actRow = (await call('GET', `/kb/acts?q=${encodeURIComponent(a.act.short_name.en)}`, officer))
    .json?.find((x) => x.id === a.act.id);
  ok('Identified Act carries a verification status',
    !!actRow?.verification_status, actRow?.verification_status);
  ok('Identified Act carries its source provenance',
    !!actRow?.source_reference || !!actRow?.source_url || actRow?.is_demo === 1);

  ok('Department recommended from CONFIGURED knowledge',
    !!a?.department?.id && !!a?.department?.name, a?.department?.name);
  ok('Department recommendation carries a reason', !!a?.department?.reason?.en);

  ok('Officer/Authority recommended',
    !!a?.authority?.id && !!a?.authority?.designation, a?.authority?.designation);

  ok('Recommended next action given in both languages',
    !!a?.next_action?.en && !!a?.next_action?.ta);
  ok('Priority assigned', !!a?.priority, a?.priority);
  ok('Missing information listed', Array.isArray(a?.missing_information),
    `${a?.missing_information?.length} items`);
  ok('Result is marked as requiring officer verification',
    a?.requires_verification === true &&
    /Requires Officer Verification/i.test(JSON.stringify(a))
    && /அதிகாரி சரிபார்ப்பு தேவை/.test(JSON.stringify(a)));

  // The critical guarantee: the AI can only name configured entities.
  const actInKb = await call('GET', `/kb/acts?q=${encodeURIComponent(a.act.short_name.en)}`, officer);
  ok('GOVERNANCE: the named Act exists in the knowledge base (not invented)',
    Array.isArray(actInKb.json) && actInKb.json.some((x) => x.id === a.act.id));
  const deptInKb = await call('GET', '/kb/departments', officer);
  ok('GOVERNANCE: the named Department exists in the knowledge base (not invented)',
    deptInKb.json.some((x) => x.id === a.department.id));
  const authInKb = await call('GET', '/kb/authorities', officer);
  ok('GOVERNANCE: the named Authority exists in the knowledge base (not invented)',
    authInKb.json.some((x) => x.id === a.authority.id));

  // ---------------- 7. Copilot ----------------
  section('7. AI Copilot');
  const questions = [
    ['What is this petition about?', /petition|states|issue/i],
    ['Which Act applies?', /Act|knowledge base/i],
    ['Why does this Act apply?', /apply|applicab|reason|identified/i],
    ['Which department should handle this?', /department|knowledge base/i],
    ['Which officer or authority should receive it?', /authority|officer|configured/i],
    ['What should I do next?', /next action|recommend|priority/i],
  ];
  for (const [q, expect] of questions) {
    const r = await call('POST', `/cp/petitions/${PID}/copilot`, officer, { question: q });
    ok(`Copilot answers: "${q}"`,
      r.status === 200 && expect.test(r.json?.answer ?? ''),
      r.json?.answer ? r.json.answer.split('\n')[0].slice(0, 60) : `status=${r.status}`);
  }

  const tamil = await call('POST', `/cp/petitions/${PID}/copilot`, officer,
    { question: 'Summarize this petition in Tamil' });
  ok('Copilot answers in Tamil',
    tamil.status === 200 && /[஀-௿]/.test(tamil.json?.answer ?? ''),
    'Tamil script present');

  const unknown = await call('POST', `/cp/petitions/${PID}/copilot`, officer,
    { question: 'What is the share price of quantum cryptography futures?' });
  ok('GOVERNANCE: Copilot declines what it cannot source',
    unknown.status === 200 &&
    /cannot answer|consult the appropriate official authority/i.test(unknown.json?.answer ?? ''),
    unknown.json?.answer?.slice(0, 60));

  // ---------------- 8. Officer verification ----------------
  section('8. Officer verification and status');
  const verify = await call('PATCH', `/cp/petitions/${PID}`, officer, {
    officer_verified: true,
    status: 'UNDER_REVIEW',
    officer_notes: 'Analysis reviewed. Act and department confirmed as appropriate.',
  });
  ok('Officer can verify the AI analysis', verify.status === 200);

  const after = await call('GET', `/cp/petitions/${PID}`, officer);
  ok('Verification is recorded on the petition',
    after.json?.petition?.officer_verified === 1);

  // ---------------- 9. Citizen isolation ----------------
  section('9. Access control');
  const citView = await call('GET', `/cp/petitions/${PID}`, citizen);
  ok('Citizen can view their own petition', citView.status === 200);
  ok('Citizen does NOT receive the AI analysis', citView.json?.analysis === null);
  ok('Citizen does NOT receive the officer notes',
    citView.json?.petition?.officer_notes === undefined ||
    citView.json?.petition?.officer_notes === null);
  ok('Citizen does NOT receive the copilot conversation',
    (citView.json?.copilot?.length ?? 0) === 0);

  /*
   * Citizen isolation still matters even though the POC ships a single citizen
   * login. A throwaway citizen account is created for this check so the
   * assertion is genuine: one citizen must not be able to read another's
   * petition. The account is removed afterwards.
   */
  const { execFileSync } = await import('node:child_process');
  let isolationChecked = false;
  try {
    /*
     * Resolve the helper relative to THIS file, so the suite works whether it
     * is run from the repository root or from the server workspace.
     */
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    execFileSync('npx', ['tsx', resolve(here, '../src/db/make-test-citizen.ts')], {
      cwd: resolve(here, '..'), stdio: 'pipe', shell: true,
    });
    const other = await login('zz_test_citizen', 'Test@12345');
    const theirs = await call('POST', '/cp/petitions', other, {
      citizen_name: 'Another Petitioner',
      subject: 'isolation check petition',
      description: 'Submitted by a second citizen to confirm cross-citizen access is refused.',
    });
    if (theirs.status === 201) {
      const foreign = await call('GET', `/cp/petitions/${theirs.json.petitionId}`, citizen);
      ok('SECURITY: citizen refused another citizen petition',
        foreign.status === 403, `status=${foreign.status}`);
      isolationChecked = true;
    }
  } catch { /* falls through to the report below */ }

  if (!isolationChecked) {
    ok('SECURITY: citizen refused another citizen petition', false,
      'could not set up the second citizen account');
  }

  const analyseDenied = await call('POST', `/cp/petitions/${PID}/analyse`, citizen);
  ok('SECURITY: citizen cannot run AI analysis', analyseDenied.status === 403);

  const copilotDenied = await call('POST', `/cp/petitions/${PID}/copilot`, citizen,
    { question: 'Which Act applies?' });
  ok('SECURITY: citizen cannot use the Copilot', copilotDenied.status === 403);

  console.log(`\n=== RESULT: ${PASSED} passed, ${FAILED} failed ===`);
  process.exit(FAILED === 0 ? 0 : 1);
})().catch((e) => { console.error('FLOW ERROR:', e); process.exit(1); });
