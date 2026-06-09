const { pool } = require('../config/database');

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

module.exports = { calculateAllWages, calculateEmployeeWages, getHourlyRate, updateHourlyRate };
