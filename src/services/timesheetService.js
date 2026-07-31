const { pool } = require('../config/database');
const { getRosterWeek } = require('./rosterService');

/**
 * Timesheet Service
 * Handles timesheet generation, submission, and retrieval.
 */

// ─── Pure Helper Functions ───────────────────────────────────────────────────

/**
 * Compute hours between two timestamps, rounded to 2 decimal places.
 * Full-day shifts (11:00–21:00) get 30 minutes deducted for lunch break.
 * @param {Date} startTime
 * @param {Date} endTime
 * @returns {number}
 */
function computeHours(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const ms = end.getTime() - start.getTime();
  let hours = Math.max(0, ms / 3600000);

  // Deduct 30-min lunch break for full-day shifts (11:00–21:00)
  if (start.getHours() === 11 && start.getMinutes() === 0 &&
      end.getHours() === 21 && end.getMinutes() === 0) {
    hours -= 0.5;
  }

  return Math.round(Math.max(0, hours) * 100) / 100;
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
  
  // Only block truly future weeks (week hasn't started yet)
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // weekEnd's Monday = weekEnd - 6 days
  const weekStartDate = new Date(facts.weekEnd);
  weekStartDate.setDate(weekStartDate.getDate() - 6);
  weekStartDate.setHours(0, 0, 0, 0);
  const isFutureWeek = weekStartDate > today;
  
  if (isFutureWeek) {
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
      actual_clock_in: entry.actual_clock_in || null,
      actual_clock_out: entry.actual_clock_out || null,
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
    `SELECT id, status FROM timesheets WHERE store_id = $1 AND week_start = $2`,
    [storeId, weekStart]
  );
  const alreadySubmitted = existingRes.rows.length > 0;
  const status = alreadySubmitted ? existingRes.rows[0].status : null;

  // Fetch completed bookings for this store during the week
  const bookingsRes = await pool.query(
    `SELECT
       sb.id AS booking_id, sb.no_show, sb.adjusted_hours,
       sb.actual_clock_in, sb.actual_clock_out, sb.completed_at,
       u.id AS employee_id, u.first_name, u.last_name, u.employment_type,
       s.start_time AS shift_start, CASE WHEN sb.completed_at IS NOT NULL AND sb.completed_at < s.end_time THEN sb.completed_at ELSE s.end_time END AS shift_end,
       s.start_time::date AS shift_date,
       s.updated_at AS shift_updated_at
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

  // Compute hours for each entry (respecting no_show, adjusted_hours, actual clock times, and early end)
  const entries = bookingsRes.rows.map(row => {
    let hours;
    if (row.no_show) {
      hours = 0;
    } else if (row.adjusted_hours !== null && row.adjusted_hours !== undefined) {
      hours = parseFloat(row.adjusted_hours);
    } else if (row.actual_clock_in && row.actual_clock_out) {
      const shiftUpdated = new Date(row.shift_updated_at || 0);
      const actualClockIn = new Date(row.actual_clock_in);
      if (shiftUpdated > actualClockIn) {
        hours = computeHours(row.shift_start, row.shift_end);
      } else {
        hours = computeHours(row.actual_clock_in, row.actual_clock_out);
      }
    } else {
      // shift_end already uses completed_at if shift was ended early (via SQL CASE)
      hours = computeHours(row.shift_start, row.shift_end);
    }
    return {
      ...row,
      hours_worked: hours
    };
  });

  const timesheet = aggregateTimesheet(entries);
  timesheet.alreadySubmitted = alreadySubmitted;
  timesheet.status = status;
  timesheet.storeId = storeId;

  return { success: true, timesheet };
}

/**
 * Submit a generated timesheet to the receiving manager (as draft).
 * Manager can resubmit multiple times until they confirm.
 * @param {string} managerId
 * @param {Date} weekStart
 * @param {Date} weekEnd
 * @returns {Promise<{ success: boolean, error?: string, timesheetId?: string }>}
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

    // Check for existing timesheet
    const existingRes = await client.query(
      `SELECT id, status FROM timesheets WHERE store_id = $1 AND week_start = $2 FOR UPDATE`,
      [storeId, weekStart]
    );

    if (existingRes.rows.length > 0 && existingRes.rows[0].status === 'confirmed') {
      await client.query('ROLLBACK');
      return { success: false, error: 'Timesheet is already confirmed and cannot be edited' };
    }

    // Fetch completed bookings
    const bookingsRes = await client.query(
      `SELECT
         sb.id AS booking_id, sb.no_show, sb.adjusted_hours, sb.actual_clock_in, sb.actual_clock_out,
         u.id AS employee_id, u.first_name, u.last_name, u.employment_type,
         s.start_time AS shift_start, CASE WHEN sb.completed_at IS NOT NULL AND sb.completed_at < s.end_time THEN sb.completed_at ELSE s.end_time END AS shift_end,
         s.start_time::date AS shift_date,
         s.updated_at AS shift_updated_at
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
      alreadySubmitted: false, // Allow resubmission
      hasReceivingManager,
      hasStore
    });

    if (!validation.valid) {
      await client.query('ROLLBACK');
      return { success: false, error: validation.error };
    }

    // Compute timesheet data
    const entries = bookingsRes.rows.map(row => {
      let hours;
      if (row.no_show) {
        hours = 0;
      } else if (row.adjusted_hours !== null && row.adjusted_hours !== undefined) {
        hours = parseFloat(row.adjusted_hours);
      } else if (row.actual_clock_in && row.actual_clock_out) {
        // Check if shift was edited AFTER actual times were recorded
        const shiftUpdated = new Date(row.shift_updated_at || 0);
        const actualClockIn = new Date(row.actual_clock_in);
        
        // If shift was edited after clock times were set, use the new shift times
        if (shiftUpdated > actualClockIn) {
          hours = computeHours(row.shift_start, row.shift_end);
        } else {
          hours = computeHours(row.actual_clock_in, row.actual_clock_out);
        }
      } else {
        hours = computeHours(row.shift_start, row.shift_end);
      }
      return {
        ...row,
        hours_worked: hours
      };
    });
    
    const aggregated = aggregateTimesheet(entries);

    let timesheetId;
    if (existingRes.rows.length > 0) {
      // Update existing draft
      timesheetId = existingRes.rows[0].id;
      await client.query(
        `UPDATE timesheets SET total_hours = $1, employee_count = $2, submitted_at = NOW()
         WHERE id = $3`,
        [aggregated.totalHours, aggregated.employeeCount, timesheetId]
      );
      
      // Delete old entries
      await client.query(`DELETE FROM timesheet_entries WHERE timesheet_id = $1`, [timesheetId]);
    } else {
      // Insert new timesheet as submitted (draft)
      const tsRes = await client.query(
        `INSERT INTO timesheets (store_id, week_start, week_end, total_hours, employee_count, submitted_by, received_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted') RETURNING id`,
        [storeId, weekStart, weekEnd, aggregated.totalHours, aggregated.employeeCount, managerId, receivingManagerId]
      );
      timesheetId = tsRes.rows[0].id;
    }

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
    return { success: true, timesheetId };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[TimesheetService] submitTimesheet error', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Confirm and lock a timesheet, sending it final to receiving manager.
 * @param {string} managerId
 * @param {Date} weekStart
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function confirmTimesheet(managerId, weekStart) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find manager's store
    const storeRes = await client.query(
      `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
      [managerId]
    );
    
    if (storeRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'No store assignment exists' };
    }

    const storeId = storeRes.rows[0].store_id;

    // Check timesheet exists and is submitted
    const tsRes = await client.query(
      `SELECT id, status FROM timesheets WHERE store_id = $1 AND week_start = $2 FOR UPDATE`,
      [storeId, weekStart]
    );

    if (tsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Timesheet not found. Please submit first.' };
    }

    if (tsRes.rows[0].status === 'confirmed') {
      await client.query('ROLLBACK');
      return { success: false, error: 'Timesheet is already confirmed' };
    }

    // Confirm the timesheet (lock it)
    await client.query(
      `UPDATE timesheets SET status = 'confirmed' WHERE id = $1`,
      [tsRes.rows[0].id]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[TimesheetService] confirmTimesheet error', error);
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

  const timesheet = tsRes.rows[0];
  const weekStart = new Date(timesheet.week_start);
  const weekEnd = new Date(timesheet.week_end);

  const entriesRes = await pool.query(
    `SELECT te.*, u.first_name, u.last_name, u.hourly_wage, u.employment_type
     FROM timesheet_entries te
     JOIN users u ON u.id = te.employee_id
     WHERE te.timesheet_id = $1
     ORDER BY u.last_name, u.first_name, te.shift_date, te.shift_start`,
    [timesheetId]
  );

  // Build day labels and dates
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayDates = [];
  const toLocalDateString = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    dayDates.push(toLocalDateString(d));
  }

  // Shift type colors (same as roster/timesheet)
  const SHIFT_TYPES = [
    { label: '11:00 – 5:30', startH: 11, startM: 0, endH: 17, endM: 30, color: '#C8E6C9' },
    { label: '5:30 – 9:00', startH: 17, startM: 30, endH: 21, endM: 0, color: '#FFF59D' },
    { label: '11:00 – 9:00', startH: 11, startM: 0, endH: 21, endM: 0, color: '#B3E5FC' }
  ];

  // Group entries by employee
  const employeeMap = new Map();
  for (const row of entriesRes.rows) {
    const key = row.employee_id;
    if (!employeeMap.has(key)) {
      employeeMap.set(key, {
        employee_id: key,
        first_name: row.first_name,
        last_name: row.last_name,
        hourly_wage: row.hourly_wage,
        employment_type: row.employment_type,
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

  // Build timesheet rows (employees × days)
  const timesheetRows = Array.from(employeeMap.values()).map(emp => {
    const byDay = Array(7).fill(null);
    let weekdayHours = 0;
    let weekendHours = 0;

    emp.shifts.forEach(shift => {
      const dateKey = shift.shift_date instanceof Date
        ? toLocalDateString(shift.shift_date)
        : toLocalDateString(new Date(shift.shift_date));
      const dayIdx = dayDates.indexOf(dateKey);
      if (dayIdx !== -1) {
        const start = new Date(shift.shift_start);
        const end = new Date(shift.shift_end);
        const startLabel = start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
        const endLabel = end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

        // Determine shift type and color
        let color = '#F8BBD0'; // soft pink for custom
        let label = startLabel + '–' + endLabel;
        
        SHIFT_TYPES.forEach(st => {
          if (start.getHours() === st.startH && start.getMinutes() === st.startM &&
              end.getHours() === st.endH && end.getMinutes() === st.endM) {
            color = st.color;
            label = st.label;
          }
        });

        byDay[dayIdx] = {
          startLabel,
          endLabel,
          label,
          color,
          hours_worked: shift.hours_worked
        };

        if (dayIdx >= 5) {
          weekendHours += shift.hours_worked;
        } else {
          weekdayHours += shift.hours_worked;
        }
      }
    });

    const totalEarned = emp.totalHours * parseFloat(emp.hourly_wage || 0);

    return {
      name: emp.last_name ? (emp.first_name + ' ' + emp.last_name) : emp.first_name,
      employmentType: emp.employment_type || null,
      hourly_wage: emp.hourly_wage,
      totalHours: emp.totalHours,
      weekdayHours: Math.round(weekdayHours * 100) / 100,
      weekendHours: Math.round(weekendHours * 100) / 100,
      totalEarned: Math.round(totalEarned * 100) / 100,
      byDay
    };
  });

  // Calculate total wages
  const totalWages = timesheetRows.reduce((sum, row) => sum + row.totalEarned, 0);

  return {
    success: true,
    timesheet: {
      ...timesheet,
      total_wages: Math.round(totalWages * 100) / 100,
      timesheetRows,
      dayLabels,
      dayDates
    }
  };
}

module.exports = {
  computeHours,
  validateTimesheetSubmission,
  aggregateTimesheet,
  generateTimesheet,
  submitTimesheet,
  confirmTimesheet,
  getSubmittedTimesheets,
  getTimesheetDetail
};
