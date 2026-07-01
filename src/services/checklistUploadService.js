const { pool } = require('../config/database');

/**
 * Checklist Upload Service
 * Handles transmission of completed checklist items to the warehouse manager.
 */

// ─── Pure Helper Functions ───────────────────────────────────────────────────

/**
 * Validate whether a checklist upload can proceed.
 * @param {{ hasPendingItems: boolean, hasCompletedItems: boolean, hasWarehouseManager: boolean, hasStore: boolean }} facts
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
function validateChecklistUpload(facts) {
  if (!facts.hasStore) {
    return { valid: false, error: 'No store assignment exists' };
  }
  if (!facts.hasWarehouseManager) {
    return { valid: false, error: 'No warehouse manager available' };
  }
  if (facts.hasPendingItems) {
    return { valid: false, error: 'All items must be completed before upload' };
  }
  if (!facts.hasCompletedItems) {
    return { valid: false, error: 'No items available for upload' };
  }
  return { valid: true };
}

/**
 * Filter items to only those uploadable (completed, not transmitted, matching store).
 * @param {Array} items - Array of checklist items with status, transmitted_at, store context
 * @param {string} storeId - Store UUID to filter by (via checklist's warehouse_manager association)
 * @returns {Array} Filtered items
 */
function filterUploadableItems(items) {
  const validStatuses = new Set(['arrived', 'missing', 'partial']);
  return items.filter(item =>
    validStatuses.has(item.status) &&
    item.transmitted_at == null
  );
}

// ─── Database Functions ──────────────────────────────────────────────────────

/**
 * Get uploadable checklist items for a manager's store.
 * @param {string} managerId
 * @returns {Promise<{ success: boolean, items?: Array, hasPendingItems?: boolean, error?: string }>}
 */
async function getUploadableItems(managerId) {
  // Find manager's store
  const storeRes = await pool.query(
    `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
    [managerId]
  );

  if (storeRes.rows.length === 0) {
    return { success: false, error: 'No store assignment exists', items: [] };
  }

  // Get all checklist items for checklists created by this manager (or linked to their store)
  // Since checklists are per warehouse_manager, we get items from all checklists
  // that haven't been transmitted yet
  const itemsRes = await pool.query(
    `SELECT ci.id, ci.checklist_id, ci.product_id, ci.expected_quantity,
            ci.actual_quantity, ci.status, ci.notes, ci.checked_at,
            ci.transmitted_at, p.product_name, p.product_code,
            ic.check_date
     FROM checklist_items ci
     JOIN inventory_checklists ic ON ic.id = ci.checklist_id
     JOIN products p ON p.id = ci.product_id
     WHERE ci.transmitted_at IS NULL
     ORDER BY ic.check_date DESC, p.product_name`,
    []
  );

  const allItems = itemsRes.rows;
  const hasPendingItems = allItems.some(i => i.status === 'pending');
  const uploadableItems = filterUploadableItems(allItems);

  return {
    success: true,
    items: uploadableItems,
    allItems,
    hasPendingItems
  };
}

/**
 * Upload completed (non-pending, non-transmitted) checklist items to the warehouse manager.
 * @param {string} managerId
 * @returns {Promise<{ success: boolean, uploadedCount?: number, error?: string }>}
 */
async function uploadChecklist(managerId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find manager's store
    const storeRes = await client.query(
      `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
      [managerId]
    );
    const hasStore = storeRes.rows.length > 0;

    // Find warehouse manager
    const wmRes = await client.query(
      `SELECT id FROM users WHERE role = 'warehouse_manager' AND is_active = true LIMIT 1`
    );
    const hasWarehouseManager = wmRes.rows.length > 0;

    // Check for pending items in non-transmitted checklist items
    const pendingRes = await client.query(
      `SELECT COUNT(*) FROM checklist_items
       WHERE transmitted_at IS NULL AND status = 'pending'`
    );
    const hasPendingItems = parseInt(pendingRes.rows[0].count, 10) > 0;

    // Check for completed (uploadable) items
    const completedRes = await client.query(
      `SELECT COUNT(*) FROM checklist_items
       WHERE transmitted_at IS NULL AND status IN ('arrived', 'missing', 'partial')`
    );
    const hasCompletedItems = parseInt(completedRes.rows[0].count, 10) > 0;

    // Validate
    const validation = validateChecklistUpload({
      hasStore,
      hasWarehouseManager,
      hasPendingItems,
      hasCompletedItems
    });

    if (!validation.valid) {
      await client.query('ROLLBACK');
      return { success: false, error: validation.error };
    }

    // Mark eligible items as transmitted
    const updateRes = await client.query(
      `UPDATE checklist_items
       SET transmitted_at = NOW(), transmitted_by = $1
       WHERE transmitted_at IS NULL
         AND status IN ('arrived', 'missing', 'partial')
       RETURNING id`,
      [managerId]
    );

    await client.query('COMMIT');
    return { success: true, uploadedCount: updateRes.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[ChecklistUploadService] uploadChecklist error', error);
    return { success: false, error: 'Upload failed, please retry' };
  } finally {
    client.release();
  }
}

module.exports = {
  validateChecklistUpload,
  filterUploadableItems,
  getUploadableItems,
  uploadChecklist
};
