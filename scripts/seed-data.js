require('dotenv').config();
const { pool } = require('../src/config/database');
const { hashPassword } = require('../src/services/authService');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Seed users (4 managers — one per store, pre-assigned below)
    const users = [
      { user_id: 'emp001', password: 'jjj', role: 'employee', first: 'Alice', last: 'Smith', email: 'alice@example.com', wage: 15.50 },
      { user_id: 'emp002', password: 'Employee123!', role: 'employee', first: 'Bob', last: 'Jones', email: 'bob@example.com', wage: 17.00 },
      { user_id: 'emp003', password: 'Employee123!', role: 'employee', first: 'Eve', last: 'Taylor', email: 'eve@example.com', wage: 16.00 },
      { user_id: 'mgr001', password: 'Manager123!', role: 'store_manager', first: 'Carol', last: 'White', email: 'carol@example.com', wage: null },
      { user_id: 'mgr002', password: 'Manager123!', role: 'store_manager', first: 'Frank', last: 'Garcia', email: 'frank@example.com', wage: null },
      { user_id: 'mgr003', password: 'Manager123!', role: 'store_manager', first: 'Grace', last: 'Lee', email: 'grace@example.com', wage: null },
      { user_id: 'mgr004', password: 'Manager123!', role: 'store_manager', first: 'Henry', last: 'Patel', email: 'henry@example.com', wage: null },
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

    // Seed 4 stores — each one pre-assigned to a manager (no manual assignment needed)
    const storeConfig = [
      { name: 'Store A', manager: 'mgr001' },
      { name: 'Store B', manager: 'mgr002' },
      { name: 'Store C', manager: 'mgr003' },
      { name: 'Store D', manager: 'mgr004' },
    ];
    const storeIds = {};
    for (const { name, manager } of storeConfig) {
      const res = await client.query(
        `INSERT INTO stores (name) VALUES ($1)
         ON CONFLICT DO NOTHING RETURNING id`,
        [name]
      );
      if (res.rows.length) {
        storeIds[name] = res.rows[0].id;
      } else {
        const existing = await client.query(`SELECT id FROM stores WHERE name = $1`, [name]);
        storeIds[name] = existing.rows[0].id;
      }
      // Auto-assign the manager to this store
      if (userIds[manager]) {
        await client.query(
          `INSERT INTO store_manager_assignments (store_id, manager_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [storeIds[name], userIds[manager]]
        );
      }
    }
    console.log(`[Seed] Stores: ${Object.keys(storeIds).length} (each with a pre-assigned manager)`);

    // Seed shifts for next 14 days (with store_id assigned)
    const storeNames = storeConfig.map(s => s.name);
    const now = new Date();
    for (let d = 1; d <= 14; d++) {
      for (const loc of storeNames) {
        const start = new Date(now);
        start.setDate(now.getDate() + d);
        start.setHours(9, 0, 0, 0);
        const end = new Date(start);
        end.setHours(17, 0, 0, 0);
        await client.query(
          `INSERT INTO shifts (start_time, end_time, store_location, store_id, capacity) VALUES ($1, $2, $3, $4, $5)`,
          [start, end, loc, storeIds[loc], 3]
        );
      }
    }
    console.log(`[Seed] Created ${14 * storeNames.length} shifts (with store_id)`);

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
    console.log('  Employees:');
    console.log('    emp001 / Employee123!  (Alice Smith, $15.50/hr)');
    console.log('    emp002 / Employee123!  (Bob Jones, $17.00/hr)');
    console.log('    emp003 / Employee123!  (Eve Taylor, $16.00/hr)');
    console.log('  Store Managers (each owns one store):');
    console.log('    mgr001 / Manager123!  (Carol White  → Store A)');
    console.log('    mgr002 / Manager123!  (Frank Garcia → Store B)');
    console.log('    mgr003 / Manager123!  (Grace Lee    → Store C)');
    console.log('    mgr004 / Manager123!  (Henry Patel  → Store D)');
    console.log('  Warehouse Manager:');
    console.log('    wh001  / Warehouse123!');
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
