const { pool } = require('../config/database');

/**
 * Store Checklist Service
 * 
 * TIMING RULES:
 * - Checklist for a date is editable from 12pm the day before until 10am on that date
 * - Before 12pm: show today's checklist (editable if before 10am, locked if after)
 * - 12pm onwards: show tomorrow's checklist (editable)
 * - Between 10am-12pm: show today's checklist (locked)
 */

function getMelbourneNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Melbourne' }));
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Determine which checklist date to show and whether it's editable.
 */
function getActiveChecklistInfo() {
  const now = getMelbourneNow();
  const hour = now.getHours();

  let targetDate;
  let editable;

  if (hour >= 12) {
    // After noon: show tomorrow's checklist (editable)
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 1);
    editable = true;
  } else if (hour < 10) {
    // Before 10am: show today's checklist (still editable)
    targetDate = new Date(now);
    editable = true;
  } else {
    // 10am - 12pm: show today's checklist (locked)
    targetDate = new Date(now);
    editable = false;
  }

  return { targetDate: formatDate(targetDate), editable, hour };
}

/**
 * Get or create the active checklist for a manager's store.
 */
async function getOrCreateTodayChecklist(managerId) {
  const client = await pool.connect();
  try {
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
    const { targetDate, editable, hour } = getActiveChecklistInfo();

    // Check if checklist already exists for target date
    let checklistRes = await client.query(
      `SELECT * FROM store_checklists WHERE store_id = $1 AND check_date = $2`,
      [store_id, targetDate]
    );

    let checklistId, status;

    if (checklistRes.rows.length === 0) {
      // Create new checklist from template
      await client.query('BEGIN');

      const insertRes = await client.query(
        `INSERT INTO store_checklists (store_id, submitted_by, check_date, status)
         VALUES ($1, $2, $3, 'draft') RETURNING id, status`,
        [store_id, managerId, targetDate]
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
          `INSERT INTO store_checklist_items (checklist_id, product_name, quantity_needed, quantity_to_bring, sort_order)
           VALUES ($1, $2, $3, '0', $4)`,
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

    // Determine label
    const now = getMelbourneNow();
    const todayStr = formatDate(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDate(tomorrow);

    let dateLabel;
    if (targetDate === todayStr) dateLabel = "Today's Order";
    else if (targetDate === tomorrowStr) dateLabel = "Tomorrow's Order";
    else dateLabel = targetDate;

    return {
      success: true,
      checklist: {
        id: checklistId,
        storeId: store_id,
        storeName: store_name,
        checkDate: targetDate,
        status,
        editable,
        dateLabel,
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
 * Save quantities (auto-save without submitting).
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
 * Submit checklist to warehouse manager.
 */
async function submitChecklist(managerId, checklistId, quantities) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    // Allow re-submission
    if (checkRes.rows[0].status === 'submitted') {
      await client.query(
        `UPDATE store_checklists SET status = 'draft', submitted_at = NULL WHERE id = $1`,
        [checklistId]
      );
    }

    // Update quantities
    for (const [itemId, qty] of Object.entries(quantities)) {
      if (qty !== undefined) {
        await client.query(
          `UPDATE store_checklist_items SET quantity_to_bring = $1 WHERE id = $2 AND checklist_id = $3`,
          [qty || '', itemId, checklistId]
        );
      }
    }

    // Mark submitted
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
 * Get all submitted checklists (for warehouse manager).
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

  const byStore = {};
  res.rows.forEach(cl => {
    if (!byStore[cl.store_name]) byStore[cl.store_name] = [];
    byStore[cl.store_name].push(cl);
  });

  return { checklists: res.rows, total, byStore };
}

/**
 * Get a specific checklist detail (for warehouse manager).
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
