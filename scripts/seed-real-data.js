s=drequire('dotenv').config();
const { pool } = require('../src/config/database');
const { hashPassword } = require('../src/services/authService');

/**
 * Seed real store and employee data.
 * Stores: Seaford, Dandenong, Mitcham, Frankston
 * All employee passwords: 123
 */
async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ─── Stores ────────────────────────────────────────────────────────────────
    const stores = [
      { name: 'Seaford' },
      { name: 'Dandenong' },
      { name: 'Mitcham' },
      { name: 'Frankston' },
    ];

    const storeIds = {};
    for (const s of stores) {
      const res = await client.query(
        `INSERT INTO stores (name) VALUES ($1)
         ON CONFLICT (name) DO NOTHING RETURNING id`,
        [s.name]
      );
      if (res.rows.length) {
        storeIds[s.name] = res.rows[0].id;
      } else {
        const existing = await client.query(`SELECT id FROM stores WHERE name = $1`, [s.name]);
        storeIds[s.name] = existing.rows[0].id;
      }
      console.log(`[Seed] Store: ${s.name}`);
    }

    // ─── Employees per store ───────────────────────────────────────────────────
    const employeesByStore = {
      Dandenong: [
        'Abdul', 'Fatah', 'Afrin', 'Anisa', 'Nusaiba', 'Ashraf', 'Eshal',
        'Farzad', 'Habiba', 'Hadiya', 'Krshma', 'Shifas', 'Mirash', 'Mujeeb',
        'Mujtaba', 'Muqadam', 'Nassara', 'Rafi', 'Saad', 'Sabin', 'Sadik',
        'Sahil', 'Sana', 'Saqib Bhai', 'Shameem', 'Sudha', 'Suraya', 'Naif',
        'Uncle Basheer', 'Zahra', 'Zainab', 'Yahya', 'Nargas'
      ],
      Mitcham: [
        'Ameen', 'Antony', 'Beneeta', 'Fahad', 'Josie', 'Jude', 'Kai',
        'Nainika', 'Niya', 'Sona', 'Thy', 'Will', 'Zeiad'
      ],
      Frankston: [
        'Ansif', 'Hisham', 'Christina', 'Richard'
      ],
      Seaford: [
        'Shabas', 'Ashwin', 'Ashwin Das', 'Thejus', 'Javad Ali', 'Sabin',
        'Billy', 'Harry', 'Kyra'
      ]
    };

    const password = '123';
    let empCounter = 1;

    for (const [storeName, employees] of Object.entries(employeesByStore)) {
      for (const name of employees) {
        const parts = name.trim().split(/\s+/);
        const firstName = parts[0];
        const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';

        // Create a unique user_id from the name
        const userId = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const email = `${userId}@rizins.com`;

        const hash = await hashPassword(password);

        const res = await client.query(
          `INSERT INTO users (user_id, password_hash, role, first_name, last_name, email, hourly_wage, employment_type)
           VALUES ($1, $2, 'employee', $3, $4, $5, $6, 'casual')
           ON CONFLICT (user_id) DO UPDATE SET
             password_hash = EXCLUDED.password_hash,
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name
           RETURNING id`,
          [userId, hash, firstName, lastName, email, 15.00]
        );

        const empId = res.rows[0].id;

        // Assign to store
        await client.query(
          `INSERT INTO store_employee_assignments (store_id, employee_id)
           VALUES ($1, $2) ON CONFLICT (employee_id) DO UPDATE SET store_id = EXCLUDED.store_id`,
          [storeIds[storeName], empId]
        );

        empCounter++;
      }
      console.log(`[Seed] ${storeName}: ${employees.length} employees added`);
    }

    // ─── Store checklist templates ────────────────────────────────────────────
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

    // ─── Managers (one per store) ─────────────────────────────────────────────
    const managers = [
      { userId: 'manager_seaford', first: 'Manager', last: 'Seaford', email: 'manager.seaford@rizins.com', store: 'Seaford' },
      { userId: 'manager_dandenong', first: 'Manager', last: 'Dandenong', email: 'manager.dandenong@rizins.com', store: 'Dandenong' },
      { userId: 'manager_mitcham', first: 'Manager', last: 'Mitcham', email: 'manager.mitcham@rizins.com', store: 'Mitcham' },
      { userId: 'manager_frankston', first: 'Manager', last: 'Frankston', email: 'manager.frankston@rizins.com', store: 'Frankston' },
    ];

    for (const m of managers) {
      const hash = await hashPassword(password);
      const res = await client.query(
        `INSERT INTO users (user_id, password_hash, role, first_name, last_name, email)
         VALUES ($1, $2, 'store_manager', $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [m.userId, hash, m.first, m.last, m.email]
      );
      const mgrId = res.rows[0].id;
      await client.query(
        `INSERT INTO store_manager_assignments (store_id, manager_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [storeIds[m.store], mgrId]
      );
    }
    console.log(`[Seed] 4 store managers added`);

    // ─── Warehouse, Receiving, Operation managers ──────────────────────────────
    const otherRoles = [
      { userId: 'warehouse', role: 'warehouse_manager', first: 'Warehouse', last: 'Manager', email: 'warehouse@rizins.com' },
      { userId: 'payroll', role: 'receiving_manager', first: 'Payroll', last: 'Manager', email: 'payroll@rizins.com' },
      { userId: 'operations', role: 'operation_manager', first: 'Operations', last: 'Manager', email: 'operations@rizins.com' },
    ];

    for (const u of otherRoles) {
      const hash = await hashPassword(password);
      await client.query(
        `INSERT INTO users (user_id, password_hash, role, first_name, last_name, email)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [u.userId, hash, u.role, u.first, u.last, u.email]
      );
    }
    console.log(`[Seed] Warehouse, Payroll, Operations managers added`);

    await client.query('COMMIT');

    console.log(`\n[Seed] Done! Total employees added: ${empCounter - 1}`);
    console.log(`\nAll passwords: 123`);
    console.log(`Login with the employee name as user_id (lowercase, spaces replaced with _)`);
    console.log(`\nExamples:`);
    console.log(`  User ID: abdul             → Abdul (Dandenong)`);
    console.log(`  User ID: saqib_bhai        → Saqib Bhai (Dandenong)`);
    console.log(`  User ID: shabas            → Shabas (Seaford)`);
    console.log(`  User ID: ameen             → Ameen (Mitcham)`);
    console.log(`  User ID: ansif             → Ansif (Frankston)`);
    console.log(`\nManagers:`);
    console.log(`  manager_seaford    → Store Manager (Seaford)`);
    console.log(`  manager_dandenong  → Store Manager (Dandenong)`);
    console.log(`  manager_mitcham    → Store Manager (Mitcham)`);
    console.log(`  manager_frankston  → Store Manager (Frankston)`);
    console.log(`  warehouse          → Warehouse Manager`);
    console.log(`  payroll            → Receiving/Payroll Manager`);
    console.log(`  operations         → Operations Manager`);

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
