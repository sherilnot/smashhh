require('dotenv').config();
const { pool } = require('../src/config/database');
const { verifyPassword } = require('../src/services/authService');
async function test() {
  const res = await pool.query("SELECT user_id, password_hash FROM users WHERE user_id = 'manager_dandenong'");
  if (!res.rows.length) { console.log('USER NOT FOUND'); await pool.end(); return; }
  console.log('User found:', res.rows[0].user_id);
  console.log('Hash prefix:', res.rows[0].password_hash.substring(0, 20));
  const match = await verifyPassword('123', res.rows[0].password_hash);
  console.log('Password 123 match:', match);
  await pool.end();
}
test().catch(e => { console.error(e.message); process.exit(1); });
