import { getProvider } from './ai/gateway.js';
import { runGlobalCopilot } from './ai/agents/eGovCopilot.js';

async function testCopilot() {
  console.log('Testing Copilot with English query: "Tamil Nadu Slum Areas Act"...');
  const provider = getProvider();
  console.log('Using provider:', provider.name, 'model:', provider.model);

  try {
    const result = await runGlobalCopilot(provider, 'Tamil Nadu Slum Areas Act', undefined, { lang: 'en' });
    console.log('Result Answer:\n', result.data.answer);
    console.log('Sources:', result.data.sources);
  } catch (err) {
    console.error('Copilot threw error:', err);
  }
}

testCopilot();
