const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../data/gov.db'));
const rows = db.prepare('SELECT * FROM system_config').all();
console.log('system_config rows:', rows);
