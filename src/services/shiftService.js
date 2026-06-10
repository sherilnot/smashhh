const { pool } = require('../config/database');
const { managerOwnsBooking } = require('./storeAssignmentService');

/**
 * Statuses that occupy a shift's capacity. A booking counts against capacity
 * while it is awaiting a manager decision (`pending`) or has been approved
 * (`confirmed`). Requirement 3.5.
 */
const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed'];

/**
 * The complete set of valid Booking_Status values. Used when listing an
 * employee's bookings: a status that is not one of these (i.e. temporarily
 * unavailable) is mapped to `null` rather than dropping the booking
 * (Requirement 11.3).
 */
const VALID_BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'rejected',
  'completed',
  'cancelled',
  'no_show'
];

/**
 * Pure helper: count the bookings that occupy a shift's capacity.
 *
 * Occupied capacity is the number of bookings whose status is `pending` or
 * `confirmed` (Requirement 3.5). Extracted as a pure function so the rule can
 * be exercised with generated inputs without a database. Accepts a list of
 * booking-like values: each entry may be a plain status string or an object
 * exposing `status` or `bookingStatus`.
 *
 * @param {Array<string|{status?: string, bookingStatus?: string}>} bookings
 * @returns {number} The count of pending + confirmed bookings.
 */
function occupiedCount(bookings) {
  if (!Array.isArray(bookings)) {
    return 0;
  }
  return bookings.reduce((count, booking) => {
    const status =
      typeof booking === 'string'
        ? booking
        : booking && (booking.status || booking.bookingStatus);
    return ACTIVE_BOOKING_STATUSES.includes(status) ? count + 1 : count;
  }, 0);
}

/**
 * Pure helper: validate a booking request against its resolved preconditions.
 *
 * Rules (checked in this order):
 *   - 3.4: a shift whose start time is in the past or equal to now cannot be
 *     booked.
 *   - 3.3: an employee who already has an active (`pending`/`confirmed`)
 *     booking for the shift cannot book it again.
 *   - 3.6: a shift whose occupied capacity equals (or exceeds) its capacity is
 *     full and cannot be booked.
 *
 * @param {Object} facts
 * @param {Date|string|number} facts.shiftStartTime - The shift's start time.
 * @param {Date|string|number} facts.now - The current time.
 * @param {number} facts.capacity - The shift's capacity.
 * @param {number} facts.occupied - The current occupied count (pending+confirmed).
 * @param {boolean} facts.employeeHasActiveBooking - Whether the employee already
 *   has a pending/confirmed booking for the shift.
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
function validateBookingRequest({
  shiftStartTime,
  now,
  capacity,
  occupied,
  employeeHasActiveBooking
}) {
  // 3.4: past or current shifts cannot be booked.
  if (new Date(shiftStartTime) <= new Date(now)) {
    return { valid: false, error: 'Cannot book past or current shifts' };
  }

  // 3.3: an active booking already exists for this employee on this shift.
  if (employeeHasActiveBooking) {
    return { valid: false, error: 'A booking already exists for this shift' };
  }

  // 3.6: the shift is at full capacity.
  if (occupied >= capacity) {
    return { valid: false, error: 'Shift is at full capacity' };
  }

  return { valid: true };
}

/**
 * Pure helper: guard the end-shift (complete) transition.
 *
 * Rules (checked in this order):
 *   - 7.4: only bookings whose status is `confirmed` can be ended.
 *   - 7.5: a shift cannot be ended before its start time (start strictly in the
 *     future).
 *
 * @param {Object} facts
 * @param {string} facts.status - The booking's current status.
 * @param {Date|string|number} facts.shiftStartTime - The shift's start time.
 * @param {Date|string|number} facts.now - The current time.
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
function validateEndShift({ status, shiftStartTime, now }) {
  // 7.4: only confirmed bookings can be ended.
  if (status !== 'confirmed') {
    return { valid: false, error: 'Only confirmed bookings can be ended' };
  }

  // 7.5: a shift cannot be ended before it begins.
  if (new Date(shiftStartTime) > new Date(now)) {
    return { valid: false, error: 'A shift cannot be ended before it begins' };
  }

  return { valid: true };
}

/**
 * Get available shifts in date range (future shifts with remaining capacity).
 *
 * Occupied capacity counts both `pending` and `confirmed` bookings
 * (Requirement 3.5), and every returned shift includes its owning store id
 * (Requirement 2.2).
 *
 * Requirements: 2.2, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 19.2
 */
