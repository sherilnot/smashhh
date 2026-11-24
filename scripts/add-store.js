require('dotenv').config();
const crypto = require('crypto');
const { pool } = require('../src/config/database');
const { hashPassword } = require('../src/services/authService');

/**
 * Add a new shop with its manager, daily checklist items and crew.
 *
 *   node scripts/add-store.js --store "Springvale" \
 *     --manager manager_springvale \
 *     --crew "Ali Khan, Priya, Sam Lee" \
 *     [--copy-checklist-from Seaford] [--dry-run]
 *
 * - Never changes existing accounts: a user ID that is already taken stops the
 *   script before anything is written, so you can pick another name.
 * - Every new login gets its own random password, printed once at the end.
 * - Safe to run again: an existing shop and its checklist are left as they are,
 *   so you can rerun it with --crew to add more staff later (no new manager is
 *   made when the shop already has one).
 */

function parseArgs(argv) {
  const args = { crew: [], copyFrom: 'Seaford', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--store') { args.store = value; i++; }
    else if (key === '--manager') { args.manager = value; i++; }
    else if (key === '--crew') { args.crew = value.split(',').map(s => s.trim()).filter(Boolean); i++; }
    else if (key === '--copy-checklist-from') { args.copyFrom = value; i++; }
    else if (key === '--dry-run') { args.dryRun = true; }
    else throw new Error(`Unknown option ${key}`);
  }
  if (!args.store || !args.store.trim()) throw new Error('--store is required');
  args.store = args.store.trim();
  return args;
}

/** Same user ID rule as the original setup: lowercase, spaces to _, letters/digits only. */
function toUserId(name) {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function randomPassword() {
  // 10 characters without look-alikes (0/O, 1/l/I), easy to type on a phone
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(10), b => chars[b % chars.length]).join('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storeSlug = toUserId(args.store);
  const client = await pool.connect();
  try {
    // Adding crew to a shop that already has a manager: don't try to create another one
    const hasManager = await client.query(
      `SELECT 1 FROM store_manager_assignments sma JOIN stores s ON s.id = sma.store_id WHERE s.name = $1 LIMIT 1`,
      [args.store]
    );
    const managerId = args.manager || (hasManager.rows.length ? null : `manager_${storeSlug}`);
    await addStore(client, args, managerId);
  } finally {
    client.release();
  }
}

async function addStore(client, args, managerId) {
  const people = [];
  if (managerId) {
    people.push({ userId: managerId, role: 'store_manager', first: 'Manager', last: args.store,
      email: `${managerId.replace(/_/g, '.')}@rizins.com` });
  }
  args.crew.forEach(name => {
    const parts = name.split(/\s+/);
    const userId = toUserId(name);
    people.push({ userId, role: 'employee', first: parts[0], last: parts.slice(1).join(' '),
      email: `${userId}@rizins.com` });
  });

  const dupes = people.map(p => p.userId).filter((id, i, all) => all.indexOf(id) !== i);
  if (dupes.length) throw new Error(`The same user ID appears twice: ${[...new Set(dupes)].join(', ')}`);

  try {
    const taken = await client.query(`SELECT user_id FROM users WHERE user_id = ANY($1)`, [people.map(p => p.userId)]);
    if (taken.rows.length) {
      throw new Error(`These user IDs already exist, choose different names (e.g. add the shop or a surname): ${taken.rows.map(r => r.user_id).join(', ')}`);
    }

    const source = await client.query(`SELECT id FROM stores WHERE name = $1`, [args.copyFrom]);
    if (!source.rows.length) throw new Error(`Shop to copy the checklist from not found: ${args.copyFrom}`);

    const existing = await client.query(`SELECT id FROM stores WHERE name = $1`, [args.store]);
    console.log(`${existing.rows.length ? 'Using existing' : 'Creating'} shop: ${args.store}`);
    console.log(`Logins to create: ${people.map(p => `${p.userId} (${p.role === 'store_manager' ? 'manager' : 'crew'})`).join(', ') || 'none'}`);
    if (args.dryRun) { console.log('\nDry run: nothing was changed.'); return; }

    await client.query('BEGIN');
    const storeRes = existing.rows.length
      ? existing
      : await client.query(`INSERT INTO stores (name) VALUES ($1) RETURNING id`, [args.store]);
    const storeId = storeRes.rows[0].id;

    // Daily checklist / store order items, copied from another shop if this one has none yet
    const hasItems = await client.query(`SELECT 1 FROM store_checklist_templates WHERE store_id = $1 LIMIT 1`, [storeId]);
    let copied = 0;
    if (!hasItems.rows.length) {
      const res = await client.query(
        `INSERT INTO store_checklist_templates (store_id, product_name, default_quantity, sort_order, is_active)
         SELECT $1, product_name, default_quantity, sort_order, is_active
         FROM store_checklist_templates WHERE store_id = $2`,
        [storeId, source.rows[0].id]
      );
      copied = res.rowCount;
    }

    const created = [];
    for (const p of people) {
      const password = randomPassword();
      const userRes = await client.query(
        p.role === 'store_manager'
          ? `INSERT INTO users (user_id, password_hash, role, first_name, last_name, email)
             VALUES ($1, $2, 'store_manager', $3, $4, $5) RETURNING id`
          : `INSERT INTO users (user_id, password_hash, role, first_name, last_name, email, hourly_wage, employment_type)
             VALUES ($1, $2, 'employee', $3, $4, $5, 15.00, 'casual') RETURNING id`,
        [p.userId, await hashPassword(password), p.first, p.last, p.email]
      );
      await client.query(
        p.role === 'store_manager'
          ? `INSERT INTO store_manager_assignments (store_id, manager_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`
          : `INSERT INTO store_employee_assignments (store_id, employee_id) VALUES ($1, $2)`,
        [storeId, userRes.rows[0].id]
      );
      created.push({ ...p, password });
    }

    await client.query('COMMIT');

    console.log(`\nDone. Checklist items copied from ${args.copyFrom}: ${copied}`);
    if (created.length) {
      console.log('\nNEW LOGINS (shown once, give each person their own):');
      created.forEach(p => {
        console.log(`  ${p.userId.padEnd(24)} ${p.password}   ${p.role === 'store_manager' ? 'Store manager' : 'Crew'} - ${args.store}`);
      });
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

main()
  .then(() => pool.end())
  .catch(error => {
    console.error(`\nNot added: ${error.message}`);
    pool.end().finally(() => process.exit(1));
  });
