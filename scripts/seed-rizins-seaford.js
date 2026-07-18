require('dotenv').config();
const { pool } = require('../src/config/database');
const { hashPassword } = require('../src/services/authService');

const STORE_ID = 'd849d8b6-5bee-404a-afa3-db4d0dfc8ee0'; // Rizin's Seaford (formerly Store A)

const newEmployees = [
  { user_id: 'emp001', first: 'Harry',  last: '',    wage: 16.60 },
  { user_id: 'emp002', first: 'Billy',  last: '',    wage: 19.90 },
  { user_id: 'emp003', first: 'Kyra',   last: '',    wage: 19.90 },
  { user_id: 'emp013', first: 'Sabin',  last: '',    wage: 20.00 },
  { user_id: 'emp014', first: 'Shabas', last: '',    wage: 23.00 },
  { user_id: 'emp015', first: 'Ashwin', last: '',    wage: 23.00 },
  { user_id: 'emp016', first: 'Ashin',  last: 'Das', wage: 23.00 },
  { user_id: 'emp017', first: 'Thejus', last: '',    wage: 23.00 },
  { user_id: 'emp018', first: 'Javad',  last: 'Ali', wage: 23.00 },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const emp of newEmployees) {
      const hash = await hashPassword('123');
      const email = `${emp.user_id}@rizinsseaford.local`;

      const res = await client.query(
        `INSERT INTO users (user_id, password_hash, role, first_name, last_name, email, hourly_wage, employment_type, is_active)
         VALUES ($1, $2, 'employee', $3, $4, $5, $6, 'permanent', true)
         RETURNING id`,
        [emp.user_id, hash, emp.first, emp.last, email, emp.wage]
      );
      const employeeId = res.rows[0].id;

      await client.query(
        `INSERT INTO store_employee_assignments (store_id, employee_id) VALUES ($1, $2)`,
        [STORE_ID, employeeId]
      );

      console.log(`Created ${emp.user_id}: ${emp.first} ${emp.last} — $${emp.wage.toFixed(2)}/hr`);
    }

    await client.query('COMMIT');
    console.log('\nAll 9 employees created and assigned to Rizin\'s Seaford.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
