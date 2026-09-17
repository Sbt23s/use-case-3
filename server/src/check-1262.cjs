const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../data/gov.db'));

const p = db.prepare('SELECT id, reference_no, subject, citizen_name FROM cp_petition WHERE id = 1262').get();
console.log('Petition 1262:', p);

const a = db.prepare('SELECT id, result_json FROM cp_analysis WHERE petition_id = 1262').get();
if (a && a.result_json) {
  const parsed = JSON.parse(a.result_json);
  console.log('main_issue:', JSON.stringify(parsed.main_issue, null, 2));
  console.log('important_facts:', JSON.stringify(parsed.important_facts, null, 2));
  console.log('entities:', JSON.stringify(parsed.entities, null, 2));
} else {
  console.log('No analysis found for 1262');
}
