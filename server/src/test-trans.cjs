const { translateText } = require('./server/dist/core/translate.js');

async function testTrans() {
  const tamilSubject = 'மூத்த குடிமக்கள் - பாதுகாப்பு மற்றும் பராமரிப்புச் சட்டம் 2007 —_ பிரிவு 23 - கோயம்புத்தூர் மாவட்டம் வழுக்குப்பாறை, நாச்சிபாளையம், நெ. 1108 என்ற முகவரியில் வசித்து வரும் திருமதி. அய்யாத்தாள் கபெ ர் குப்புசாமி தனது மகன் ஆ';
  console.log('Testing translateText to English...');
  try {
    const res = await translateText(tamilSubject, 'en');
    console.log('Result:', res);
  } catch(e) {
    console.error('Error:', e);
  }
}
testTrans();
