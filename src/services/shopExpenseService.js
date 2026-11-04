const { pool } = require('../config/database');

/**
 * Shop Expense Service
 * Store managers record money spent on their shop (repairs, supplies, ...),
 * optionally with receipt photos. Payroll sees the monthly cost per shop.
 */

const CATEGORIES = [
  { key: 'repairs', label: 'Repairs', icon: '🔧' },
  { key: 'equipment', label: 'Equipment', icon: '🔌' },
  { key: 'cleaning', label: 'Cleaning', icon: '🧽' },
  { key: 'supplies', label: 'Supplies', icon: '📦' },
  { key: 'utilities', label: 'Utilities', icon: '💡' },
  { key: 'other', label: 'Other', icon: '📝' }
];
const CATEGORY_KEYS = CATEGORIES.map(c => c.key);

/** "YYYY-MM" for a date, in the server's timezone (Australia/Melbourne). */
function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Validates "YYYY-MM"; falls back to the current month. */
function normaliseMonth(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') ? month : monthKey();
}

/** Shift a "YYYY-MM" month by `delta` months. */
function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

/** "October 2026" */
function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

/** First day of the month and of the next month, as 'YYYY-MM-DD' (spent_on range). */
function monthRange(month) {
  return [`${month}-01`, `${addMonths(month, 1)}-01`];
}

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

async function managerStore(managerId) {
  const res = await pool.query(
    `SELECT s.id, s.name
     FROM store_manager_assignments sma
     JOIN stores s ON s.id = sma.store_id
     WHERE sma.manager_id = $1 LIMIT 1`,
    [managerId]
  );
  return res.rows[0] || null;
}

/**
 * Record an expense for the manager's store.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function createExpense(managerId, { amount, category, description, spentOn }, files) {
  const parsedAmount = round2(amount);
  if (!(parsedAmount > 0)) return { success: false, error: 'Please enter the amount spent' };
  if (!description || !description.trim()) return { success: false, error: 'Please say what the money was spent on' };
  const cat = CATEGORY_KEYS.includes(category) ? category : 'other';
  // Spending date: today by default, never in the future
  const today = new Date().toLocaleDateString('en-CA');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(spentOn || '') && spentOn <= today ? spentOn : today;

  const client = await pool.connect();
  try {
    const store = await managerStore(managerId);
    if (!store) return { success: false, error: 'No store assignment exists' };

    await client.query('BEGIN');
    const res = await client.query(
      `INSERT INTO shop_expenses (store_id, submitted_by, amount, category, description, spent_on)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [store.id, managerId, parsedAmount, cat, description.trim(), date]
    );
    for (const file of files || []) {
      await client.query(
        `INSERT INTO shop_expense_images (expense_id, filename, original_name, mime_type, file_size)
         VALUES ($1, $2, $3, $4, $5)`,
        [res.rows[0].id, file.filename, file.originalname, file.mimetype, file.size]
      );
    }
    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ShopExpenseService] createExpense error', error);
    return { success: false, error: 'Failed to save the expense' };
  } finally {
    client.release();
  }
}

/**
 * The manager's store expenses for the last 12 months, newest first, grouped by month.
 * @returns {Promise<{ success: boolean, storeName?: string, months?: Array, thisMonth?: object, error?: string }>}
 */
async function getManagerExpenses(managerId) {
  try {
    const store = await managerStore(managerId);
    if (!store) return { success: false, error: 'No store assignment' };

    const current = monthKey();
    const [from] = monthRange(addMonths(current, -11));
    const res = await pool.query(
      `SELECT e.id, e.amount, e.category, e.description, e.spent_on, e.submitted_at,
              to_char(e.spent_on, 'YYYY-MM') AS month,
              (SELECT COUNT(*) FROM shop_expense_images i WHERE i.expense_id = e.id)::int AS image_count
       FROM shop_expenses e
       WHERE e.store_id = $1 AND e.spent_on >= $2
       ORDER BY e.spent_on DESC, e.submitted_at DESC`,
      [store.id, from]
    );

    const months = [];
    res.rows.forEach(row => {
      let group = months[months.length - 1];
      if (!group || group.month !== row.month) {
        group = { month: row.month, label: monthLabel(row.month), total: 0, expenses: [] };
        months.push(group);
      }
      group.total = round2(group.total + parseFloat(row.amount));
      // Only the current month can still be corrected, so payroll's past months stay fixed
      row.canDelete = row.month === current;
      group.expenses.push(row);
    });

    const thisMonth = months.find(m => m.month === current) || { month: current, label: monthLabel(current), total: 0, expenses: [] };
    return { success: true, storeName: store.name, months, thisMonth };
  } catch (error) {
    console.error('[ShopExpenseService] getManagerExpenses error', error);
    return { success: false, error: 'Failed to load expenses' };
  }
}

