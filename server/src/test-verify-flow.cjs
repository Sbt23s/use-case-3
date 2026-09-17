async function verify() {
  const loginRes = await fetch('http://127.0.0.1:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gro', password: 'Officer@123' })
  });
  const loginData = await loginRes.json();
  console.log('1. Login status:', loginRes.status, 'Token:', loginData.token ? 'Present' : 'None');

  const petitionsRes = await fetch('http://127.0.0.1:4000/api/cp/petitions?page=1&limit=5&lang=ta', {
    headers: { Authorization: `Bearer ${loginData.token}` }
  });
  const petitionsData = await petitionsRes.json();
  console.log('2. Petitions status:', petitionsRes.status, 'Count:', petitionsData.rows?.length);

  if (petitionsData.rows && petitionsData.rows.length > 0) {
    const detailRes = await fetch(`http://127.0.0.1:4000/api/cp/petitions/${petitionsData.rows[0].id}?lang=ta`, {
      headers: { Authorization: `Bearer ${loginData.token}` }
    });
    console.log('3. Petition detail with lang=ta status:', detailRes.status);
    const detailData = await detailRes.json();
    console.log('   Petition ID:', detailData.petition?.id, 'Subject:', detailData.petition?.subject_display || detailData.petition?.subject);
  }
}
verify().catch(console.error);
