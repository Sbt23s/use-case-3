import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env') });
import { getProvider } from './ai/gateway.js';
import { runGlobalCopilot, type CopilotTurn } from './ai/agents/eGovCopilot.js';

async function runTest() {
  const provider = getProvider();
  console.log(`[Test] Using AI Provider: ${provider.name}, Model: ${provider.model}`);

  // Test 1: TN Welfare Scheme Query (English)
  console.log('\n======================================================');
  console.log('TEST 1: TN Scheme Query: "What is Kalaignar Magalir Urimai Thogai scheme and who is eligible?"');
  console.log('======================================================');
  const res1 = await runGlobalCopilot(provider, 'What is Kalaignar Magalir Urimai Thogai scheme and who is eligible?', undefined, { lang: 'en' });
  console.log('Answer:\n', res1.data.answer);
  console.log('\nWeb Sources Count:', res1.data.webSources?.length);
  if (res1.data.webSources?.length) {
    console.log('Web Sources:', res1.data.webSources.map(s => `${s.title} (${s.url})`).join('\n'));
  }

  // Test 2: Tanglish Citizen Certificate Query with follow-up
  console.log('\n======================================================');
  console.log('TEST 2: Tanglish Certificate Query: "Legal heir certificate apply panna enna documents venum?"');
  console.log('======================================================');
  const history: CopilotTurn[] = [];
  const res2 = await runGlobalCopilot(provider, 'Legal heir certificate apply panna enna documents venum?', undefined, { history, lang: 'tanglish' });
  console.log('Tanglish Answer:\n', res2.data.answer);
  history.push({ role: 'USER', content: 'Legal heir certificate apply panna enna documents venum?' });
  history.push({ role: 'ASSISTANT', content: res2.data.answer });

  // Test 2b: Follow-up question using conversation context
  console.log('\n======================================================');
  console.log('TEST 2b: Tanglish Follow-up Query: "Adhu online-la eppadi apply panradhu?"');
  console.log('======================================================');
  const res2b = await runGlobalCopilot(provider, 'Adhu online-la eppadi apply panradhu?', undefined, { history, lang: 'tanglish' });
  console.log('Follow-up Answer:\n', res2b.data.answer);

  // Test 3: Universal Non-Government Query (Science / Tech)
  console.log('\n======================================================');
  console.log('TEST 3: Universal Non-Gov Query: "Explain quantum entanglement in simple terms"');
  console.log('======================================================');
  const res3 = await runGlobalCopilot(provider, 'Explain quantum entanglement in simple terms', undefined, { lang: 'en' });
  console.log('Science Answer:\n', res3.data.answer);

  // Test 4: Anti-Hallucination on Unverified / Fake Scheme
  console.log('\n======================================================');
  console.log('TEST 4: Unverified Query: "Tell me about the secret flying car subsidy scheme of Tamil Nadu government 2026"');
  console.log('======================================================');
  const res4 = await runGlobalCopilot(provider, 'Tell me about the secret flying car subsidy scheme of Tamil Nadu government 2026', undefined, { lang: 'en' });
  console.log('Unverified Answer:\n', res4.data.answer);
}

runTest().catch(console.error);
