const { pool } = require('../config/database');
const { getManagedStores } = require('./storeAssignmentService');

// ============================================================================
// Pure wage-arithmetic helpers (Wage_Service core)
//
// These functions are deliberately free of database access so they can be
// exercised directly with generated inputs (see design Properties 15–19).
// ============================================================================

/**
 * Worked hours = (end - start) expressed in hours.
 *
 * Requirement 8.2: compute worked hours as the difference between the shift end
 * time and the shift start time expressed in hours.
 *
 * Accepts Date instances or any value the Date constructor understands
 * (ISO strings, epoch millis). The result is NOT rounded — rounding is applied
 * when computing the earned wage (8.3).
 *
 * @param {Date|string|number} startTime - The shift start time.
 * @param {Date|string|number} endTime - The shift end time.
 * @returns {number} The number of hours between start and end.
 */
function workedHours(startTime, endTime) {
  const start = startTime instanceof Date ? startTime : new Date(startTime);
  const end = endTime instanceof Date ? endTime : new Date(endTime);
  return (end.getTime() - start.getTime()) / 3600000;
}

/**
 * Earned wage = round(workedHours * hourlyWage, 2).
 *
 * Requirements:
 *   - 8.1: earned wage is worked hours multiplied by the employee's hourly wage.
 *   - 8.2: worked hours is the end-minus-start difference in hours.
 *   - 8.3: the earned wage is rounded to two decimal places.
 *   - 8.5: if the hourly wage is not a positive number, the booking is excluded
 *     and an error is returned (here surfaced as { ok: false, error }).
 *
 * @param {Date|string|number} startTime - The shift start time.
 * @param {Date|string|number} endTime - The shift end time.
 * @param {number} hourlyWage - The employee's hourly wage.
 * @returns {{ ok: true, wage: number } | { ok: false, error: string }}
 */
function earnedWage(startTime, endTime, hourlyWage) {
  // 8.5: non-positive (or non-numeric) hourly wage is excluded.
  if (typeof hourlyWage !== 'number' || !Number.isFinite(hourlyWage) || hourlyWage <= 0) {
    return { ok: false, error: 'Hourly wage is not a positive number' };
  }

  const hours = workedHours(startTime, endTime);
  const wage = Math.round(hours * hourlyWage * 100) / 100;
  return { ok: true, wage };
}

/**
 * Sum of earned wages across a list of wage entries.
 *
 * Requirements 9.3, 10.3: the displayed total equals the sum of the earned wage
 * amounts of the listed entries. The result is rounded to two decimal places to
 * avoid floating-point drift when summing already-rounded entries.
 *
 * @param {Array<{ wageEarned: number }>} entries - Wage entries to total.
 * @returns {number} The summed earned wage, rounded to two decimal places.
 */