async function getAvailableShifts(startDate, endDate) {
  const result = await pool.query(
    `SELECT s.id, s.start_time, s.end_time, s.store_location, s.store_id, s.capacity,
            COUNT(sb.id) FILTER (WHERE sb.booking_status IN ('pending','confirmed')) AS current_bookings
     FROM shifts s
     LEFT JOIN shift_bookings sb ON sb.shift_id = s.id
     WHERE s.start_time >= $1 AND s.start_time <= $2 AND s.start_time > NOW()
     GROUP BY s.id
     HAVING COUNT(sb.id) FILTER (WHERE sb.booking_status IN ('pending','confirmed')) < s.capacity
     ORDER BY s.start_time ASC`,
    [startDate, endDate]
  );
  return result.rows.map(r => ({
    id: r.id,
    startTime: r.start_time,
    endTime: r.end_time,
    storeLocation: r.store_location,
    storeId: r.store_id,
    capacity: r.capacity,
    currentBookings: parseInt(r.current_bookings)
  }));
}

/**
 * Book a shift for an employee with capacity check and row locking.
 *
 * The booking is created with status `pending` (Requirement 3.1) inside the
 * existing `FOR UPDATE` transaction. Occupied capacity counts both `pending`
 * and `confirmed` bookings (3.5), the duplicate-active check considers both
 * states (3.3), past/current shifts are rejected (3.4), and full shifts are
 * rejected (3.6). On success the pending request is routed to the managers of
 * the shift's owning store (Requirement 3.2) by returning their ids as
 * `routedManagerIds`.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 *
 * @returns {Promise<{ success: true, routedManagerIds: string[] } | { success: false, error: string }>}
 */
async function bookShift(employeeId, shiftId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate the shift exists and fetch the facts needed for validation.
    const shiftRes = await client.query(
      'SELECT id, start_time, capacity, store_id FROM shifts WHERE id = $1',
      [shiftId]
    );
    if (!shiftRes.rows.length) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Shift not found' };
    }
    const shift = shiftRes.rows[0];

    // Lock the shift row before counting so concurrent bookings cannot both
    // pass the capacity check.
    await client.query('SELECT id FROM shifts WHERE id = $1 FOR UPDATE', [shiftId]);

    // 3.3: duplicate active booking check spans pending OR confirmed.
    const dupRes = await client.query(
      `SELECT id FROM shift_bookings
       WHERE shift_id = $1 AND employee_id = $2
         AND booking_status IN ('pending','confirmed')`,
      [shiftId, employeeId]
    );

    // 3.5: occupied capacity counts pending + confirmed bookings.
    const countRes = await client.query(
      `SELECT COUNT(*) AS count FROM shift_bookings
       WHERE shift_id = $1 AND booking_status IN ('pending','confirmed')`,
      [shiftId]
    );

    // Apply the pure precondition rules (3.3, 3.4, 3.6).
    const validation = validateBookingRequest({
      shiftStartTime: shift.start_time,
      now: new Date(),
      capacity: shift.capacity,
      occupied: parseInt(countRes.rows[0].count),
      employeeHasActiveBooking: dupRes.rows.length > 0
    });
    if (!validation.valid) {
      await client.query('ROLLBACK');
      return { success: false, error: validation.error };
    }

    // 3.1: create the booking as pending.
    await client.query(
      `INSERT INTO shift_bookings (shift_id, employee_id, booking_status)
       VALUES ($1, $2, 'pending')`,
      [shiftId, employeeId]
    );

    // 3.2: route the pending request to the managers of the owning store.
    let routedManagerIds = [];
    if (shift.store_id) {
      const managersRes = await client.query(
        `SELECT manager_id FROM store_manager_assignments WHERE store_id = $1`,
        [shift.store_id]
      );
      routedManagerIds = managersRes.rows.map(r => r.manager_id);
    }

    await client.query('COMMIT');
    return { success: true, routedManagerIds };
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
 *
 * Every booking is returned regardless of its status, and each record includes
 * its `bookingStatus` (Requirements 11.1, 11.2). Per Requirement 11.3, when a
 * booking's status is temporarily unavailable (missing, or not one of the six
 * valid Booking_Status values) the booking is still returned with
 * `bookingStatus` set to `null` rather than being omitted from the list.
 *
 * Requirements: 11.1, 11.2, 11.3
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
    // 11.3: map a temporarily unavailable status to null instead of dropping
    // the booking.
    bookingStatus: VALID_BOOKING_STATUSES.includes(r.booking_status)
      ? r.booking_status
      : null,
    bookedAt: r.booked_at
  }));
}

