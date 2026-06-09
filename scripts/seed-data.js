require('dotenv').config();
const { pool } = require('../src/config/database');
const { hashPassword } = require('../src/services/authService');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Seed users
    const users = [
      { user_id: 'emp001', password: 'Employee123!', role: 'employee', first: 'Alice', last: 'Smith', email: 'alice@example.com', wage: 15.50 },
      { user_id: 'emp002', password: 'Employee123!', role: 'employee', first: 'Bob', last: 'Jones', email: 'bob@example.com', wage: 17.00 },
      { user_id: 'mgr001', password: 'Manager123!', role: 'store_manager', first: 'Carol', last: 'White', email: 'carol@example.com', wage: null },
      { user_id: 'wh001',  password: 'Warehouse123!', role: 'warehouse_manager', first: 'Dave', last: 'Brown', email: 'dave@example.com', wage: null },
    ];

    const userIds = {};
    for (const u of users) {
      const hash = await hashPassword(u.password);
      const res = await client.query(
        `INSERT INTO users (user_id, password_hash, role, first_name, last_name, email, hourly_wage)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
        [u.user_id, hash, u.role, u.first, u.last, u.email, u.wage]
      );
      userIds[u.user_id] = res.rows[0].id;
      console.log(`[Seed] User: ${u.user_id} (${u.role})`);
    }

    // Seed shifts for next 14 days
    const locations = ['Store A', 'Store B', 'Store C'];
    const now = new Date();
    for (let d = 1; d <= 14; d++) {
      for (const loc of locations) {
        const start = new Date(now);
        start.setDate(now.getDate() + d);
        start.setHours(9, 0, 0, 0);
        const end = new Date(start);
        end.setHours(17, 0, 0, 0);
        await client.query(
          `INSERT INTO shifts (start_time, end_time, store_location, capacity) VALUES ($1, $2, $3, $4)`,
          [start, end, loc, 3]
        );
      }
    }
    console.log(`[Seed] Created ${14 * locations.length} shifts`);

    // Seed products
    const products = ['Linen Boxy Tee', 'Wide Leg Trousers', 'Structured Blazer', 'Cotton Dress', 'Denim Jacket'];
    const productIds = [];
    for (const name of products) {
      const res = await client.query(
        `INSERT INTO products (product_name, product_code, unit_price) VALUES ($1, $2, $3)
         ON CONFLICT (product_code) DO NOTHING RETURNING id`,
        [name, name.toLowerCase().replace(/\s+/g, '-'), 0]
      );
      if (res.rows.length) productIds.push(res.rows[0].id);
    }
    console.log(`[Seed] Products: ${productIds.length}`);

    // Seed expected deliveries for tomorrow (for testing nightly checklist)
    if (productIds.length && userIds['wh001']) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      for (const pid of productIds) {
        await client.query(
          `INSERT INTO expected_deliveries (product_id, warehouse_manager_id, expected_quantity, expected_date)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [pid, userIds['wh001'], 50, tomorrow]
        );
      }
      console.log(`[Seed] Expected deliveries for tomorrow: ${productIds.length}`);
    }

    await client.query('COMMIT');
    console.log('\n[Seed] Done! Test credentials:');
    console.log('  Employee:          emp001 / Employee123!');
    console.log('  Store Manager:     mgr001 / Manager123!');
    console.log('  Warehouse Manager: wh001  / Warehouse123!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Seed] Failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
