const { pool } = require('../config/database');

/**
 * Get available shifts in date range (future shifts with remaining capacity).
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 19.2
 */
async function getAvailableShifts(startDate, endDate) {
  const result = await pool.query(
    `SELECT s.id, s.start_time, s.end_time, s.store_location, s.capacity,
            COUNT(sb.id) FILTER (WHERE sb.booking_status = 'confirmed') AS current_bookings
     FROM shifts s
     LEFT JOIN shift_bookings sb ON sb.shift_id = s.id
     WHERE s.start_time >= $1 AND s.start_time <= $2 AND s.start_time > NOW()
     GROUP BY s.id
     HAVING COUNT(sb.id) FILTER (WHERE sb.booking_status = 'confirmed') < s.capacity
     ORDER BY s.start_time ASC`,
    [startDate, endDate]
  );
  return result.rows.map(r => ({
    id: r.id,
    startTime: r.start_time,
    endTime: r.end_time,
    storeLocation: r.store_location,
    capacity: r.capacity,
    currentBookings: parseInt(r.current_bookings)
  }));
}

/**
 * Book a shift for an employee with capacity check and row locking.
 * Requirements: 5.1–5.7, 15.1–15.4, 16.1, 16.2
 */
async function bookShift(employeeId, shiftId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate shift exists and is in the future
    const shiftRes = await client.query(
      'SELECT id, start_time, capacity FROM shifts WHERE id = $1',
      [shiftId]
    );
    if (!shiftRes.rows.length) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Shift not found' };
    }
    if (new Date(shiftRes.rows[0].start_time) <= new Date()) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Cannot book past or current shifts' };
    }

    // Check for duplicate booking
    const dupRes = await client.query(
      `SELECT id FROM shift_bookings
       WHERE shift_id = $1 AND employee_id = $2 AND booking_status = 'confirmed'`,
      [shiftId, employeeId]
    );
    if (dupRes.rows.length) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Shift already booked' };
    }

    // Lock and check capacity
    const countRes = await client.query(
      `SELECT COUNT(*) AS count FROM shift_bookings
       WHERE shift_id = $1 AND booking_status = 'confirmed' FOR UPDATE`,
      [shiftId]
    );
    if (parseInt(countRes.rows[0].count) >= shiftRes.rows[0].capacity) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Shift is at full capacity' };
    }

    await client.query(
      `INSERT INTO shift_bookings (shift_id, employee_id, booking_status)
       VALUES ($1, $2, 'confirmed')`,
      [shiftId, employeeId]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[ShiftService] bookShift error', { error: error.message, stack: error.stack });
    return { success: false, error: 'Booking failed due to system error' };
  } finally {
    client.release();
  }
}

/**
 * Cancel a confirmed booking for an employee.
 * Requirements: 6.1–6.4
 */
async function cancelShift(employeeId, shiftId) {
  const result = await pool.query(
    `UPDATE shift_bookings
     SET booking_status = 'cancelled', cancelled_at = NOW()
     WHERE shift_id = $1 AND employee_id = $2 AND booking_status = 'confirmed'
     RETURNING id`,
    [shiftId, employeeId]
  );
  if (!result.rows.length) {
    return { success: false, error: 'No confirmed booking found for this shift' };
  }
  return { success: true };
}

/**
 * Get all bookings for an employee within a date range.
 * Requirements: 4.1, 4.5
 */
async function getEmployeeShifts(employeeId, startDate, endDate) {
  const result = await pool.query(
    `SELECT s.id, s.start_time, s.end_time, s.store_location, s.capacity,
            sb.booking_status, sb.booked_at
     FROM shift_bookings sb
     JOIN shifts s ON s.id = sb.shift_id
     WHERE sb.employee_id = $1 AND s.start_time >= $2 AND s.start_time <= $3
     ORDER BY s.start_time ASC`,
    [employeeId, startDate, endDate]
  );
  return result.rows.map(r => ({
    id: r.id,
    startTime: r.start_time,
    endTime: r.end_time,
    storeLocation: r.store_location,
    capacity: r.capacity,
    bookingStatus: r.booking_status,
    bookedAt: r.booked_at
  }));
}

module.exports = { getAvailableShifts, bookShift, cancelShift, getEmployeeShifts };
