const { pool } = require('../config/database');
const { getRosterWeek } = require('./rosterService');

/**
 * Timesheet Service
 * Handles timesheet generation, submission, and retrieval.
 */

// ─── Pure Helper Functions ───────────────────────────────────────────────────

/**
 * Compute hours between two timestamps, rounded to 2 decimal places.
 * @param {Date} startTime
 * @param {Date} endTime
 * @returns {number}
 */
function computeHours(startTime, endTime) {
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  return Math.round((ms / 3600000) * 100) / 100;
}

/**
 * Validate timesheet submission preconditions.
 * @param {{ weekEnd: Date, now: Date, hasCompletedBookings: boolean, alreadySubmitted: boolean, hasReceivingManager: boolean, hasStore: boolean }} facts
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
function validateTimesheetSubmission(facts) {
  if (!facts.hasStore) {
    return { valid: false, error: 'No store assignment exists' };
  }
  if (!facts.hasReceivingManager) {
    return { valid: false, error: 'No receiving manager available' };
  }
  if (facts.alreadySubmitted) {
    return { valid: false, error: 'Timesheet already submitted for this week' };
  }
  if (new Date(facts.weekEnd).getTime() > new Date(facts.now).getTime()) {
    return { valid: false, error: 'Cannot submit timesheet for future weeks' };
  }
  if (!facts.hasCompletedBookings) {
    return { valid: false, error: 'No completed shifts to submit' };
  }
  return { valid: true };
}

/**
 * Aggregate timesheet entries by employee.
 * @param {Array} entries - Array of { employee_id, first_name, last_name, shift_date, shift_start, shift_end, hours_worked }
 * @returns {{ employees: Array, totalHours: number, employeeCount: number }}
 */
function aggregateTimesheet(entries) {
  const employeeMap = new Map();

  for (const entry of entries) {
    const key = entry.employee_id;
    if (!employeeMap.has(key)) {
      employeeMap.set(key, {
        employee_id: entry.employee_id,
        first_name: entry.first_name,
        last_name: entry.last_name,
        employment_type: entry.employment_type || null,
        shifts: [],
        totalHours: 0
      });
    }
    const emp = employeeMap.get(key);
    emp.shifts.push({
      booking_id: entry.booking_id || null,
      shift_date: entry.shift_date,
      shift_start: entry.shift_start,
      shift_end: entry.shift_end,
      hours_worked: entry.hours_worked,
      no_show: entry.no_show || false,
      adjusted: entry.adjusted_hours !== null && entry.adjusted_hours !== undefined
    });
    emp.totalHours = Math.round((emp.totalHours + entry.hours_worked) * 100) / 100;
  }

  const employees = Array.from(employeeMap.values()).sort((a, b) => {
    const lastCmp = a.last_name.localeCompare(b.last_name);
    if (lastCmp !== 0) return lastCmp;
    return a.first_name.localeCompare(b.first_name);
  });

  const totalHours = Math.round(employees.reduce((sum, e) => sum + e.totalHours, 0) * 100) / 100;
  return { employees, totalHours, employeeCount: employees.length };
}

// ─── Database Functions ──────────────────────────────────────────────────────

/**
 * Generate a timesheet for a manager's store for a given Roster_Week.
 * @param {string} managerId
 * @param {Date} weekStart
 * @param {Date} weekEnd
 * @returns {Promise<{ success: boolean, timesheet?: object, error?: string }>}
 */