/**
 * End (complete) a shift for an in-scope confirmed booking.
 *
 * Authorization (Requirements 7.3, 12.1, 12.2): the action is only allowed when
 * the manager is assigned to the store that owns the booking's shift. Scope is
 * resolved via `storeAssignmentService.managerOwnsBooking`; an out-of-scope or
 * unknown booking yields a `403` authorization error.
 *
 * Transition guard (Requirements 7.4, 7.5): the pure `validateEndShift` helper
 * enforces that only `confirmed` bookings can be ended and that a shift cannot
 * be ended before its start time.
 *
 * On success (Requirements 7.1, 7.2) the booking's status is set to `completed`
 * and the ending manager id and completion timestamp are recorded.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 *
 * @param {string} managerId - The acting store manager's users.id.
 * @param {string} bookingId - The shift_bookings.id to complete.
 * @returns {Promise<{ success: true } | { success: false, status: 403, error: string } | { success: false, error: string }>}
 */
async function endShift(managerId, bookingId) {
  try {
    // 7.3, 12.2: the booking must be in scope for the acting manager.
    const inScope = await managerOwnsBooking(managerId, bookingId);
    if (!inScope) {
      console.error('[ShiftService] endShift authorization denied', {
        managerId,
        bookingId,
        status: 403
      });
      return {
        success: false,
        status: 403,
        error: 'Not authorized to end this shift'
      };
    }

    // Fetch the facts needed by the transition guard.
    const bookingRes = await pool.query(
      `SELECT sb.booking_status, s.start_time
       FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       WHERE sb.id = $1`,
      [bookingId]
    );
    if (!bookingRes.rows.length) {
      return { success: false, error: 'Booking not found' };
    }
    const booking = bookingRes.rows[0];

    // 7.4, 7.5: apply the end-shift transition guard.
    const validation = validateEndShift({
      status: booking.booking_status,
      shiftStartTime: booking.start_time,
      now: new Date()
    });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // 7.1, 7.2: complete the booking and record the completion audit.
    await pool.query(
      `UPDATE shift_bookings
       SET booking_status = 'completed',
           completed_by_manager_id = $2,
           completed_at = NOW()
       WHERE id = $1`,
      [bookingId, managerId]
    );

    return { success: true };
  } catch (error) {
    console.error('[ShiftService] endShift error', {
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: 'End shift failed due to system error' };
  }
}

module.exports = {
  occupiedCount,
  validateBookingRequest,
  validateEndShift,
  getAvailableShifts,
  bookShift,
  cancelShift,
  getEmployeeShifts,
  endShift
};
