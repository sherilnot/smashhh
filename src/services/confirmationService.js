const { pool } = require('../config/database');
const { managerOwnsBooking } = require('./storeAssignmentService');

/**
 * Confirmation Service (Confirmation_Service)
 *
 * Owns manager decisions on pending booking requests: listing the in-scope
 * pending queue and confirming/rejecting individual requests. Business rules
 * are factored into pure helpers (`authorizeManagerAction`, `validateDecision`)
 * so they can be exercised with generated inputs without a database. All
 * persistence uses parameterized queries through the shared pool, multi-step
 * capacity-dependent changes wrap a `SELECT ... FOR UPDATE` transaction, and
 * expected business failures are returned as { success, error } result objects
 * (matching the existing shiftService / storeAssignmentService conventions).
 *
 * Requirements: 4.1, 4.2, 4.3, 5.1, 5.3, 5.4, 5.5, 6.1, 6.3, 6.4, 12.1, 12.2
 */

/**
 * Pure helper: decide whether a manager action is authorized.
 *
 * A confirmation/rejection/end action is allowed only when the acting user's
 * role is `store_manager` (Requirements 12.1, 5.3, 6.3) AND the target booking
 * is in scope for that manager — i.e. the manager is assigned to the store that
 * owns the booking's shift (Requirement 12.2). Any other combination is denied
 * with a `403` authorization error.
 *
 * @param {Object} facts
 * @param {string} facts.role - The acting user's role.
 * @param {boolean} facts.isInScope - Whether the target booking is in scope.
 * @returns {{ allowed: true } | { allowed: false, status: 403, error: string }}
 */
function authorizeManagerAction({ role, isInScope }) {
  // 12.1, 5.3, 6.3: only store managers may perform decision actions.
  if (role !== 'store_manager') {
    return {
      allowed: false,
      status: 403,
      error: 'Not authorized: only store managers can perform this action'
    };
  }

  // 12.2: the booking must belong to a store the manager is assigned to.
  if (!isInScope) {
    return {
      allowed: false,
      status: 403,
      error: 'Not authorized to act on this booking'
    };
  }

  return { allowed: true };
}

/**
 * Pure helper: guard a confirm/reject decision transition.
 *
 * Rules (checked in this order):
 *   - 5.4, 6.4: only bookings whose status is `pending` can be confirmed or
 *     rejected.
 *   - 5.5: for a `confirm` action, the confirmation is rejected when the
 *     current confirmed-booking count already meets or exceeds the shift
 *     capacity (confirming would exceed capacity).
 *
 * The capacity check applies only to `confirm`; rejecting a pending booking is
 * always permitted (it frees a slot).
 *
 * @param {Object} facts
 * @param {'confirm'|'reject'} facts.action - The decision being made.
 * @param {string} facts.status - The booking's current status.
 * @param {number} facts.confirmedCount - The shift's current confirmed count.
 * @param {number} facts.capacity - The shift's capacity.
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
function validateDecision({ action, status, confirmedCount, capacity }) {
  const verb = action === 'reject' ? 'rejected' : 'confirmed';

  // 5.4, 6.4: only pending bookings can be confirmed/rejected.
  if (status !== 'pending') {
    return { valid: false, error: `Only pending bookings can be ${verb}` };
  }

  // 5.5: confirming cannot exceed shift capacity.
  if (action === 'confirm' && confirmedCount >= capacity) {
    return { valid: false, error: 'Shift is at full capacity' };
  }

  return { valid: true };
}

/**
 * Get the pending booking requests in scope for a manager.
 *
 * Returns only bookings whose status is `pending` and whose shift's owning
 * store is managed by `managerId` (Requirement 4.1). Shifts with no owning
 * store (NULL store_id) are excluded via the join (Requirement 2.3). Each
 * returned request includes the employee name, shift start/end times, and the
 * owning store id (Requirement 4.2). When the manager has no managed store,
 * `hasManagedStore` is false and `requests` is empty (Requirement 4.3).
 *
 * Requirements: 4.1, 4.2, 4.3, 2.3
 *
 * @param {string} managerId - The acting manager's users.id.
 * @returns {Promise<{ hasManagedStore: boolean, requests: Array<{ bookingId: string, employeeName: string, shiftStartTime: Date, shiftEndTime: Date, storeId: string }> }>}
 */
