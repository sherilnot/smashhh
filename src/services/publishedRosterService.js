const { pool } = require('../config/database');

/**
 * Published Roster Service
 * Handles publishing weekly rosters and retrieving them for employees.
 */

/**
 * Publish (or update) the current roster for a store's week.
 * Stores a JSON snapshot of the roster grid data.
 * @param {string} managerId
 * @param {string} storeId
 * @param {string} weekStart - YYYY-MM-DD
 * @param {string} weekEnd - YYYY-MM-DD
 * @param {object} rosterData - { dayLabels, dayDates, rows: [{name, employmentType, byDay}] }
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function publishRoster(managerId, storeId, weekStart, weekEnd, rosterData) {
  try {
    // Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS published_rosters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        week_start DATE NOT NULL,
        week_end DATE NOT NULL,
        published_by UUID NOT NULL REFERENCES users(id),
        published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        roster_data JSONB NOT NULL,
        CONSTRAINT unique_published_roster UNIQUE (store_id, week_start)
      )
    `);

    await pool.query(
      `INSERT INTO published_rosters (store_id, week_start, week_end, published_by, roster_data, published_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (store_id, week_start)
       DO UPDATE SET roster_data = $5, published_by = $4, published_at = NOW()`,
      [storeId, weekStart, weekEnd, managerId, JSON.stringify(rosterData)]
    );

    return { success: true };
  } catch (error) {
    console.error('[PublishedRosterService] publishRoster error:', error);
    return { success: false, error: 'Failed to publish roster' };
  }
}

/**
 * Get the published roster for an employee's store for a given week.
 * @param {string} employeeId
 * @param {string} weekStart - YYYY-MM-DD (optional, defaults to next week)
 * @returns {Promise<{ success: boolean, roster?: object, error?: string }>}
 */
async function getEmployeePublishedRoster(employeeId, weekStart) {
  try {
    // Find employee's store
    const storeRes = await pool.query(
      `SELECT sea.store_id, s.name AS store_name
       FROM store_employee_assignments sea
       JOIN stores s ON s.id = sea.store_id
       WHERE sea.employee_id = $1 LIMIT 1`,
      [employeeId]
    );
    if (storeRes.rows.length === 0) {
      return { success: false, error: 'No store assignment' };
    }
    const storeId = storeRes.rows[0].store_id;
    const storeName = storeRes.rows[0].store_name;

    // If no weekStart provided, try current week then next week
    let roster = null;
    if (weekStart) {
      const res = await pool.query(
        `SELECT * FROM published_rosters WHERE store_id = $1 AND week_start = $2`,
        [storeId, weekStart]
      );
      roster = res.rows[0] || null;
    } else {
      // Try next week first, then current week
      const now = new Date();
      const day = now.getDay();
      
      // Current week's Monday
      const diffToCurrent = day === 0 ? -6 : 1 - day;
      const currentMonday = new Date(now);
      currentMonday.setDate(now.getDate() + diffToCurrent);
      currentMonday.setHours(0, 0, 0, 0);
      
      // Next week's Monday
      const nextMonday = new Date(currentMonday);
      nextMonday.setDate(currentMonday.getDate() + 7);

      const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      // Try next week
      let res = await pool.query(
        `SELECT * FROM published_rosters WHERE store_id = $1 AND week_start = $2`,
        [storeId, formatDate(nextMonday)]
      );
      roster = res.rows[0] || null;

      // If none, try current week
      if (!roster) {
        res = await pool.query(
          `SELECT * FROM published_rosters WHERE store_id = $1 AND week_start = $2`,
          [storeId, formatDate(currentMonday)]
        );
        roster = res.rows[0] || null;
      }

      // If still none, get most recent
      if (!roster) {
        res = await pool.query(
          `SELECT * FROM published_rosters WHERE store_id = $1 ORDER BY week_start DESC LIMIT 1`,
          [storeId]
        );
        roster = res.rows[0] || null;
      }
    }

    if (!roster) {
      return { success: false, error: 'No roster has been published yet' };
    }

    // Get employee's name to highlight their row
    const empRes = await pool.query(
      `SELECT first_name, last_name FROM users WHERE id = $1`,
      [employeeId]
    );
    const empName = empRes.rows[0]
      ? (empRes.rows[0].last_name ? empRes.rows[0].first_name + ' ' + empRes.rows[0].last_name : empRes.rows[0].first_name)
      : '';

    return {
      success: true,
      roster: {
        ...roster,
        roster_data: typeof roster.roster_data === 'string' ? JSON.parse(roster.roster_data) : roster.roster_data,
        store_name: storeName,
        employee_name: empName
      }
    };
  } catch (error) {
    console.error('[PublishedRosterService] getEmployeePublishedRoster error:', error);
    return { success: false, error: 'Failed to load roster' };
  }
}

module.exports = { publishRoster, getEmployeePublishedRoster };
