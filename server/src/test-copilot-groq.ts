import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env') });
import { getProvider } from './ai/gateway.js';
import { runGlobalCopilot } from './ai/agents/eGovCopilot.js';

async function testCopilotBoth() {
  const provider = getProvider();

  console.log('--- 1. Testing English Query ---');
  const resEn = await runGlobalCopilot(provider, 'Tamil Nadu Slum Areas Act', undefined, { lang: 'en' });
  console.log('English Answer:\n', resEn.data.answer.slice(0, 250));

  console.log('\n--- 2. Testing Tamil Query ---');
  const resTa = await runGlobalCopilot(provider, 'தமிழ்நாடு ஊராட்சிகள் சட்டம் 1994 கீழ் என்ன விதிகள் உள்ளது?', undefined, { lang: 'ta' });
  console.log('Tamil Answer:\n', resTa.data.answer.slice(0, 250));
}
testCopilotBoth();
