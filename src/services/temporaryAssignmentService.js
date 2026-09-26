const { pool } = require('../config/database');

/**
 * Temporary Assignment Service
 * Handles temporary store assignments for employees to work shifts at other stores.
 */

/**
 * Create a temporary assignment and book a shift for an employee at a different store
 * @param {string} managerId - Manager making the assignment
 * @param {string} employeeId - Employee being assigned
 * @param {string} shiftId - Shift at the other store
 * @param {string} notes - Optional notes about the assignment
 * @returns {Promise<{success: boolean, bookingId?: string, assignmentId?: string, error?: string}>}
 */
async function createTemporaryAssignment(managerId, employeeId, shiftId, notes = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Validate that the manager has permission (owns a store)
    const managerStoreRes = await client.query(
      `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
      [managerId]
    );
    
    if (managerStoreRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Manager has no store assignment' };
    }
    
    const managerStoreId = managerStoreRes.rows[0].store_id;

    // 2. Validate the shift exists and get its store
    const shiftRes = await client.query(
      `SELECT id, start_time, capacity, store_id FROM shifts WHERE id = $1`,
      [shiftId]
    );
    
    if (shiftRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Shift not found' };
    }
    
    const shift = shiftRes.rows[0];
    
    if (!shift.store_id) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Shift has no store assignment' };
    }

    // 3. Get employee's home store
    const employeeStoreRes = await client.query(
      `SELECT store_id FROM store_employee_assignments WHERE employee_id = $1`,
      [employeeId]
    );
    
    if (employeeStoreRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Employee has no store assignment' };
    }
    
    const fromStoreId = employeeStoreRes.rows[0].store_id;
    const toStoreId = shift.store_id;

    // 4. SECURITY: Verify the shift belongs to the manager's store
    if (toStoreId !== managerStoreId) {
      await client.query('ROLLBACK');
      return { success: false, error: 'You can only assign employees to shifts at your own store' };
    }

    // 5. Validate that stores are different
    if (fromStoreId === toStoreId) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Employee is already assigned to this store' };
    }

    // 6. Validate the shift is not in the past
    if (new Date(shift.start_time) <= new Date()) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Cannot assign to past shifts' };
    }

    // 6. Check if employee already has an active booking for this shift
    const existingBookingRes = await client.query(
      `SELECT id FROM shift_bookings 
       WHERE shift_id = $1 AND employee_id = $2 
       AND booking_status IN ('pending', 'confirmed')`,
      [shiftId, employeeId]
    );
    
    if (existingBookingRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Employee already has a booking for this shift' };
    }

    // 7. Check shift capacity
    const capacityRes = await client.query(
      `SELECT COUNT(*) as count FROM shift_bookings 
       WHERE shift_id = $1 AND booking_status IN ('pending', 'confirmed')`,
      [shiftId]
    );
    
    const currentBookings = parseInt(capacityRes.rows[0].count);
    if (currentBookings >= shift.capacity) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Shift is at full capacity' };
    }

    // 8. Create the shift booking as confirmed (manager-initiated)
    const bookingRes = await client.query(
      `INSERT INTO shift_bookings 
       (shift_id, employee_id, booking_status, decided_by_manager_id, decided_at, is_temporary_assignment)
       VALUES ($1, $2, 'confirmed', $3, NOW(), true)
       RETURNING id`,
      [shiftId, employeeId, managerId]
    );
    
    const bookingId = bookingRes.rows[0].id;

    // 9. Create the temporary assignment record
    const assignmentRes = await client.query(
      `INSERT INTO temporary_store_assignments 
       (shift_booking_id, employee_id, from_store_id, to_store_id, assigned_by_manager_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [bookingId, employeeId, fromStoreId, toStoreId, managerId, notes]
    );
    
    const assignmentId = assignmentRes.rows[0].id;

    await client.query('COMMIT');
    return { success: true, bookingId, assignmentId };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[TemporaryAssignmentService] createTemporaryAssignment error', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get temporary assignments for a manager's store (incoming employees)
 * @param {string} managerId - Manager requesting the list
 * @returns {Promise<Array>}
 */
async function getIncomingAssignments(managerId) {
  const result = await pool.query(
    `SELECT 
       ta.id, ta.notes, ta.assigned_at,
       u.id AS employee_id, u.first_name, u.last_name, u.email,
       s.id AS shift_id, s.start_time, s.end_time, s.store_location,
       from_store.name AS from_store_name,
       sb.booking_status,
       assigner.first_name AS assigned_by_first_name,
       assigner.last_name AS assigned_by_last_name
     FROM temporary_store_assignments ta
     JOIN shift_bookings sb ON ta.shift_booking_id = sb.id
     JOIN shifts s ON sb.shift_id = s.id
     JOIN users u ON ta.employee_id = u.id
     JOIN stores from_store ON ta.from_store_id = from_store.id
     JOIN users assigner ON ta.assigned_by_manager_id = assigner.id
     WHERE ta.to_store_id = (
       SELECT store_id FROM store_manager_assignments 
       WHERE manager_id = $1 LIMIT 1
     )
     AND sb.booking_status IN ('confirmed', 'completed')
     ORDER BY s.start_time ASC`,
    [managerId]
  );
  
  return result.rows;
}

/**
 * Get temporary assignments sent from a manager's store (outgoing employees)
 * @param {string} managerId - Manager requesting the list
 * @returns {Promise<Array>}
 */
async function getOutgoingAssignments(managerId) {
  const result = await pool.query(
    `SELECT 
       ta.id, ta.notes, ta.assigned_at,
       u.id AS employee_id, u.first_name, u.last_name, u.email,
       s.id AS shift_id, s.start_time, s.end_time, s.store_location,
       to_store.name AS to_store_name,
       sb.booking_status,
       assigner.first_name AS assigned_by_first_name,
       assigner.last_name AS assigned_by_last_name
     FROM temporary_store_assignments ta
     JOIN shift_bookings sb ON ta.shift_booking_id = sb.id
     JOIN shifts s ON sb.shift_id = s.id
     JOIN users u ON ta.employee_id = u.id
     JOIN stores to_store ON ta.to_store_id = to_store.id
     JOIN users assigner ON ta.assigned_by_manager_id = assigner.id
     WHERE ta.from_store_id = (
       SELECT store_id FROM store_manager_assignments 
       WHERE manager_id = $1 LIMIT 1
     )
     AND sb.booking_status IN ('confirmed', 'completed')
     ORDER BY s.start_time ASC`,
    [managerId]
  );
  
  return result.rows;
}

/**
 * Cancel a temporary assignment (only if shift hasn't started)
 * @param {string} managerId - Manager cancelling the assignment
 * @param {string} assignmentId - Assignment to cancel
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function cancelTemporaryAssignment(managerId, assignmentId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get the assignment and validate permissions
    const assignmentRes = await client.query(
      `SELECT ta.*, s.start_time, sb.booking_status
       FROM temporary_store_assignments ta
       JOIN shift_bookings sb ON ta.shift_booking_id = sb.id
       JOIN shifts s ON sb.shift_id = s.id
       WHERE ta.id = $1`,
      [assignmentId]
    );
    
    if (assignmentRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Assignment not found' };
    }
    
    const assignment = assignmentRes.rows[0];

    // Verify manager has permission (owns either the from_store or to_store)
    const permissionRes = await client.query(
      `SELECT 1 FROM store_manager_assignments 
       WHERE manager_id = $1 
       AND (store_id = $2 OR store_id = $3)`,
      [managerId, assignment.from_store_id, assignment.to_store_id]
    );
    
    if (permissionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'No permission to cancel this assignment' };
    }

    // Check if shift has already started
    if (new Date(assignment.start_time) <= new Date()) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Cannot cancel assignment for shift that has started' };
    }

    // Check if booking is already completed
    if (assignment.booking_status === 'completed') {
      await client.query('ROLLBACK');
      return { success: false, error: 'Cannot cancel completed shift' };
    }

    // Cancel the shift booking
    await client.query(
      `UPDATE shift_bookings 
       SET booking_status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1`,
      [assignment.shift_booking_id]
    );

    // Delete the temporary assignment record (will cascade with ON DELETE)
    await client.query(
      `DELETE FROM temporary_store_assignments WHERE id = $1`,
      [assignmentId]
    );

    await client.query('COMMIT');
    return { success: true };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[TemporaryAssignmentService] cancelTemporaryAssignment error', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get employees from other stores available for temporary assignment
 * @param {string} managerId - Manager requesting the list
 * @returns {Promise<Array>}
 */
async function getAvailableEmployees(managerId) {
  const result = await pool.query(
    `SELECT 
       u.id, u.first_name, u.last_name, u.email, u.phone_number, u.employment_type,
       s.id AS store_id, s.name AS store_name
     FROM users u
     JOIN store_employee_assignments sea ON u.id = sea.employee_id
     JOIN stores s ON sea.store_id = s.id
     WHERE u.role = 'employee' 
     AND u.is_active = true
     AND sea.store_id != (
       SELECT store_id FROM store_manager_assignments 
       WHERE manager_id = $1 LIMIT 1
     )
     ORDER BY s.name, u.last_name, u.first_name`,
    [managerId]
  );
  
  return result.rows;
}

module.exports = {
  createTemporaryAssignment,
  getIncomingAssignments,
  getOutgoingAssignments,
  cancelTemporaryAssignment,
  getAvailableEmployees
};
