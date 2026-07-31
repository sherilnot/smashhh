const { pool } = require('../config/database');

/**
 * Maintenance Report Service
 * Store managers submit text descriptions + photos + videos of maintenance issues.
 */

async function createMaintenanceReport(managerId, description, photos = [], videos = []) {
  const client = await pool.connect();
  try {
    const storeRes = await client.query(
      `SELECT s.id AS store_id FROM store_manager_assignments sma
       JOIN stores s ON s.id = sma.store_id WHERE sma.manager_id = $1 LIMIT 1`,
      [managerId]
    );
    if (storeRes.rows.length === 0) {
      return { success: false, error: 'No store assignment exists' };
    }
    const storeId = storeRes.rows[0].store_id;

    await client.query('BEGIN');

    const res = await client.query(
      `INSERT INTO maintenance_reports (store_id, submitted_by, description)
       VALUES ($1, $2, $3) RETURNING id`,
      [storeId, managerId, description]
    );
    const reportId = res.rows[0].id;

    for (const file of photos) {
      await client.query(
        `INSERT INTO maintenance_report_images (report_id, filename, original_name, mime_type, file_size)
         VALUES ($1, $2, $3, $4, $5)`,
        [reportId, file.filename, file.originalname, file.mimetype, file.size]
      );
    }

    for (const file of videos) {
      await client.query(
        `INSERT INTO maintenance_report_videos (report_id, filename, original_name, mime_type, file_size)
         VALUES ($1, $2, $3, $4, $5)`,
        [reportId, file.filename, file.originalname, file.mimetype, file.size]
      );
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[MaintenanceService] createMaintenanceReport error', error);
    return { success: false, error: 'Failed to submit maintenance report' };
  } finally {
    client.release();
  }
}

async function getManagerMaintenanceReports(managerId) {
  try {
    const storeRes = await pool.query(
      `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
      [managerId]
    );
    if (storeRes.rows.length === 0) return { success: false, error: 'No store assignment' };
    const storeId = storeRes.rows[0].store_id;

    const res = await pool.query(
      `SELECT mr.id, mr.description, mr.status, mr.submitted_at,
              (SELECT COUNT(*) FROM maintenance_report_images WHERE report_id = mr.id) AS image_count,
              (SELECT COUNT(*) FROM maintenance_report_videos WHERE report_id = mr.id) AS video_count
       FROM maintenance_reports mr
       WHERE mr.store_id = $1
       ORDER BY mr.submitted_at DESC LIMIT 50`,
      [storeId]
    );
    return { success: true, reports: res.rows };
  } catch (error) {
    console.error('[MaintenanceService] getManagerMaintenanceReports error', error);
    return { success: false, error: 'Failed to load reports' };
  }
}

async function getAllMaintenanceReports(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const countRes = await pool.query('SELECT COUNT(*) FROM maintenance_reports');
  const total = parseInt(countRes.rows[0].count, 10);

  const res = await pool.query(
    `SELECT mr.id, mr.description, mr.status, mr.submitted_at,
            s.name AS store_name, u.first_name, u.last_name,
            (SELECT COUNT(*) FROM maintenance_report_images WHERE report_id = mr.id) AS image_count,
            (SELECT COUNT(*) FROM maintenance_report_videos WHERE report_id = mr.id) AS video_count
     FROM maintenance_reports mr
     JOIN stores s ON s.id = mr.store_id
     JOIN users u ON u.id = mr.submitted_by
     ORDER BY mr.submitted_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return { submissions: res.rows, total };
}

async function getMaintenanceReportDetail(reportId) {
  const reportRes = await pool.query(
    `SELECT mr.*, s.name AS store_name, u.first_name, u.last_name
     FROM maintenance_reports mr
     JOIN stores s ON s.id = mr.store_id
     JOIN users u ON u.id = mr.submitted_by
     WHERE mr.id = $1`,
    [reportId]
  );
  if (reportRes.rows.length === 0) return { success: false };

  const imagesRes = await pool.query(
    `SELECT filename, original_name FROM maintenance_report_images WHERE report_id = $1`,
    [reportId]
  );

  const videosRes = await pool.query(
    `SELECT filename, original_name, mime_type FROM maintenance_report_videos WHERE report_id = $1`,
    [reportId]
  );

  return {
    success: true,
    report: { ...reportRes.rows[0], images: imagesRes.rows, videos: videosRes.rows }
  };
}

module.exports = { createMaintenanceReport, getManagerMaintenanceReports, getAllMaintenanceReports, getMaintenanceReportDetail };
