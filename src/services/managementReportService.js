const { pool } = require('../config/database');

/**
 * Management Report Service
 * Shop managers send a text report with photos to the operational manager.
 */

/**
 * Create a new management report with uploaded images.
 * @param {string} managerId
 * @param {string} reportText
 * @param {Array} files - Array of { filename, originalname, mimetype, size } (verified image files)
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function createManagementReport(managerId, reportText, files) {
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

    const reportRes = await client.query(
      `INSERT INTO management_reports (store_id, submitted_by, report_text)
       VALUES ($1, $2, $3) RETURNING id`,
      [storeId, managerId, reportText]
    );
    const reportId = reportRes.rows[0].id;

    // Insert image records
    for (const file of files || []) {
      await client.query(
        `INSERT INTO management_report_images (report_id, filename, original_name, mime_type, file_size)
         VALUES ($1, $2, $3, $4, $5)`,
        [reportId, file.filename, file.originalname, file.mimetype, file.size]
      );
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ManagementReportService] createManagementReport error', error);
    return { success: false, error: 'Failed to submit management report' };
  } finally {
    client.release();
  }
}

/**
 * Get all management reports for a manager's store (most recent first).
 * @param {string} managerId
 * @returns {Promise<{ success: boolean, reports?: Array, error?: string }>}
 */
async function getManagerReports(managerId) {
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
      `SELECT mr.id, mr.report_text, mr.status, mr.submitted_at,
              (SELECT COUNT(*) FROM management_report_images WHERE report_id = mr.id) AS image_count
       FROM management_reports mr
       WHERE mr.store_id = $1
       ORDER BY mr.submitted_at DESC
       LIMIT 50`,
      [storeId]
    );

    return { success: true, reports: res.rows };
  } catch (error) {
    console.error('[ManagementReportService] getManagerReports error', error);
    return { success: false, error: 'Failed to load reports' };
  }
}

/**
 * Get all management reports (for operation manager).
 * @param {number} page
 * @param {number} limit
 * @returns {Promise<{ reports: Array, total: number }>}
 */
async function getAllManagementReports(page = 1, limit = 50) {
  limit = Math.min(limit, 50);
  const offset = (page - 1) * limit;

  const countRes = await pool.query(`SELECT COUNT(*) FROM management_reports`);
  const total = parseInt(countRes.rows[0].count, 10);

  const res = await pool.query(
    `SELECT mr.id, mr.report_text, mr.status, mr.submitted_at,
            s.name AS store_name,
            u.first_name, u.last_name,
            (SELECT COUNT(*) FROM management_report_images WHERE report_id = mr.id) AS image_count
     FROM management_reports mr
     JOIN stores s ON s.id = mr.store_id
     JOIN users u ON u.id = mr.submitted_by
     ORDER BY mr.submitted_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return { reports: res.rows, total };
}

/**
 * Get a specific management report detail with images.
 * @param {string} reportId
 * @returns {Promise<{ success: boolean, report?: object, error?: string }>}
 */
async function getManagementReportDetail(reportId) {
  try {
    const reportRes = await pool.query(
      `SELECT mr.*, s.name AS store_name, u.first_name, u.last_name
       FROM management_reports mr
       JOIN stores s ON s.id = mr.store_id
       JOIN users u ON u.id = mr.submitted_by
       WHERE mr.id = $1`,
      [reportId]
    );

    if (reportRes.rows.length === 0) {
      return { success: false, error: 'Report not found' };
    }

    const report = reportRes.rows[0];

    const imagesRes = await pool.query(
      `SELECT id, filename, original_name, mime_type, file_size
       FROM management_report_images
       WHERE report_id = $1
       ORDER BY created_at`,
      [reportId]
    );

    report.images = imagesRes.rows;

    return { success: true, report };
  } catch (error) {
    console.error('[ManagementReportService] getManagementReportDetail error', error);
    return { success: false, error: 'Failed to load report' };
  }
}

module.exports = {
  createManagementReport,
  getManagerReports,
  getAllManagementReports,
  getManagementReportDetail
};
