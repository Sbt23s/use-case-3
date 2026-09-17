import { db } from './core/db.js';
import { displayName } from './core/translit.js';

db.function('translit_en', (str: string) => {
  if (!str) return '';
  return displayName(str, 'en');
});

function searchPetitions(q: string) {
  const cleanQ = q.trim();
  const noHash = cleanQ.startsWith('#') ? cleanQ.slice(1).trim() : cleanQ;

  const whereClause = `
    WHERE IFNULL(p.origin, 'PETITION') = 'PETITION'
    AND (
      p.reference_no LIKE ?
      OR p.subject LIKE ?
      OR p.citizen_name LIKE ?
      OR translit_en(p.citizen_name) LIKE ?
      OR p.citizen_phone LIKE ?
      OR CAST(p.id AS TEXT) LIKE ?
      OR p.status LIKE ?
      OR p.analysis_status LIKE ?
      OR dept.name LIKE ?
      OR dept.name_ta LIKE ?
      OR act.short_name LIKE ?
      OR act.short_name_ta LIKE ?
      OR a.main_issue LIKE ?
      OR a.result_json LIKE ?
      OR tc.translated LIKE ?
    )
  `;

  const term = `%${cleanQ}%`;
  const noHashTerm = `%${noHash}%`;
  const params = [
    noHashTerm, // p.reference_no
    term,       // p.subject
    term,       // p.citizen_name
    term,       // translit_en(p.citizen_name)
    term,       // p.citizen_phone
    noHashTerm, // p.id
    term,       // p.status
    term,       // p.analysis_status
    term,       // dept.name
    term,       // dept.name_ta
    term,       // act.short_name
    term,       // act.short_name_ta
    term,       // a.main_issue
    term,       // a.result_json
    term,       // tc.translated
  ];

  const countRow = db.prepare(`
    SELECT COUNT(DISTINCT p.id) AS total
    FROM cp_petition p
    LEFT JOIN (
      SELECT a1.petition_id, a1.department_id, a1.act_id, a1.main_issue, a1.result_json
      FROM cp_analysis a1
      INNER JOIN (SELECT petition_id, MAX(id) AS max_id FROM cp_analysis GROUP BY petition_id) a2 ON a1.id = a2.max_id
    ) a ON a.petition_id = p.id
    LEFT JOIN kb_department dept ON dept.id = a.department_id
    LEFT JOIN kb_act act ON act.id = a.act_id
    LEFT JOIN translation_cache tc ON tc.source_text = p.subject
    ${whereClause}
  `).get(...params) as any;

  const rows = db.prepare(`
    SELECT p.id, p.reference_no, p.citizen_name, translit_en(p.citizen_name) as citizen_en, p.subject, p.status,
      dept.name AS suggested_department,
      act.short_name AS suggested_act
    FROM cp_petition p
    LEFT JOIN (
      SELECT a1.petition_id, a1.department_id, a1.act_id, a1.main_issue, a1.result_json
      FROM cp_analysis a1
      INNER JOIN (SELECT petition_id, MAX(id) AS max_id FROM cp_analysis GROUP BY petition_id) a2 ON a1.id = a2.max_id
    ) a ON a.petition_id = p.id
    LEFT JOIN kb_department dept ON dept.id = a.department_id
    LEFT JOIN kb_act act ON act.id = a.act_id
    LEFT JOIN translation_cache tc ON tc.source_text = p.subject
    ${whereClause}
    GROUP BY p.id
    ORDER BY p.id DESC
    LIMIT 3
  `).all(...params);

  return { total: countRow.total, rows };
}

const testTerms = [
  'Harees',
  'Municipal',
  'street lights',
  '1266',
  '9344174752',
  'Chethu',
  'Rural',
  'Analysed',
  'darkness',
  'safety',
  'Panchayat',
  'Senior citizen'
];

for (const term of testTerms) {
  const res = searchPetitions(term);
  console.log(`Search "${term}" -> Total found: ${res.total}`);
  if (res.rows.length) {
    console.log(`  Match: #${res.rows[0].id} | ${res.rows[0].reference_no} | ${res.rows[0].citizen_en} | ${res.rows[0].suggested_department}`);
  }
}