/**
 * Delete one of the manager's own store expenses from the current month.
 * @returns {Promise<{ success: boolean, files?: string[], error?: string }>} files: receipt filenames to remove
 */
async function deleteExpense(managerId, expenseId) {
  try {
    const store = await managerStore(managerId);
    if (!store) return { success: false, error: 'No store assignment' };
    const [from, to] = monthRange(monthKey());
    const images = await pool.query(
      `SELECT i.filename FROM shop_expense_images i
       JOIN shop_expenses e ON e.id = i.expense_id
       WHERE e.id = $1 AND e.store_id = $2`,
      [expenseId, store.id]
    );
    const res = await pool.query(
      `DELETE FROM shop_expenses
       WHERE id = $1 AND store_id = $2 AND spent_on >= $3 AND spent_on < $4`,
      [expenseId, store.id, from, to]
    );
    if (res.rowCount === 0) return { success: false, error: 'Only this month\'s expenses can be deleted' };
    return { success: true, files: images.rows.map(r => r.filename) };
  } catch (error) {
    console.error('[ShopExpenseService] deleteExpense error', error);
    return { success: false, error: 'Failed to delete the expense' };
  }
}

/**
 * Every shop's expenses for one month, for payroll: totals, category split and
 * the individual expenses with their receipt photos. Shops with no expenses are
 * included with $0 so nothing looks missing.
 */
async function getMonthlyReport(month) {
  const [from, to] = monthRange(month);
  const storesRes = await pool.query(`SELECT id, name FROM stores ORDER BY name`);
  const res = await pool.query(
    `SELECT e.id, e.store_id, e.amount, e.category, e.description, e.spent_on, e.submitted_at,
            u.first_name, u.last_name,
            COALESCE(json_agg(json_build_object('filename', i.filename, 'mime_type', i.mime_type))
                     FILTER (WHERE i.id IS NOT NULL), '[]') AS images
     FROM shop_expenses e
     JOIN users u ON u.id = e.submitted_by
     LEFT JOIN shop_expense_images i ON i.expense_id = e.id
     WHERE e.spent_on >= $1 AND e.spent_on < $2
     GROUP BY e.id, u.first_name, u.last_name
     ORDER BY e.spent_on DESC, e.submitted_at DESC`,
    [from, to]
  );

  const stores = storesRes.rows.map(s => ({
    id: s.id, name: s.name, total: 0, count: 0, categories: {}, expenses: []
  }));
  const byId = Object.fromEntries(stores.map(s => [s.id, s]));
  res.rows.forEach(row => {
    const store = byId[row.store_id];
    if (!store) return;
    const amount = parseFloat(row.amount);
    store.total = round2(store.total + amount);
    store.count++;
    store.categories[row.category] = round2((store.categories[row.category] || 0) + amount);
    store.expenses.push(row);
  });

  // Biggest spenders first
  stores.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const total = round2(stores.reduce((sum, s) => sum + s.total, 0));
  const count = stores.reduce((sum, s) => sum + s.count, 0);
  return { stores, total, count };
}

/**
 * Monthly totals per shop for the `months` months ending at `month`, oldest first.
 * @returns {Promise<{ months: Array<{ month, label }>, rows: Array<{ name, totals: number[], sum }>, columnTotals: number[] }>}
 */
async function getMonthlyTrend(month, months = 6) {
  const keys = [];
  for (let i = months - 1; i >= 0; i--) keys.push(addMonths(month, -i));
  const [from] = monthRange(keys[0]);
  const [, to] = monthRange(month);

  const storesRes = await pool.query(`SELECT id, name FROM stores ORDER BY name`);
  const res = await pool.query(
    `SELECT store_id, to_char(spent_on, 'YYYY-MM') AS month, SUM(amount) AS total
     FROM shop_expenses
     WHERE spent_on >= $1 AND spent_on < $2
     GROUP BY store_id, to_char(spent_on, 'YYYY-MM')`,
    [from, to]
  );
  const lookup = {};
  res.rows.forEach(r => { lookup[`${r.store_id}|${r.month}`] = round2(r.total); });

  const rows = storesRes.rows.map(s => {
    const totals = keys.map(k => lookup[`${s.id}|${k}`] || 0);
    return { name: s.name, totals, sum: round2(totals.reduce((a, b) => a + b, 0)) };
  });
  const columnTotals = keys.map((_, i) => round2(rows.reduce((sum, r) => sum + r.totals[i], 0)));
  return {
    months: keys.map(k => ({ month: k, label: new Date(k + '-01T00:00:00').toLocaleDateString('en-AU', { month: 'short' }) })),
    rows,
    columnTotals
  };
}

module.exports = {
  CATEGORIES,
  monthKey,
  normaliseMonth,
  addMonths,
  monthLabel,
  createExpense,
  getManagerExpenses,
  deleteExpense,
  getMonthlyReport,
  getMonthlyTrend
};