async function generateTimesheet(managerId, weekStart, weekEnd) {
  // Find manager's store
  const storeRes = await pool.query(
    `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
    [managerId]
  );

  if (storeRes.rows.length === 0) {
    return { success: false, error: 'No store assignment exists' };
  }

  const storeId = storeRes.rows[0].store_id;

  // Check if already submitted
  const existingRes = await pool.query(
    `SELECT id FROM timesheets WHERE store_id = $1 AND week_start = $2`,
    [storeId, weekStart]
  );
  const alreadySubmitted = existingRes.rows.length > 0;

  // Fetch completed bookings for this store during the week
  const bookingsRes = await pool.query(
    `SELECT
       sb.id AS booking_id, sb.no_show, sb.adjusted_hours,
       u.id AS employee_id, u.first_name, u.last_name, u.employment_type,
       s.start_time AS shift_start, s.end_time AS shift_end,
       s.start_time::date AS shift_date
     FROM shift_bookings sb
     JOIN shifts s ON s.id = sb.shift_id
     JOIN users u ON u.id = sb.employee_id
     WHERE s.store_id = $1
       AND sb.booking_status = 'completed'
       AND s.start_time >= $2
       AND s.start_time <= $3
     ORDER BY u.last_name, u.first_name, s.start_time`,
    [storeId, weekStart, weekEnd]
  );

  // Compute hours for each entry (respecting no_show and adjusted_hours)
  const entries = bookingsRes.rows.map(row => {
    let hours;
    if (row.no_show) {
      hours = 0;
    } else if (row.adjusted_hours !== null && row.adjusted_hours !== undefined) {
      hours = parseFloat(row.adjusted_hours);
    } else {
      hours = computeHours(row.shift_start, row.shift_end);
    }
    return {
      ...row,
      hours_worked: hours
    };
  });

  const timesheet = aggregateTimesheet(entries);
  timesheet.alreadySubmitted = alreadySubmitted;
  timesheet.storeId = storeId;

  return { success: true, timesheet };
}

/**
 * Submit a generated timesheet to the receiving manager.
 * @param {string} managerId
 * @param {Date} weekStart
 * @param {Date} weekEnd
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function submitTimesheet(managerId, weekStart, weekEnd) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find manager's store
    const storeRes = await client.query(
      `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
      [managerId]
    );
    const hasStore = storeRes.rows.length > 0;
    const storeId = hasStore ? storeRes.rows[0].store_id : null;

    // Find receiving manager
    const rmRes = await client.query(
      `SELECT id FROM users WHERE role = 'receiving_manager' AND is_active = true LIMIT 1`
    );
    const hasReceivingManager = rmRes.rows.length > 0;
    const receivingManagerId = hasReceivingManager ? rmRes.rows[0].id : null;

    // Check duplicate
    const dupRes = await client.query(
      `SELECT id FROM timesheets WHERE store_id = $1 AND week_start = $2 FOR UPDATE`,
      [storeId, weekStart]
    );
    const alreadySubmitted = dupRes.rows.length > 0;

    // Fetch completed bookings
    const bookingsRes = await client.query(
      `SELECT
         u.id AS employee_id, u.first_name, u.last_name,
         s.start_time AS shift_start, s.end_time AS shift_end,
         s.start_time::date AS shift_date
       FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN users u ON u.id = sb.employee_id
       WHERE s.store_id = $1
         AND sb.booking_status = 'completed'
         AND s.start_time >= $2
         AND s.start_time <= $3`,
      [storeId, weekStart, weekEnd]
    );
    const hasCompletedBookings = bookingsRes.rows.length > 0;

    // Validate
    const validation = validateTimesheetSubmission({
      weekEnd,
      now: new Date(),
      hasCompletedBookings,
      alreadySubmitted,
      hasReceivingManager,
      hasStore
    });

    if (!validation.valid) {
      await client.query('ROLLBACK');
      return { success: false, error: validation.error };
    }

    // Compute timesheet data
    const entries = bookingsRes.rows.map(row => ({
      ...row,
      hours_worked: computeHours(row.shift_start, row.shift_end)
    }));
    const aggregated = aggregateTimesheet(entries);

    // Insert timesheet
    const tsRes = await client.query(
      `INSERT INTO timesheets (store_id, week_start, week_end, total_hours, employee_count, submitted_by, received_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [storeId, weekStart, weekEnd, aggregated.totalHours, aggregated.employeeCount, managerId, receivingManagerId]
    );
    const timesheetId = tsRes.rows[0].id;

    // Insert entries
    for (const emp of aggregated.employees) {
      for (const shift of emp.shifts) {
        await client.query(
          `INSERT INTO timesheet_entries (timesheet_id, employee_id, shift_date, shift_start, shift_end, hours_worked)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [timesheetId, emp.employee_id, shift.shift_date, shift.shift_start, shift.shift_end, shift.hours_worked]
        );
      }
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[TimesheetService] submitTimesheet error', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * List submitted timesheets (for receiving manager), paginated.
 * @param {number} page - 1-indexed
 * @param {number} limit - Max 50
 * @returns {Promise<{ timesheets: Array, total: number }>}
 */
async function getSubmittedTimesheets(page = 1, limit = 50) {
  limit = Math.min(limit, 50);
  const offset = (page - 1) * limit;

  const countRes = await pool.query(`SELECT COUNT(*) FROM timesheets`);
  const total = parseInt(countRes.rows[0].count, 10);

  const res = await pool.query(
    `SELECT t.id, t.week_start, t.week_end, t.total_hours, t.employee_count,
            t.submitted_at, t.status, s.name AS store_name,
            u.first_name AS submitted_first, u.last_name AS submitted_last
     FROM timesheets t
     JOIN stores s ON s.id = t.store_id
     JOIN users u ON u.id = t.submitted_by
     ORDER BY t.submitted_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return { timesheets: res.rows, total };
}

/**
 * Get detailed timesheet entries for a specific submitted timesheet.
 * @param {string} timesheetId
 * @returns {Promise<{ success: boolean, timesheet?: object, error?: string }>}
 */
async function getTimesheetDetail(timesheetId) {
  const tsRes = await pool.query(
    `SELECT t.*, s.name AS store_name,
            u1.first_name AS submitted_first, u1.last_name AS submitted_last,
            u2.first_name AS received_first, u2.last_name AS received_last
     FROM timesheets t
     JOIN stores s ON s.id = t.store_id
     JOIN users u1 ON u1.id = t.submitted_by
     JOIN users u2 ON u2.id = t.received_by
     WHERE t.id = $1`,
    [timesheetId]
  );

  if (tsRes.rows.length === 0) {
    return { success: false, error: 'Timesheet not found' };
  }

  const entriesRes = await pool.query(
    `SELECT te.*, u.first_name, u.last_name
     FROM timesheet_entries te
     JOIN users u ON u.id = te.employee_id
     WHERE te.timesheet_id = $1
     ORDER BY u.last_name, u.first_name, te.shift_date, te.shift_start`,
    [timesheetId]
  );

  // Group entries by employee
  const employeeMap = new Map();
  for (const row of entriesRes.rows) {
    const key = row.employee_id;
    if (!employeeMap.has(key)) {
      employeeMap.set(key, {
        first_name: row.first_name,
        last_name: row.last_name,
        shifts: [],
        totalHours: 0
      });
    }
    const emp = employeeMap.get(key);
    emp.shifts.push({
      shift_date: row.shift_date,
      shift_start: row.shift_start,
      shift_end: row.shift_end,
      hours_worked: parseFloat(row.hours_worked)
    });
    emp.totalHours = Math.round((emp.totalHours + parseFloat(row.hours_worked)) * 100) / 100;
  }

  return {
    success: true,
    timesheet: {
      ...tsRes.rows[0],
      employees: Array.from(employeeMap.values())
    }
  };
}

module.exports = {
  computeHours,
  validateTimesheetSubmission,
  aggregateTimesheet,
  generateTimesheet,
  submitTimesheet,
  getSubmittedTimesheets,
  getTimesheetDetail
};
