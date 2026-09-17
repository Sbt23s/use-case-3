import { db, initSchema } from './core/db.js';
import { runGlobalCopilot } from './ai/agents/eGovCopilot.js';
import { runAnalysis } from './ai/agents/analyzer.js';
import { MockAIProvider } from './ai/mockProvider.js';

async function test() {
  initSchema();

  console.log('=== TEST 1: Database Act Counts & Schema ===');
  const count = (db.prepare('SELECT COUNT(*) n FROM kb_act WHERE active = 1').get() as any).n;
  console.log('Active Acts count:', count);

  const sample = db.prepare('SELECT short_name, short_name_ta, section, rules, authority, petition_type, workflow, official_source, verification_status, last_verified_date FROM kb_act WHERE short_name LIKE ?').get('%Panchayats%') as any;
  console.log('Sample Act (Panchayats):', JSON.stringify(sample, null, 2));

  console.log('\n=== TEST 2: e-Gov Copilot Query in Tamil ===');
  const mockProvider = new MockAIProvider();
  const resTa = await runGlobalCopilot(
    mockProvider,
    'தமிழ்நாடு ஊராட்சிகள் சட்டம் 1994 கீழ் என்ன விதிகள் மற்றும் நடைமுறை உள்ளது?',
    undefined,
    { lang: 'ta' }
  );
  console.log('Copilot Tamil Answer:\n', resTa.data.answer);
  console.log('Copilot Sources:\n', JSON.stringify(resTa.data.sources, null, 2));

  console.log('\n=== TEST 3: e-Gov Copilot Query in English (Land Encroachment) ===');
  const resEn = await runGlobalCopilot(
    mockProvider,
    'Which Act, authority and workflow apply to government land encroachment?',
    undefined,
    { lang: 'en' }
  );
  console.log('Copilot English Answer:\n', resEn.data.answer);
  console.log('Copilot Sources:\n', JSON.stringify(resEn.data.sources, null, 2));

  console.log('\n=== TEST 4: AI Analyzer on Tamil Petition ===');
  const testPetition: any = {
    id: 9999,
    reference_no: 'PET-TEST-100',
    citizen_name: 'முருகேசன்',
    citizen_phone: '9876543210',
    citizen_address: 'மேலூர் கிராமம், மதுரை',
    subject: 'கிராம பஞ்சாயத்து குடிநீர் மற்றும் தெருவிளக்கு பிரச்சனை',
    description: 'எங்கள் கிராமத்தில் கடந்த இரண்டு மாதங்களாக குடிநீர் வரவில்லை. தெருவிளக்குகளும் எரியவில்லை. பிடிஓ அலுவலகத்தில் மனு கொடுத்தும் நடவடிக்கை இல்லை.',
    language: 'ta',
    documents: [],
  };

  const analysis = await runAnalysis(mockProvider, testPetition as any);
  console.log('Identified Act:', (analysis as any).act?.short_name);
  console.log('Workflow Steps:', (analysis as any).workflow?.map((w: any) => w.ta));

  console.log('\nAll tests executed successfully!');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
