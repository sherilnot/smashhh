const { pool } = require('../config/database');

/**
 * Generate checklists for all active warehouse managers for tomorrow.
 * Requirements: 9.1–9.9
 */
async function generateNightlyChecklists() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const managers = await client.query(
      `SELECT id, first_name, last_name, email FROM users
       WHERE role = 'warehouse_manager' AND is_active = true`
    );
    if (!managers.rows.length) {
      await client.query('COMMIT');
      return;
    }

    const deliveries = await client.query(
      `SELECT product_id, warehouse_manager_id, expected_quantity
       FROM expected_deliveries WHERE expected_date = $1`,
      [tomorrow]
    );

    const byManager = new Map();
    for (const d of deliveries.rows) {
      if (!byManager.has(d.warehouse_manager_id)) byManager.set(d.warehouse_manager_id, []);
      byManager.get(d.warehouse_manager_id).push(d);
    }

    for (const mgr of managers.rows) {
      const items = byManager.get(mgr.id) || [];
      if (!items.length) continue;

      const clRes = await client.query(
        `INSERT INTO inventory_checklists (check_date, warehouse_manager_id, status)
         VALUES ($1, $2, 'pending') RETURNING id`,
        [tomorrow, mgr.id]
      );
      const checklistId = clRes.rows[0].id;

      for (const item of items) {
        await client.query(
          `INSERT INTO checklist_items (checklist_id, product_id, expected_quantity, status)
           VALUES ($1, $2, $3, 'pending')`,
          [checklistId, item.product_id, item.expected_quantity]
        );
      }
      console.log(`[Inventory] Checklist created for ${mgr.first_name} ${mgr.last_name}: ${items.length} items`);
    }

    await client.query('COMMIT');
    console.log('[Inventory] Nightly checklist generation complete');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Inventory] generateNightlyChecklists failed', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get checklist for a warehouse manager on a specific date, including items.
 * Requirements: 10.1–10.4, 19.4
 */
async function getChecklist(warehouseManagerId, date) {
  const clRes = await pool.query(
    `SELECT id, check_date, status, generated_at, completed_at
     FROM inventory_checklists
     WHERE warehouse_manager_id = $1 AND check_date = $2`,
    [warehouseManagerId, date]
  );
  if (!clRes.rows.length) return null;

  const checklist = clRes.rows[0];
  const itemsRes = await pool.query(
    `SELECT ci.id, ci.expected_quantity, ci.actual_quantity, ci.status, ci.notes, ci.checked_at,
            p.product_name AS product_name
     FROM checklist_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.checklist_id = $1
     ORDER BY p.product_name`,
    [checklist.id]
  );
  return { ...checklist, items: itemsRes.rows };
}

/**
 * Mark a checklist item as checked with actual quantity.
 * Requirements: 11.1–11.7, 12.1–12.4
 */
async function markItemChecked(checklistId, itemId, actualQuantity, status) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemRes = await client.query(
      'SELECT expected_quantity FROM checklist_items WHERE id = $1 AND checklist_id = $2',
      [itemId, checklistId]
    );
    if (!itemRes.rows.length) { await client.query('ROLLBACK'); return false; }

    const expected = itemRes.rows[0].expected_quantity;

    // Validate status matches quantity
    if (status === 'arrived' && actualQuantity !== expected) { await client.query('ROLLBACK'); return false; }
    if (status === 'partial' && (actualQuantity <= 0 || actualQuantity >= expected)) { await client.query('ROLLBACK'); return false; }
    if (status === 'missing' && actualQuantity !== 0) { await client.query('ROLLBACK'); return false; }

    await client.query(
      `UPDATE checklist_items SET actual_quantity = $1, status = $2, checked_at = NOW() WHERE id = $3`,
      [actualQuantity, status, itemId]
    );

    // Update checklist status
    const pendingRes = await client.query(
      `SELECT COUNT(*) AS pending FROM checklist_items WHERE checklist_id = $1 AND status = 'pending'`,
      [checklistId]
    );
    const pending = parseInt(pendingRes.rows[0].pending);

    if (pending === 0) {
      await client.query(
        `UPDATE inventory_checklists SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [checklistId]
      );
    } else {
      await client.query(
        `UPDATE inventory_checklists SET status = 'in_progress' WHERE id = $1`,
        [checklistId]
      );
    }

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Inventory] markItemChecked error', { error: error.message });
    return false;
  } finally {
    client.release();
  }
}

/**
 * Get checklist history for a warehouse manager in a date range.
 * Requirements: 10.1, 10.4
 */
async function getChecklistHistory(warehouseManagerId, startDate, endDate) {
  const result = await pool.query(
    `SELECT ic.id, ic.check_date, ic.status, ic.generated_at, ic.completed_at,
            COUNT(ci.id) AS total_items,
            COUNT(ci.id) FILTER (WHERE ci.status != 'pending') AS checked_items
     FROM inventory_checklists ic
     LEFT JOIN checklist_items ci ON ci.checklist_id = ic.id
     WHERE ic.warehouse_manager_id = $1
       AND ic.check_date >= $2 AND ic.check_date <= $3
     GROUP BY ic.id
     ORDER BY ic.check_date DESC`,
    [warehouseManagerId, startDate, endDate]
  );
  return result.rows;
}

module.exports = { generateNightlyChecklists, getChecklist, markItemChecked, getChecklistHistory };
