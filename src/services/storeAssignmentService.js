const { pool } = require('../config/database');

/**
 * Store Assignment Service (Store_Assignment_Service)
 *
 * Owns store creation and the assignment of store managers to stores so that
 * employee booking requests can be routed to the manager(s) of the owning
 * store. All persistence uses parameterized queries through the shared pool,
 * and expected business failures are returned as { success, error } result
 * objects (matching the existing shiftService / authService conventions).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 */

/**
 * Pure validation of an assignment given resolved facts. Extracted so the rule
 * can be exercised without a database.
 *
 * Rules:
 *   - 1.6: if the referenced user's role cannot be determined (null/undefined),
 *     the assignment is rejected with a "could not be validated" error.
 *   - 1.5: if the resolved role is not `store_manager`, the assignment is
 *     rejected with an error identifying the invalid role.
 *   - 1.7: if the referenced store does not exist, the assignment is rejected
 *     with a missing-store error.
 *
 * @param {Object} facts
 * @param {string|null|undefined} facts.targetRole - The resolved role of the
 *   user being assigned, or null/undefined when it could not be determined.
 * @param {boolean} facts.storeExists - Whether the referenced store exists.
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
function validateAssignment({ targetRole, storeExists }) {
  // 1.6: role could not be determined.
  if (targetRole === null || targetRole === undefined) {
    return { valid: false, error: 'User role could not be validated' };
  }

  // 1.5: role determined but not a store manager.
  if (targetRole !== 'store_manager') {
    return {
      valid: false,
      error: `Cannot assign user with role '${targetRole}': only store_manager users can be assigned to a store`
    };
  }

  // 1.7: store must exist.
  if (!storeExists) {
    return { valid: false, error: 'Referenced store does not exist' };
  }

  return { valid: true };
}

/**
 * Create a store with the given name.
 *
 * Requirement 1.1: persist each Store with a unique identifier and a name.
 *
 * @param {string} name - The store name.
 * @returns {Promise<{ success: true, store: { id: string, name: string } } | { success: false, error: string }>}
 */
async function createStore(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    return { success: false, error: 'Store name is required' };
  }

  try {
    const result = await pool.query(
      'INSERT INTO stores (name) VALUES ($1) RETURNING id, name',
      [name.trim()]
    );
    const row = result.rows[0];
    return { success: true, store: { id: row.id, name: row.name } };
  } catch (error) {
    console.error('[StoreAssignmentService] createStore error', {
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: 'Store creation failed due to system error' };
  }
}

/**
 * Assign a store manager to a store.
 *
 * Resolves the target user's role (1.6), validates it is `store_manager` (1.5),
 * verifies the store exists (1.7), then persists the association idempotently
 * using `INSERT ... ON CONFLICT DO NOTHING` so assigning the same pair more
 * than once retains exactly one association (1.8). A many-to-many join table
 * supports one store having many managers (1.3) and one manager belonging to
 * many stores (1.4).
 *
 * Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 *
 * @param {string} managerId - The users.id of the user being assigned.
 * @param {string} storeId - The stores.id to assign the manager to.
 * @returns {Promise<{ success: true } | { success: false, error: string }>}
 */
async function assignManagerToStore(managerId, storeId) {
  try {
    // Resolve the target user's role (1.6 — undeterminable when no such user).
    const userRes = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [managerId]
    );
    const targetRole = userRes.rows.length ? userRes.rows[0].role : null;

    // Determine whether the referenced store exists (1.7).
    const storeRes = await pool.query(
      'SELECT id FROM stores WHERE id = $1',
      [storeId]
    );
    const storeExists = storeRes.rows.length > 0;

    // Apply the pure validation rules (1.5, 1.6, 1.7).
    const validation = validateAssignment({ targetRole, storeExists });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Persist the association idempotently (1.2, 1.8). The UNIQUE
    // (store_id, manager_id) constraint guarantees a single association.
    await pool.query(
      `INSERT INTO store_manager_assignments (store_id, manager_id)
       VALUES ($1, $2)
       ON CONFLICT (store_id, manager_id) DO NOTHING`,
      [storeId, managerId]
    );

    return { success: true };
  } catch (error) {
    console.error('[StoreAssignmentService] assignManagerToStore error', {
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: 'Assignment failed due to system error' };
  }
}

/**
 * List the stores managed by a given manager. Used for scope checks.
 *
 * Requirements: 1.3, 1.4 (supports many-to-many lookups).
 *
 * @param {string} managerId - The users.id of the manager.
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
async function getManagedStores(managerId) {
  try {
    const result = await pool.query(
      `SELECT s.id, s.name
       FROM store_manager_assignments sma
       JOIN stores s ON s.id = sma.store_id
       WHERE sma.manager_id = $1
       ORDER BY s.name ASC`,
      [managerId]
    );
    return result.rows.map(r => ({ id: r.id, name: r.name }));
  } catch (error) {
    console.error('[StoreAssignmentService] getManagedStores error', {
      error: error.message,
      stack: error.stack
    });
    return [];
  }
}

/**
 * Determine whether a manager is assigned to the store that owns the booking's
 * shift. This is the scope helper backing manager-action authorization
 * (Requirement 12.2). Returns false for unknown bookings or shifts with no
 * owning store.
 *
 * @param {string} managerId - The users.id of the manager.
 * @param {string} bookingId - The shift_bookings.id to check.
 * @returns {Promise<boolean>}
 */
async function managerOwnsBooking(managerId, bookingId) {
  try {
    const result = await pool.query(
      `SELECT 1
       FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN store_manager_assignments sma ON sma.store_id = s.store_id
       WHERE sb.id = $1 AND sma.manager_id = $2
       LIMIT 1`,
      [bookingId, managerId]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('[StoreAssignmentService] managerOwnsBooking error', {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

module.exports = {
  validateAssignment,
  createStore,
  assignManagerToStore,
  getManagedStores,
  managerOwnsBooking
};