function totalWage(entries) {
  if (!Array.isArray(entries)) {
    return 0;
  }
  const sum = entries.reduce((acc, entry) => {
    const amount = entry && typeof entry.wageEarned === 'number' ? entry.wageEarned : 0;
    return acc + amount;
  }, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Build a WageEntry / error from a raw completed-booking row.
 *
 * A WageEntry has the shape:
 *   { bookingId, employeeId, employeeName, date, hoursWorked, wageEarned }
 *
 * Zero-wage entries are included (Requirement 9.1) — a booking whose employee
 * has a positive hourly wage but zero worked hours still produces an entry.
 * Bookings whose employee hourly wage is not positive are excluded and an error
 * identifying the affected employee is returned instead (Requirement 8.5).
 *
 * @param {Object} row - A database row with booking/employee/shift fields.
 * @returns {{ entry: Object } | { error: string }}
 */
function buildWageEntry(row) {
  const hourlyWage = parseFloat(row.hourly_wage);
  const employeeName = `${row.first_name} ${row.last_name}`;
  const result = earnedWage(row.start_time, row.end_time, hourlyWage);

  if (!result.ok) {
    // 8.5: exclude the booking and identify the affected employee.
    return { error: `Employee ${employeeName} (${row.employee_id}) has a non-positive hourly wage; wage entry excluded` };
  }

  return {
    entry: {
      bookingId: row.booking_id,
      employeeId: row.employee_id,
      employeeName,
      date: row.start_time,
      hoursWorked: Math.round(workedHours(row.start_time, row.end_time) * 100) / 100,
      wageEarned: result.wage
    }
  };
}

/**
 * Wage entries for all `completed` bookings in scope for a manager — i.e.
 * bookings whose shift belongs to a store the manager is assigned to.
 *
 * Requirements:
 *   - 8.4: only `completed` bookings contribute.
 *   - 9.1: include every in-scope completed booking, including zero-wage entries.
 *   - 9.2: each entry carries employee name, shift date, worked hours, and amount.
 *   - 9.3: callers can total the entries via totalWage().
 *   - 8.5: bookings with a non-positive hourly wage are excluded with an error.
 *
 * @param {string} managerId - The users.id of the acting store manager.
 * @returns {Promise<{ entries: Array<Object>, errors: Array<string> }>}
 */
async function getManagerWageEntries(managerId) {
  try {
    const managedStores = await getManagedStores(managerId);
    if (!managedStores.length) {
      return { entries: [], errors: [] };
    }
    const storeIds = managedStores.map(s => s.id);

    const result = await pool.query(
      `SELECT sb.id AS booking_id, u.id AS employee_id, u.first_name, u.last_name,
              u.hourly_wage, s.start_time,
              COALESCE(sb.completed_at, s.end_time) AS end_time
       FROM shift_bookings sb
       JOIN users u ON u.id = sb.employee_id
       JOIN shifts s ON s.id = sb.shift_id
       WHERE sb.booking_status = 'completed'
         AND s.store_id = ANY($1::uuid[])
       ORDER BY s.start_time ASC`,
      [storeIds]
    );

    const entries = [];
    const errors = [];
    for (const row of result.rows) {
      const built = buildWageEntry(row);
      if (built.error) {
        errors.push(built.error);
      } else {
        entries.push(built.entry);
      }
    }
    return { entries, errors };
  } catch (error) {
    console.error('[WageService] getManagerWageEntries error', {
      error: error.message,
      stack: error.stack
    });
    return { entries: [], errors: ['Wage entries could not be loaded due to a system error'] };
  }
}

/**
 * Wage entries for an employee's own `completed` bookings.
 *
 * Requirements:
 *   - 8.4: only `completed` bookings contribute.
 *   - 10.1: include each of the employee's completed bookings (incl. zero-wage).
 *   - 10.2: each entry carries the shift date, worked hours, and amount
 *     (employeeName is still included for shape consistency).
 *   - 10.3: callers can total the entries via totalWage().
 *   - 8.5: a non-positive hourly wage excludes the booking with an error.
 *
 * @param {string} employeeId - The users.id of the employee.
 * @returns {Promise<{ entries: Array<Object>, errors: Array<string> }>}
 */
async function getEmployeeWageEntries(employeeId) {
  try {
    const result = await pool.query(
      `SELECT sb.id AS booking_id, u.id AS employee_id, u.first_name, u.last_name,
              u.hourly_wage, s.start_time,
              COALESCE(sb.completed_at, s.end_time) AS end_time
       FROM shift_bookings sb
       JOIN users u ON u.id = sb.employee_id
       JOIN shifts s ON s.id = sb.shift_id
       WHERE sb.booking_status = 'completed'
         AND sb.employee_id = $1
       ORDER BY s.start_time ASC`,
      [employeeId]
    );

    const entries = [];
    const errors = [];
    for (const row of result.rows) {
      const built = buildWageEntry(row);
      if (built.error) {
        errors.push(built.error);
      } else {
        entries.push(built.entry);
      }
    }
    return { entries, errors };
  } catch (error) {
    console.error('[WageService] getEmployeeWageEntries error', {
      error: error.message,
      stack: error.stack
    });
    return { entries: [], errors: ['Wage entries could not be loaded due to a system error'] };
  }
}

/**
 * Calculate wages for all employees with completed shifts in date range.
 * Requirements: 7.1–7.9, 19.3
 */
async function calculateAllWages(startDate, endDate) {
  const result = await pool.query(
    `SELECT u.id AS employee_id, u.first_name, u.last_name, u.hourly_wage,
            s.id AS shift_id, s.start_time, s.end_time
     FROM shift_bookings sb
     JOIN users u ON u.id = sb.employee_id
     JOIN shifts s ON s.id = sb.shift_id
     WHERE sb.booking_status = 'completed'
       AND s.start_time >= $1 AND s.end_time <= $2
       AND u.role = 'employee'
     ORDER BY u.id, s.start_time`,
    [startDate, endDate]
  );

  const map = new Map();
  for (const row of result.rows) {
    const empId = row.employee_id;
    if (!map.has(empId)) {
      map.set(empId, {
        employeeId: empId,
        employeeName: `${row.first_name} ${row.last_name}`,
        hourlyRate: parseFloat(row.hourly_wage),
        totalHours: 0,
        totalWages: 0,
        periodStart: startDate,
        periodEnd: endDate,
        shiftBreakdown: []
      });
    }
    const report = map.get(empId);
    const hours = (new Date(row.end_time) - new Date(row.start_time)) / 3600000;
    const wage = hours * report.hourlyRate;
    report.totalHours += hours;
    report.totalWages += wage;
    report.shiftBreakdown.push({
      shiftId: row.shift_id,
      date: row.start_time,
      hoursWorked: Math.round(hours * 100) / 100,
      wageEarned: Math.round(wage * 100) / 100
    });
  }

  return Array.from(map.values()).map(r => ({
    ...r,
    totalHours: Math.round(r.totalHours * 100) / 100,
    totalWages: Math.round(r.totalWages * 100) / 100
  }));
}

/**
 * Calculate wages for a single employee.
 * Requirements: 7.1–7.9
 */
async function calculateEmployeeWages(employeeId, startDate, endDate) {
  const all = await calculateAllWages(startDate, endDate);
  return all.find(r => r.employeeId === employeeId) || null;
}

/**
 * Get employee's current hourly rate. Requirement: 8.3
 */
async function getHourlyRate(employeeId) {
  const result = await pool.query(
    'SELECT hourly_wage FROM users WHERE id = $1 AND role = $2',
    [employeeId, 'employee']
  );
  return result.rows.length ? parseFloat(result.rows[0].hourly_wage) : null;
}

/**
 * Update employee's hourly rate. Requirements: 8.1, 8.2
 */
async function updateHourlyRate(employeeId, newRate) {
  if (typeof newRate !== 'number' || newRate <= 0) {
    return { success: false, error: 'Hourly rate must be a positive number' };
  }
  const result = await pool.query(
    `UPDATE users SET hourly_wage = $1, updated_at = NOW()
     WHERE id = $2 AND role = 'employee' RETURNING id`,
    [newRate, employeeId]
  );
  return result.rows.length ? { success: true } : { success: false, error: 'Employee not found' };
}

module.exports = {
  calculateAllWages,
  calculateEmployeeWages,
  getHourlyRate,
  updateHourlyRate,
  workedHours,
  earnedWage,
  totalWage,
  getManagerWageEntries,
  getEmployeeWageEntries
};
