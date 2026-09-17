/**
 * Creates a throwaway second citizen account used by the automated test to
 * verify that one citizen cannot read another citizen's petition.
 *
 * Kept out of the seed deliberately: the POC ships two logins, and a stray
 * third account on the sign-in screen would be confusing. The test creates it
 * and it exists only for that purpose.
 */
import { db, initSchema } from '../core/db.js';
import { hashPassword } from '../core/auth.js';

initSchema();

const USERNAME = 'zz_test_citizen';
const { hash, salt } = hashPassword('Test@12345');

db.prepare(
  'INSERT OR IGNORE INTO app_user (username, full_name, password_hash, password_salt) VALUES (?, ?, ?, ?)',
).run(USERNAME, 'Automated Test Citizen', hash, salt);
db.prepare('UPDATE app_user SET password_hash = ?, password_salt = ? WHERE username = ?')
  .run(hash, salt, USERNAME);

const u = db.prepare('SELECT id FROM app_user WHERE username = ?').get(USERNAME) as any;
db.prepare("INSERT OR IGNORE INTO user_role (user_id, role_id) SELECT ?, id FROM role WHERE code = 'CITIZEN'")
  .run(u.id);

console.log(`test citizen ready (id ${u.id})`);
