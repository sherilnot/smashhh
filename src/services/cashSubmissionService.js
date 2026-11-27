const { pool } = require('../config/database');

/**
 * Cash Submission Service
 * Shop managers send photos of liquid cash (with amount and notes) to the operational manager.
 */

/**
 * Create a new cash submission with uploaded images.
 * @param {string} managerId
 * @param {number} amount
 * @param {string} notes
 * @param {Array} files - Array of multer file objects
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function createCashSubmission(managerId, amount, notes, files) {
  const client = await pool.connect();
  try {
    // Find manager's store
    const storeRes = await client.query(
      `SELECT s.id AS store_id
       FROM store_manager_assignments sma
       JOIN stores s ON s.id = sma.store_id
       WHERE sma.manager_id = $1 LIMIT 1`,
      [managerId]
    );

    if (storeRes.rows.length === 0) {
      return { success: false, error: 'No store assignment exists' };
    }

    const storeId = storeRes.rows[0].store_id;

    await client.query('BEGIN');

    const subRes = await client.query(
      `INSERT INTO cash_submissions (store_id, submitted_by, amount, notes)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [storeId, managerId, amount, notes || '']
    );
    const submissionId = subRes.rows[0].id;

    // Insert image records
    for (const file of files) {
      await client.query(
        `INSERT INTO cash_submission_images (submission_id, filename, original_name, mime_type, file_size)
         VALUES ($1, $2, $3, $4, $5)`,
        [submissionId, file.filename, file.originalname, file.mimetype, file.size]
      );
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CashSubmissionService] createCashSubmission error', error);
    return { success: false, error: 'Failed to submit cash report' };
  } finally {
    client.release();
  }
}

/**
 * Get all cash submissions for a manager's store (most recent first).
 * @param {string} managerId
 * @returns {Promise<{ success: boolean, submissions?: Array, error?: string }>}
 */
async function getManagerCashSubmissions(managerId) {
  try {
    const storeRes = await pool.query(
      `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
      [managerId]
    );
    if (storeRes.rows.length === 0) {
      return { success: false, error: 'No store assignment' };
    }
    const storeId = storeRes.rows[0].store_id;

    const res = await pool.query(
      `SELECT cs.id, cs.amount, cs.notes, cs.status, cs.submitted_at,
              (SELECT COUNT(*) FROM cash_submission_images WHERE submission_id = cs.id) AS image_count
       FROM cash_submissions cs
       WHERE cs.store_id = $1
       ORDER BY cs.submitted_at DESC
       LIMIT 50`,
      [storeId]
    );

    return { success: true, submissions: res.rows };
  } catch (error) {
    console.error('[CashSubmissionService] getManagerCashSubmissions error', error);
    return { success: false, error: 'Failed to load submissions' };
  }
}

/**
 * Get all cash submissions (for operation manager).
 * @param {number} page
 * @param {number} limit
 * @returns {Promise<{ submissions: Array, total: number }>}
 */
async function getAllCashSubmissions(page = 1, limit = 50) {
  limit = Math.min(limit, 50);
  const offset = (page - 1) * limit;

  const countRes = await pool.query(`SELECT COUNT(*) FROM cash_submissions`);
  const total = parseInt(countRes.rows[0].count, 10);

  const res = await pool.query(
    `SELECT cs.id, cs.amount, cs.notes, cs.status, cs.submitted_at,
            s.name AS store_name,
            u.first_name, u.last_name,
            (SELECT COUNT(*) FROM cash_submission_images WHERE submission_id = cs.id) AS image_count
     FROM cash_submissions cs
     JOIN stores s ON s.id = cs.store_id
     JOIN users u ON u.id = cs.submitted_by
     ORDER BY cs.submitted_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return { submissions: res.rows, total };
}

/**
 * Get a specific cash submission detail with images.
 * @param {string} submissionId
 * @returns {Promise<{ success: boolean, submission?: object, error?: string }>}
 */
async function getCashSubmissionDetail(submissionId) {
  try {
    const subRes = await pool.query(
      `SELECT cs.*, s.name AS store_name, u.first_name, u.last_name
       FROM cash_submissions cs
       JOIN stores s ON s.id = cs.store_id
       JOIN users u ON u.id = cs.submitted_by
       WHERE cs.id = $1`,
      [submissionId]
    );

    if (subRes.rows.length === 0) {
      return { success: false, error: 'Submission not found' };
    }

    const submission = subRes.rows[0];

    const imagesRes = await pool.query(
      `SELECT id, filename, original_name, mime_type, file_size
       FROM cash_submission_images
       WHERE submission_id = $1
       ORDER BY created_at`,
      [submissionId]
    );

    submission.images = imagesRes.rows;

    return { success: true, submission };
  } catch (error) {
    console.error('[CashSubmissionService] getCashSubmissionDetail error', error);
    return { success: false, error: 'Failed to load submission' };
  }
}

/** Format a week's Monday into "3-9 Aug 2026", spelling out boundaries. */
function weekLabel(weekStartValue) {
  const start = new Date(weekStartValue);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const mon = (d) => d.toLocaleDateString('en-AU', { month: 'short' });
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getDate()} ${mon(start)} ${start.getFullYear()} - ${end.getDate()} ${mon(end)} ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.getDate()} ${mon(start)} - ${end.getDate()} ${mon(end)} ${end.getFullYear()}`;
  }
  return `${start.getDate()}-${end.getDate()} ${mon(start)} ${start.getFullYear()}`;
}

/**
 * Cash reports grouped by store, with cash totals per week and per month, for
 * the head-office Cash Reports pages (payroll and operations).
 * date_trunc('week') in Postgres starts on Monday, matching the rest of the app.
 * @returns {Promise<{ byStore: object, total: number, cashPeriods: object }>}
 *   cashPeriods: { storeName: { weeks: [{ label, count, total }], months: [...] } }
 */
async function getCashReportsByStore() {
  const { submissions, total } = await getAllCashSubmissions(1, 200);

  const byStore = {};
  submissions.forEach(sub => {
    if (!byStore[sub.store_name]) byStore[sub.store_name] = [];
    byStore[sub.store_name].push(sub);
  });

  const periodTotals = (unit) => pool.query(
    `SELECT s.name AS store_name,
            date_trunc('${unit}', cs.submitted_at) AS period_start,
            COUNT(*) AS report_count,
            SUM(cs.amount) AS total
     FROM cash_submissions cs
     JOIN stores s ON s.id = cs.store_id
     GROUP BY s.name, date_trunc('${unit}', cs.submitted_at)
     ORDER BY period_start DESC`
  );
  const [weekly, monthly] = await Promise.all([periodTotals('week'), periodTotals('month')]);

  const cashPeriods = {};
  const ensure = (name) => {
    if (!cashPeriods[name]) cashPeriods[name] = { weeks: [], months: [] };
    return cashPeriods[name];
  };
  const toPeriod = (r, label) => ({
    label,
    count: parseInt(r.report_count, 10) || 0,
    total: Math.round((parseFloat(r.total) || 0) * 100) / 100
  });

  weekly.rows.forEach(r => ensure(r.store_name).weeks.push(toPeriod(r, weekLabel(r.period_start))));
  monthly.rows.forEach(r => ensure(r.store_name).months.push(
    toPeriod(r, new Date(r.period_start).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }))
  ));

  return { byStore, total, cashPeriods };
}

module.exports = {
  createCashSubmission,
  getManagerCashSubmissions,
  getAllCashSubmissions,
  getCashSubmissionDetail,
  getCashReportsByStore
};
