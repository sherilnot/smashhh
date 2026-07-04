const { pool } = require('../config/database');

/**
 * Priority Service
 * Calculates employee priority scores based on completed shift history.
 * Higher score = more reliable worker = gets auto-assigned to future roster.
 *
 * Score formula: total completed hours in the last 8 weeks.
 * Employees with more hours get higher priority.
 */

/**
 * Recalculate priority scores for all employees in a given store.
 * Looks at the last 8 weeks of completed shifts.
 * @param {string} storeId
 * @returns {Promise<Array<{ employee_id, first_name, last_name, priority_score }>>}
 */
async function recalculatePriority(storeId) {
  const eightWeeksAgo = new Date();
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

  const res = await pool.query(
    `SELECT
       u.id AS employee_id, u.first_name, u.last_name,
       COALESCE(SUM(
         CASE WHEN sb.no_show THEN 0
              WHEN sb.adjusted_hours IS NOT NULL THEN sb.adjusted_hours
              ELSE EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600
         END
       ), 0) AS total_hours
     FROM users u
     JOIN store_employee_assignments sea ON sea.employee_id = u.id
     LEFT JOIN shift_bookings sb ON sb.employee_id = u.id AND sb.booking_status = 'completed'
     LEFT JOIN shifts s ON s.id = sb.shift_id AND s.store_id = $1 AND s.start_time >= $2
     WHERE sea.store_id = $1
       AND u.role = 'employee'
       AND u.is_active = true
     GROUP BY u.id, u.first_name, u.last_name
     ORDER BY total_hours DESC`,
    [storeId, eightWeeksAgo]
  );

  // Update priority_score for each employee
  for (const row of res.rows) {
    await pool.query(
      `UPDATE users SET priority_score = $1 WHERE id = $2`,
      [parseFloat(row.total_hours), row.employee_id]
    );
  }

  return res.rows.map(r => ({
    employee_id: r.employee_id,
    first_name: r.first_name,
    last_name: r.last_name,
    priority_score: parseFloat(r.total_hours)
  }));
}

/**
 * Get employees for a store ranked by priority (highest first).
 * @param {string} storeId
 * @returns {Promise<Array<{ id, first_name, last_name, priority_score, employment_type }>>}
 */
async function getEmployeesByPriority(storeId) {
  const res = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, u.priority_score, u.employment_type
     FROM users u
     JOIN store_employee_assignments sea ON sea.employee_id = u.id
     WHERE sea.store_id = $1
       AND u.role = 'employee'
       AND u.is_active = true
     ORDER BY u.priority_score DESC, u.last_name, u.first_name`,
    [storeId]
  );
  return res.rows;
}

/**
 * Auto-fill a roster week with top-priority employees for shifts that have no bookings yet.
 * Assigns the top N employees (up to shift capacity) to each unassigned shift.
 * @param {string} managerId
 * @param {string} storeId
 * @param {Date} weekStart
 * @param {Date} weekEnd
 * @returns {Promise<{ assigned: number }>}
 */
async function autoFillRoster(managerId, storeId, weekStart, weekEnd) {
  // Get top employees by priority
  const employees = await getEmployeesByPriority(storeId);
  if (employees.length === 0) return { assigned: 0 };

  // Get shifts for this week that belong to this store
  const shiftsRes = await pool.query(
    `SELECT s.id, s.capacity
     FROM shifts s
     WHERE s.store_id = $1
       AND s.start_time >= $2
       AND s.start_time <= $3
     ORDER BY s.start_time`,
    [storeId, weekStart, weekEnd]
  );

  let totalAssigned = 0;

  for (const shift of shiftsRes.rows) {
    // Check existing confirmed bookings for this shift
    const existingRes = await pool.query(
      `SELECT employee_id FROM shift_bookings WHERE shift_id = $1 AND booking_status = 'confirmed'`,
      [shift.id]
    );
    const existingEmployees = new Set(existingRes.rows.map(r => r.employee_id));
    const spotsLeft = shift.capacity - existingEmployees.size;

    if (spotsLeft <= 0) continue;

    // Assign top-priority employees who aren't already booked
    let filled = 0;
    for (const emp of employees) {
      if (filled >= spotsLeft) break;
      if (existingEmployees.has(emp.id)) continue;

      await pool.query(
        `INSERT INTO shift_bookings (shift_id, employee_id, booking_status, assigned_by)
         VALUES ($1, $2, 'confirmed', $3)
         ON CONFLICT DO NOTHING`,
        [shift.id, emp.id, managerId]
      );
      filled++;
      totalAssigned++;
    }
  }

  return { assigned: totalAssigned };
}

module.exports = {
  recalculatePriority,
  getEmployeesByPriority,
  autoFillRoster
};
