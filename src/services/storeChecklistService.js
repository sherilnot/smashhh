const { pool } = require('../config/database');

/**
 * Store Checklist Service
 * Manages daily supply checklists that store managers fill out and send to the warehouse manager.
 */

/**
 * Get or create checklist for a manager's store.
 * Checklist is prepared for TOMORROW. Editable until 10am the next day (the actual date).
 * @param {string} managerId
 * @returns {Promise<{ success: boolean, checklist?: object, checklistPending?: boolean, error?: string }>}
 */
async function getOrCreateTodayChecklist(managerId) {
  const client = await pool.connect();
  try {
    // Find manager's store
    const storeRes = await client.query(
      `SELECT s.id AS store_id, s.name AS store_name
       FROM store_manager_assignments sma
       JOIN stores s ON s.id = sma.store_id
       WHERE sma.manager_id = $1 LIMIT 1`,
      [managerId]
    );

    if (storeRes.rows.length === 0) {
      return { success: false, error: 'No store assignment exists' };
    }

    const { store_id, store_name } = storeRes.rows[0];
    
    // Target date = tomorrow. But if it's before 10am, we can still edit today's list.
    const now = new Date();
    const hour = now.getHours();
    
    let targetDate;
    if (hour < 10) {
      // Before 10am: show today's checklist (prepared yesterday, still editable)
      targetDate = new Date(now);
    } else {
      // After 10am: prepare tomorrow's checklist
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 1);
    }
    
    const dateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

    // Check if checklist already exists for this date
    let checklistRes = await client.query(
      `SELECT * FROM store_checklists WHERE store_id = $1 AND check_date = $2`,
      [store_id, dateStr]
    );

    let checklistId;
    let status;

    if (checklistRes.rows.length === 0) {
      // Create new checklist from template
      await client.query('BEGIN');

      const insertRes = await client.query(
        `INSERT INTO store_checklists (store_id, submitted_by, check_date, status)
         VALUES ($1, $2, $3, 'draft') RETURNING id, status`,
        [store_id, managerId, dateStr]
      );
      checklistId = insertRes.rows[0].id;
      status = 'draft';

      // Populate items from template
      const templateRes = await client.query(
        `SELECT product_name, default_quantity, sort_order
         FROM store_checklist_templates
         WHERE store_id = $1 AND is_active = true
         ORDER BY sort_order`,
        [store_id]
      );

      for (const item of templateRes.rows) {
        await client.query(
          `INSERT INTO store_checklist_items (checklist_id, product_name, quantity_needed, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [checklistId, item.product_name, item.default_quantity, item.sort_order]
        );
      }

      await client.query('COMMIT');
    } else {
      checklistId = checklistRes.rows[0].id;
      status = checklistRes.rows[0].status;
    }

    // Fetch items
    const itemsRes = await client.query(
      `SELECT id, product_name, quantity_needed, quantity_to_bring, sort_order
       FROM store_checklist_items
       WHERE checklist_id = $1
       ORDER BY sort_order`,
      [checklistId]
    );

    return {
      success: true,
      checklist: {
        id: checklistId,
        storeId: store_id,
        storeName: store_name,
        checkDate: dateStr,
        status,
        items: itemsRes.rows
      }
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[StoreChecklistService] getOrCreateTodayChecklist error', error);
    return { success: false, error: 'Failed to load checklist' };
  } finally {
    client.release();
  }
}

/**
 * Save quantities to a draft checklist without submitting.
 * Creates the checklist if needed, updates quantities, keeps status as 'draft'.
 * The invoice will sync from draft checklists too.
 */
async function saveChecklist(managerId, checklistId, quantities, neededQtys = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const checkRes = await client.query(
      `SELECT sc.id, sc.status
       FROM store_checklists sc
       JOIN store_manager_assignments sma ON sma.store_id = sc.store_id
       WHERE sc.id = $1 AND sma.manager_id = $2`,
      [checklistId, managerId]
    );

    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Checklist not found or access denied' };
    }

    for (const [itemId, qty] of Object.entries(quantities)) {
      await client.query(
        `UPDATE store_checklist_items SET quantity_to_bring = $1 WHERE id = $2 AND checklist_id = $3`,
        [qty || '', itemId, checklistId]
      );
    }

    // Also update quantity_needed if provided
    for (const [itemId, val] of Object.entries(neededQtys)) {
      if (val !== undefined) {
        await client.query(
          `UPDATE store_checklist_items SET quantity_needed = $1 WHERE id = $2 AND checklist_id = $3`,
          [val || '', itemId, checklistId]
        );
      }
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[StoreChecklistService] saveChecklist error', error);
    return { success: false, error: 'Failed to save checklist' };
  } finally {
    client.release();
  }
}

/**
 * Update quantities and submit checklist to warehouse manager.
 * @param {string} managerId
 * @param {string} checklistId
 * @param {Object} quantities - Map of item_id -> quantity_to_bring
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function submitChecklist(managerId, checklistId, quantities) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify checklist belongs to manager's store and is in draft status
    const checkRes = await client.query(
      `SELECT sc.id, sc.status, sc.store_id
       FROM store_checklists sc
       JOIN store_manager_assignments sma ON sma.store_id = sc.store_id
       WHERE sc.id = $1 AND sma.manager_id = $2`,
      [checklistId, managerId]
    );

    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Checklist not found or access denied' };
    }

    if (checkRes.rows[0].status === 'submitted') {
      // Allow re-submission (edit) — revert to draft first
      await client.query(
        `UPDATE store_checklists SET status = 'draft', submitted_at = NULL WHERE id = $1`,
        [checklistId]
      );
    }

    // Update each item's quantity_to_bring
    for (const [itemId, qty] of Object.entries(quantities)) {
      if (qty !== undefined && qty !== '') {
        await client.query(
          `UPDATE store_checklist_items SET quantity_to_bring = $1 WHERE id = $2 AND checklist_id = $3`,
          [qty, itemId, checklistId]
        );
      }
    }

    // Mark checklist as submitted
    await client.query(
      `UPDATE store_checklists SET status = 'submitted', submitted_at = NOW() WHERE id = $1`,
      [checklistId]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[StoreChecklistService] submitChecklist error', error);
    return { success: false, error: 'Failed to submit checklist' };
  } finally {
    client.release();
  }
}

/**
 * Get all submitted checklists grouped by store (for warehouse manager).
 * @param {number} page
 * @param {number} limit
 * @returns {Promise<{ checklists: Array, total: number, byStore: Object }>}
 */
async function getSubmittedChecklists(page = 1, limit = 50) {
  limit = Math.min(limit, 50);
  const offset = (page - 1) * limit;

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM store_checklists WHERE status IN ('submitted', 'reviewed')`
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const res = await pool.query(
    `SELECT sc.id, sc.check_date, sc.status, sc.submitted_at,
            s.name AS store_name,
            u.first_name, u.last_name
     FROM store_checklists sc
     JOIN stores s ON s.id = sc.store_id
     JOIN users u ON u.id = sc.submitted_by
     WHERE sc.status IN ('submitted', 'reviewed')
     ORDER BY s.name ASC, sc.check_date DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  // Group by store
  const byStore = {};
  res.rows.forEach(cl => {
    if (!byStore[cl.store_name]) byStore[cl.store_name] = [];
    byStore[cl.store_name].push(cl);
  });

  return { checklists: res.rows, total, byStore };
}

/**
 * Get a specific checklist detail (for warehouse manager).
 * @param {string} checklistId
 * @returns {Promise<{ success: boolean, checklist?: object, error?: string }>}
 */
async function getChecklistDetail(checklistId) {
  const res = await pool.query(
    `SELECT sc.*, s.name AS store_name, u.first_name, u.last_name
     FROM store_checklists sc
     JOIN stores s ON s.id = sc.store_id
     JOIN users u ON u.id = sc.submitted_by
     WHERE sc.id = $1`,
    [checklistId]
  );

  if (res.rows.length === 0) {
    return { success: false, error: 'Checklist not found' };
  }

  const itemsRes = await pool.query(
    `SELECT * FROM store_checklist_items WHERE checklist_id = $1 ORDER BY sort_order`,
    [checklistId]
  );

  return {
    success: true,
    checklist: {
      ...res.rows[0],
      items: itemsRes.rows
    }
  };
}

/**
 * Mark a checklist as reviewed by warehouse manager.
 * @param {string} checklistId
 * @param {string} warehouseManagerId
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function markReviewed(checklistId, warehouseManagerId) {
  const res = await pool.query(
    `UPDATE store_checklists SET status = 'reviewed', reviewed_at = NOW(), reviewed_by = $1
     WHERE id = $2 AND status = 'submitted' RETURNING id`,
    [warehouseManagerId, checklistId]
  );

  if (res.rows.length === 0) {
    return { success: false, error: 'Checklist not found or already reviewed' };
  }
  return { success: true };
}

module.exports = {
  getOrCreateTodayChecklist,
  saveChecklist,
  submitChecklist,
  getSubmittedChecklists,
  getChecklistDetail,
  markReviewed
};
