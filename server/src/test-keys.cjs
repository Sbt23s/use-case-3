require('dotenv').config({ path: './server/.env' });
const GroqKey = process.env.GROQ_API_KEY;
const GeminiKey = process.env.GEMINI_API_KEY;

async function testKeys() {
  console.log('Testing Groq key:', GroqKey ? 'Configured' : 'Missing');
  if (GroqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${GroqKey}` }
      });
      const data = await res.json();
      console.log('Groq models:', res.status, data.data?.map(m => m.id).filter(id => !id.includes('whisper')));
    } catch(e) {
      console.error('Groq err:', e.message);
    }
  }

  console.log('Testing Gemini key:', GeminiKey ? 'Configured' : 'Missing');
  if (GeminiKey) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GeminiKey}`);
      const data = await res.json();
      console.log('Gemini models status:', res.status, data.models ? data.models.length : data.error?.message);
    } catch(e) {
      console.error('Gemini err:', e.message);
    }
  }
}
testKeys();
