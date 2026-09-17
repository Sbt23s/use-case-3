async function verifyProxy() {
  console.log('Testing via Vite proxy http://localhost:5173 ...');
  try {
    const loginRes = await fetch('http://localhost:5173/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'gro', password: 'Officer@123' })
    });
    console.log('1. Vite Proxy Login status:', loginRes.status);
    const loginData = await loginRes.json();
    console.log('   Token:', loginData.token ? 'Present' : 'None');

    const meRes = await fetch('http://localhost:5173/api/auth/me', {
      headers: { Authorization: `Bearer ${loginData.token}` }
    });
    console.log('2. Vite Proxy /auth/me status:', meRes.status);
    const meData = await meRes.json();
    console.log('   User:', meData.user?.fullName);

    const petitionsRes = await fetch('http://localhost:5173/api/cp/petitions?page=1&limit=5&lang=ta', {
      headers: { Authorization: `Bearer ${loginData.token}` }
    });
    console.log('3. Vite Proxy Petitions status:', petitionsRes.status);
    const petitionsData = await petitionsRes.json();
    console.log('   Count:', petitionsData.rows?.length);

    const statsRes = await fetch('http://localhost:5173/api/cp/stats', {
      headers: { Authorization: `Bearer ${loginData.token}` }
    });
    console.log('4. Vite Proxy Stats status:', statsRes.status);
    const statsData = await statsRes.json();
    console.log('   Total in stats:', statsData.total ?? statsData.byStatus);

    const detailRes = await fetch('http://localhost:5173/api/cp/petitions/1261?lang=ta', {
      headers: { Authorization: `Bearer ${loginData.token}` }
    });
    console.log('5. Vite Proxy Petition Detail (1261, lang=ta) status:', detailRes.status);
    const detailData = await detailRes.json();
    console.log('   Subject display:', detailData.petition?.subject_display || detailData.petition?.subject);

    const streamRes = await fetch(`http://localhost:5173/api/cp/stream?token=${encodeURIComponent(loginData.token)}`);
    console.log('6. Vite Proxy SSE Stream status:', streamRes.status);
  } catch (err) {
    console.error('Vite Proxy Error:', err);
  }
}
verifyProxy();
