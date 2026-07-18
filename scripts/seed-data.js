require('dotenv').config();
const { pool } = require('../src/config/database');
const { hashPassword } = require('../src/services/authService');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Seed users (4 managers — one per store, pre-assigned below)
    const users = [
      // Rizin's Seaford employees (formerly Store A)
      { user_id: 'emp001', password: '123', role: 'employee', first: 'Harry', last: '', email: 'emp001@rizinsseaford.local', wage: 16.60, store: "Rizin's Seaford", employmentType: 'permanent' },
      { user_id: 'emp002', password: '123', role: 'employee', first: 'Billy', last: '', email: 'emp002@rizinsseaford.local', wage: 19.90, store: "Rizin's Seaford", employmentType: 'permanent' },
      { user_id: 'emp003', password: '123', role: 'employee', first: 'Kyra', last: '', email: 'emp003@rizinsseaford.local', wage: 19.90, store: "Rizin's Seaford", employmentType: 'permanent' },
      { user_id: 'emp013', password: '123', role: 'employee', first: 'Sabin', last: '', email: 'emp013@rizinsseaford.local', wage: 20.00, store: "Rizin's Seaford", employmentType: 'permanent' },
      { user_id: 'emp014', password: '123', role: 'employee', first: 'Shabas', last: '', email: 'emp014@rizinsseaford.local', wage: 23.00, store: "Rizin's Seaford", employmentType: 'permanent' },
      { user_id: 'emp015', password: '123', role: 'employee', first: 'Ashwin', last: '', email: 'emp015@rizinsseaford.local', wage: 23.00, store: "Rizin's Seaford", employmentType: 'permanent' },
      { user_id: 'emp016', password: '123', role: 'employee', first: 'Ashin', last: 'Das', email: 'emp016@rizinsseaford.local', wage: 23.00, store: "Rizin's Seaford", employmentType: 'permanent' },
      { user_id: 'emp017', password: '123', role: 'employee', first: 'Thejus', last: '', email: 'emp017@rizinsseaford.local', wage: 23.00, store: "Rizin's Seaford", employmentType: 'permanent' },
      { user_id: 'emp018', password: '123', role: 'employee', first: 'Javad', last: 'Ali', email: 'emp018@rizinsseaford.local', wage: 23.00, store: "Rizin's Seaford", employmentType: 'permanent' },
      // Store B employees
      { user_id: 'emp004', password: '123', role: 'employee', first: 'Liam', last: 'Nguyen', email: 'liam@example.com', wage: 16.50, store: 'Store B', employmentType: 'permanent' },
      { user_id: 'emp005', password: '123', role: 'employee', first: 'Mia', last: 'Chen', email: 'mia@example.com', wage: 15.00, store: 'Store B', employmentType: 'casual' },
      { user_id: 'emp006', password: '123', role: 'employee', first: 'Noah', last: 'Kumar', email: 'noah@example.com', wage: 17.50, store: 'Store B', employmentType: 'casual' },
      // Store C employees
      { user_id: 'emp007', password: '123', role: 'employee', first: 'Olivia', last: 'Park', email: 'olivia@example.com', wage: 16.00, store: 'Store C', employmentType: 'permanent' },
      { user_id: 'emp008', password: '123', role: 'employee', first: 'James', last: 'Singh', email: 'james@example.com', wage: 15.50, store: 'Store C', employmentType: 'permanent' },
      { user_id: 'emp009', password: '123', role: 'employee', first: 'Sophia', last: 'Ali', email: 'sophia@example.com', wage: 18.00, store: 'Store C', employmentType: 'casual' },
      // Store D employees
      { user_id: 'emp010', password: '123', role: 'employee', first: 'Lucas', last: 'Russo', email: 'lucas@example.com', wage: 16.50, store: 'Store D', employmentType: 'permanent' },
      { user_id: 'emp011', password: '123', role: 'employee', first: 'Ava', last: 'Kim', email: 'ava@example.com', wage: 17.00, store: 'Store D', employmentType: 'casual' },
      { user_id: 'emp012', password: '123', role: 'employee', first: 'Ethan', last: 'Pham', email: 'ethan@example.com', wage: 15.00, store: 'Store D', employmentType: 'casual' },
      // Managers
      { user_id: 'mgr001', password: '123', role: 'store_manager', first: 'Carol', last: 'White', email: 'carol@example.com', wage: null },
      { user_id: 'mgr002', password: '123', role: 'store_manager', first: 'Frank', last: 'Garcia', email: 'frank@example.com', wage: null },
      { user_id: 'mgr003', password: '123', role: 'store_manager', first: 'Grace', last: 'Lee', email: 'grace@example.com', wage: null },
      { user_id: 'mgr004', password: '123', role: 'store_manager', first: 'Henry', last: 'Patel', email: 'henry@example.com', wage: null },
      { user_id: 'wh001',  password: '123', role: 'warehouse_manager', first: 'Dave', last: 'Brown', email: 'dave@example.com', wage: null },
      { user_id: 'rm001',  password: '123', role: 'receiving_manager', first: 'Sarah', last: 'Wilson', email: 'sarah@example.com', wage: null },
      { user_id: 'om001',  password: '123', role: 'operation_manager', first: 'Nora', last: 'Ahmed', email: 'nora@example.com', wage: null },
    ];

    const userIds = {};
    for (const u of users) {
      const hash = await hashPassword(u.password);
      const res = await client.query(
        `INSERT INTO users (user_id, password_hash, role, first_name, last_name, email, hourly_wage, employment_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           hourly_wage = EXCLUDED.hourly_wage,
           employment_type = EXCLUDED.employment_type
         RETURNING id`,
        [u.user_id, hash, u.role, u.first, u.last, u.email, u.wage, u.employmentType || null]
      );
      userIds[u.user_id] = res.rows[0].id;
      console.log(`[Seed] User: ${u.user_id} (${u.role}${u.employmentType ? ', ' + u.employmentType : ''})`);
    }

    // Seed 4 stores — each one pre-assigned to a manager (no manual assignment needed)
    const storeConfig = [
      { name: "Rizin's Seaford", manager: 'mgr001' },
      { name: 'Store B', manager: 'mgr002' },
      { name: 'Store C', manager: 'mgr003' },
      { name: 'Store D', manager: 'mgr004' },
    ];
    const storeIds = {};
    for (const { name, manager } of storeConfig) {
      const res = await client.query(
        `INSERT INTO stores (name) VALUES ($1)
         ON CONFLICT (name) DO NOTHING RETURNING id`,
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

    // Assign employees exclusively to their stores
    for (const u of users) {
      if (u.role === 'employee' && u.store) {
        await client.query(
          `INSERT INTO store_employee_assignments (store_id, employee_id)
           VALUES ($1, $2) ON CONFLICT (employee_id) DO NOTHING`,
          [storeIds[u.store], userIds[u.user_id]]
        );
      }
    }
    console.log(`[Seed] Employees assigned to stores (exclusive — no mixing)`);

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

    // Seed store checklist templates (supply items each store orders)
    const checklistItems = [
      { name: 'Beef', qty: '5 crates' },
      { name: 'Buns', qty: '17 trays' },
      { name: 'Fried Chicken', qty: '5 packets' },
      { name: 'Grilled Chicken', qty: '5 packets' },
      { name: 'Nuggets', qty: '4 containers' },
      { name: 'Chicken Wings', qty: '5 packets' },
      { name: 'Tomato', qty: '3 packets' },
      { name: 'Lettuce', qty: '3 boxes' },
      { name: 'Onions', qty: '6 boxes' },
      { name: 'Cheese Sauce', qty: '1 tub (3kg)' },
      { name: 'Classic Sauce', qty: '50 pieces' },
      { name: 'Spicy Sauce', qty: '2 containers' },
      { name: 'Sweet Sauce', qty: '2 containers' },
      { name: 'Flour', qty: '1 containers' },
      { name: 'Salt', qty: '1 whole packets' },
      { name: 'Garlic Powder', qty: '1 packet' },
      { name: 'Bacon', qty: '2 whole containers' },
      { name: 'Spicy Seasoning', qty: '2 thawed packets' },
      { name: 'Burger Seasoning', qty: '1 unopened box' },
      { name: 'Mango Pulp', qty: '1 unopened box' },
      { name: 'Milk', qty: '6 tins' },
      { name: 'Mushroom', qty: '2 cans' },
      { name: 'Paper Bags', qty: '40 patties' },
      { name: 'Burger Boxes', qty: '3 boxes' },
      { name: 'Combo Cups', qty: '2 boxes' },
      { name: 'Fries Boxes', qty: '2 boxes' },
      { name: 'Tray Sheets', qty: '2 boxes' },
      { name: 'Napkins', qty: '1 box' },
      { name: 'Centrefeed Hand Towel', qty: '1 box' },
      { name: 'Jumbo Toilet Roll', qty: '1 box' },
      { name: 'Dipping Sauce Containers', qty: '1 box' },
      { name: 'Brown Bags', qty: '1 box' },
      { name: 'Printer Till Rolls', qty: '2 bundles' },
      { name: 'Oil Filter Paper', qty: '1 box' },
      { name: 'Apple Juice', qty: '1 box' },
      { name: 'Orange Juice', qty: '2 boxes' },
      { name: 'Thickshake Cups', qty: '2 boxes' },
      { name: 'Thickshake Straws', qty: '1 box' },
      { name: 'Thickshake Lids', qty: '1 box' },
      { name: 'Paper Straws', qty: '1 box' },
      { name: 'White SOS Bags', qty: '1 box' },
      { name: 'Toilet Paper Rolls', qty: '1 box' },
      { name: 'Wooden Forks', qty: '1 box' },
      { name: 'Wooden Knives', qty: '1 box' },
      { name: 'Hairnets', qty: '1 box' },
      { name: 'Bin Liners (240ltr)', qty: '1 packet' },
      { name: 'Bin Liners (75ltr)', qty: '1 box' },
      { name: 'Gloves (Medium)', qty: '3 cans' },
      { name: 'Gloves (Large)', qty: '1 box' },
      { name: 'Chux Roll', qty: '1 box' },
      { name: 'Oil Cans', qty: '1 box' },
    ];

    // Add template for all stores
    for (const storeName of Object.keys(storeIds)) {
      for (let i = 0; i < checklistItems.length; i++) {
        await client.query(
          `INSERT INTO store_checklist_templates (store_id, product_name, default_quantity, sort_order)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [storeIds[storeName], checklistItems[i].name, checklistItems[i].qty, i + 1]
        );
      }
    }
    console.log(`[Seed] Store checklist templates: ${checklistItems.length} items per store`);

    await client.query('COMMIT');
    console.log('\n[Seed] Done! Test credentials (all passwords: 123):');
    console.log('  Employees (Rizin\'s Seaford):');
    console.log('    emp001 (Harry, $16.60/hr, permanent)');
    console.log('    emp002 (Billy, $19.90/hr, permanent)');
    console.log('    emp003 (Kyra, $19.90/hr, permanent)');
    console.log('    emp013 (Sabin, $20.00/hr, permanent)');
    console.log('    emp014 (Shabas, $23.00/hr, permanent)');
    console.log('    emp015 (Ashwin, $23.00/hr, permanent)');
    console.log('    emp016 (Ashin Das, $23.00/hr, permanent)');
    console.log('    emp017 (Thejus, $23.00/hr, permanent)');
    console.log('    emp018 (Javad Ali, $23.00/hr, permanent)');
    console.log('  Employees (Store B):');
    console.log('    emp004 (Liam Nguyen, $16.50/hr, permanent)');
    console.log('    emp005 (Mia Chen, $15.00/hr, casual)');
    console.log('    emp006 (Noah Kumar, $17.50/hr, casual)');
    console.log('  Employees (Store C):');
    console.log('    emp007 (Olivia Park, $16.00/hr, permanent)');
    console.log('    emp008 (James Singh, $15.50/hr, permanent)');
    console.log('    emp009 (Sophia Ali, $18.00/hr, casual)');
    console.log('  Employees (Store D):');
    console.log('    emp010 (Lucas Russo, $16.50/hr, permanent)');
    console.log('    emp011 (Ava Kim, $17.00/hr, casual)');
    console.log('    emp012 (Ethan Pham, $15.00/hr, casual)');
    console.log('  Store Managers (each owns one store):');
    console.log('    mgr001 (Carol White  → Rizin\'s Seaford)');
    console.log('    mgr002 (Frank Garcia → Store B)');
    console.log('    mgr003 (Grace Lee    → Store C)');
    console.log('    mgr004 (Henry Patel  → Store D)');
    console.log('  Warehouse Manager:');
    console.log('    wh001  (Dave Brown)');
    console.log('  Receiving Manager:');
    console.log('    rm001  (Sarah Wilson)');
    console.log('  Operation Manager:');
    console.log('    om001  (Nora Ahmed)');
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
