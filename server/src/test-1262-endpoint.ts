async function testEndpoint() {
  const loginRes = await fetch('http://127.0.0.1:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gro', password: 'Officer@123' })
  });
  const { token } = await loginRes.json();

  console.log('Testing GET /api/cp/petitions/1262?lang=en ...');
  const res = await fetch('http://127.0.0.1:4000/api/cp/petitions/1262?lang=en', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  console.log('petition.subject:', data.petition?.subject);
  console.log('petition.subject_display:', data.petition?.subject_display);
  console.log('analysis.main_issue:', data.analysis?.full?.main_issue);
  console.log('analysis.important_facts:', data.analysis?.full?.important_facts);
  console.log('analysis.entities:', data.analysis?.full?.entities);
}
testEndpoint();
