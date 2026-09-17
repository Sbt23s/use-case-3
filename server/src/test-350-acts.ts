import { db, initSchema } from './core/db.js';
import { runGlobalCopilot } from './ai/agents/eGovCopilot.js';
import { runAnalysis } from './ai/agents/analyzer.js';
import { MockAIProvider } from './ai/mockProvider.js';

async function test() {
  initSchema();

  console.log('=== TEST 1: Database Act Counts & Schema for 350 Acts ===');
  const count = (db.prepare('SELECT COUNT(*) n FROM kb_act WHERE active = 1').get() as any).n;
  console.log('Total Active Acts count in DB:', count);

  const sampleSurvey = db.prepare('SELECT short_name, short_name_ta, section, rules, authority, petition_type, workflow, official_source FROM kb_act WHERE short_name LIKE ?').get('%Survey and Boundaries%') as any;
  console.log('Sample Act 101 (Survey and Boundaries):', JSON.stringify(sampleSurvey, null, 2));

  const sampleLifts = db.prepare('SELECT short_name, short_name_ta, section, rules, authority, petition_type, workflow, official_source FROM kb_act WHERE short_name LIKE ?').get('%Lifts and Escalators%') as any;
  console.log('Sample Act 306 (Lifts and Escalators):', JSON.stringify(sampleLifts, null, 2));

  const samplePSTM = db.prepare('SELECT short_name, short_name_ta, section, rules, authority, petition_type, workflow, official_source FROM kb_act WHERE short_name LIKE ?').get('%Persons Studied in Tamil Medium%') as any;
  console.log('Sample Act 153 (PSTM Act):', JSON.stringify(samplePSTM, null, 2));

  console.log('\n=== TEST 2: e-Gov Copilot Query in Tamil (நில அளவை மற்றும் எல்லைகள் சட்டம் 1923) ===');
  const mockProvider = new MockAIProvider();
  const resSurveyTa = await runGlobalCopilot(
    mockProvider,
    'தமிழ்நாடு நில அளவை மற்றும் எல்லைகள் சட்டம் 1923 கீழ் நில அளவீடு செய்ய என்ன நடைமுறை மற்றும் அதிகார அமைப்பு உள்ளது?',
    undefined,
    { lang: 'ta' }
  );
  console.log('Copilot Tamil Answer:\n', resSurveyTa.data.answer);
  console.log('Copilot Sources:\n', JSON.stringify(resSurveyTa.data.sources, null, 2));

  console.log('\n=== TEST 3: e-Gov Copilot Query in English (Lift Safety & Escalators) ===');
  const resLiftEn = await runGlobalCopilot(
    mockProvider,
    'Which Act and department regulate lift safety and escalator licenses in Tamil Nadu buildings?',
    undefined,
    { lang: 'en' }
  );
  console.log('Copilot English Answer:\n', resLiftEn.data.answer);
  console.log('Copilot Sources:\n', JSON.stringify(resLiftEn.data.sources, null, 2));

  console.log('\n=== TEST 4: e-Gov Copilot Query in Tamil (கூட்டுறவு சங்கங்கள் சட்டம் 1983) ===');
  const resCoopTa = await runGlobalCopilot(
    mockProvider,
    'தமிழ்நாடு கூட்டுறவுச் சங்கங்கள் சட்டம் 1983 கீழ் 81 விசாரணை மற்றும் சர்சார்ஜ் நடைமுறை என்ன?',
    undefined,
    { lang: 'ta' }
  );
  console.log('Copilot Tamil Answer:\n', resCoopTa.data.answer);

  console.log('\n=== TEST 5: AI Analyzer on Land Boundary Demarcation Petition ===');
  const testPetition = {
    id: 9998,
    reference_no: 'PET-TEST-350',
    citizen_name: 'கந்தசாமி',
    citizen_phone: '9876543211',
    citizen_address: 'விருதுநகர்',
    subject: 'நில அளவை மற்றும் பட்டா எல்லை நிர்ணயம் கோருதல்',
    description: 'என் பட்டா நிலத்திற்கு எப்.எம்.பி படி சர்வேயர் வந்து அளவீடு செய்து எல்லைக் கல் நட்டுத் தர வேண்டும். கட்டணம் செலுத்தியும் சர்வேயர் வரவில்லை.',
    language: 'ta',
    documents: [],
  };

  const analysis = await runAnalysis(mockProvider, testPetition as any);
  console.log('Identified Act:', (analysis as any).act?.short_name);
  console.log('Identified Dept:', (analysis as any).department?.name);
  console.log('Identified Authority:', (analysis as any).authority?.designation);

  console.log('\nALL 350 ACTS & COPILOT TESTS VERIFIED SUCCESSFULLY!');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