async function getPendingRequests(managerId) {
  try {
    // 4.3: determine whether the manager is assigned to any store.
    const storeRes = await pool.query(
      `SELECT 1 FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
      [managerId]
    );
    const hasManagedStore = storeRes.rows.length > 0;
    if (!hasManagedStore) {
      return { hasManagedStore: false, requests: [] };
    }

    // 4.1, 4.2, 2.3: in-scope pending bookings on store-owned shifts only.
    // The join to store_manager_assignments on s.store_id naturally excludes
    // shifts with a NULL store_id.
    const result = await pool.query(
      `SELECT sb.id AS booking_id,
              u.first_name,
              u.last_name,
              s.start_time,
              s.end_time,
              s.store_id
       FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN store_manager_assignments sma ON sma.store_id = s.store_id
       JOIN users u ON u.id = sb.employee_id
       WHERE sma.manager_id = $1 AND sb.booking_status = 'pending'
       ORDER BY s.start_time ASC`,
      [managerId]
    );

    const requests = result.rows.map(r => ({
      bookingId: r.booking_id,
      employeeName: `${r.first_name} ${r.last_name}`,
      shiftStartTime: r.start_time,
      shiftEndTime: r.end_time,
      storeId: r.store_id
    }));

    return { hasManagedStore: true, requests };
  } catch (error) {
    console.error('[ConfirmationService] getPendingRequests error', {
      error: error.message,
      stack: error.stack
    });
    return { hasManagedStore: false, requests: [] };
  }
}

/**
 * Apply a confirm/reject decision to a pending booking.
 *
 * Shared implementation for `confirmBooking` and `rejectBooking`. Authorization
 * (Requirements 12.1, 12.2, 5.3, 6.3) is resolved via the pure
 * `authorizeManagerAction` helper, with scope determined by
 * `storeAssignmentService.managerOwnsBooking`. The read-modify-write wraps a
 * transaction that takes `SELECT ... FOR UPDATE` on the shift row before
 * counting confirmed bookings, preventing two concurrent confirms from
 * exceeding capacity (Requirement 5.5). The transition guard
 * `validateDecision` enforces pending-only (5.4, 6.4) and the capacity ceiling
 * (5.5). On success the new status is applied and the deciding manager id and
 * decision timestamp are recorded (Requirements 5.1, 5.2, 6.1, 6.2).
 *
 * @param {'confirm'|'reject'} action - The decision to apply.
 * @param {string} managerId - The acting manager's users.id.
 * @param {string} managerRole - The acting user's role.
 * @param {string} bookingId - The shift_bookings.id to decide.
 * @returns {Promise<{ success: true } | { success: false, status: 403, error: string } | { success: false, error: string }>}
 */
async function applyDecision(action, managerId, managerRole, bookingId) {
  // 12.1, 12.2, 5.3, 6.3: authorize role + scope before touching state.
  const isInScope = await managerOwnsBooking(managerId, bookingId);
  const authorization = authorizeManagerAction({
    role: managerRole,
    isInScope
  });
  if (!authorization.allowed) {
    console.error('[ConfirmationService] decision authorization denied', {
      action,
      managerId,
      bookingId,
      status: authorization.status
    });
    return {
      success: false,
      status: authorization.status,
      error: authorization.error
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve the booking and its owning shift.
    const bookingRes = await client.query(
      `SELECT sb.booking_status, sb.shift_id, s.capacity
       FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       WHERE sb.id = $1`,
      [bookingId]
    );
    if (!bookingRes.rows.length) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Booking not found' };
    }
    const booking = bookingRes.rows[0];

    // 5.5: lock the shift row before counting so concurrent confirms cannot
    // both pass the capacity check.
    await client.query('SELECT id FROM shifts WHERE id = $1 FOR UPDATE', [
      booking.shift_id
    ]);

    const confirmedRes = await client.query(
      `SELECT COUNT(*) AS count FROM shift_bookings
       WHERE shift_id = $1 AND booking_status = 'confirmed'`,
      [booking.shift_id]
    );

    // 5.4, 6.4, 5.5: apply the decision transition guard.
    const validation = validateDecision({
      action,
      status: booking.booking_status,
      confirmedCount: parseInt(confirmedRes.rows[0].count),
      capacity: booking.capacity
    });
    if (!validation.valid) {
      await client.query('ROLLBACK');
      return { success: false, error: validation.error };
    }

    // 5.1/6.1, 5.2/6.2: apply the status transition and record the decision
    // audit (deciding manager id + decision timestamp).
    const newStatus = action === 'confirm' ? 'confirmed' : 'rejected';
    await client.query(
      `UPDATE shift_bookings
       SET booking_status = $2,
           decided_by_manager_id = $3,
           decided_at = NOW()
       WHERE id = $1`,
      [bookingId, newStatus, managerId]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[ConfirmationService] applyDecision error', {
      action,
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: `${action} failed due to system error` };
  } finally {
    client.release();
  }
}

/**
 * Confirm an in-scope pending booking, setting its status to `confirmed`.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 12.1, 12.2
 *
 * @param {string} managerId - The acting manager's users.id.
 * @param {string} managerRole - The acting user's role.
 * @param {string} bookingId - The shift_bookings.id to confirm.
 * @returns {Promise<{ success: true } | { success: false, status: 403, error: string } | { success: false, error: string }>}
 */
async function confirmBooking(managerId, managerRole, bookingId) {
  return applyDecision('confirm', managerId, managerRole, bookingId);
}

/**
 * Reject an in-scope pending booking, setting its status to `rejected`. The
 * transition frees the slot the pending booking occupied (Requirement 6.5).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 12.1, 12.2
 *
 * @param {string} managerId - The acting manager's users.id.
 * @param {string} managerRole - The acting user's role.
 * @param {string} bookingId - The shift_bookings.id to reject.
 * @returns {Promise<{ success: true } | { success: false, status: 403, error: string } | { success: false, error: string }>}
 */
async function rejectBooking(managerId, managerRole, bookingId) {
  return applyDecision('reject', managerId, managerRole, bookingId);
}

module.exports = {
  authorizeManagerAction,
  validateDecision,
  getPendingRequests,
  confirmBooking,
  rejectBooking
};
