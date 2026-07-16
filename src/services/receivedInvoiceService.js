const { pool } = require('../config/database');

/**
 * Received Invoice Service
 * Manages daily invoices where shop managers report actual quantities received from warehouse.
 * Shop managers can edit quantities and the invoice is sent to the Operation Manager (OM001).
 */

/**
 * Generate a random unit price between min and max (inclusive).
 * Used to assign a realistic random price to each item on creation.
 */
function randomUnitPrice(min = 1.5, max = 25.0) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

/**
 * Populate invoice items from the current checklist items.
 * Only includes items that have a quantity_to_bring (items the manager selected).
 *
 * Non-destructive: this is called both when creating a fresh invoice AND on
 * every subsequent page load while the invoice is still a draft (so checklist
 * edits stay reflected). Items already on the invoice (matched by
 * product_name) are left completely untouched — previously fixed this
 * silently wiping a manager's entered quantity_received/item_notes on every
 * page reload by deleting and recreating every row. Only genuinely new
 * checklist items get inserted, and only invoice items whose product is no
 * longer on the checklist get removed.
 */
async function syncInvoiceItemsFromChecklist(client, invoiceId, checklistId) {
  const checklistItemsRes = await client.query(
    `SELECT product_name, quantity_to_bring, sort_order
     FROM store_checklist_items
     WHERE checklist_id = $1
       AND quantity_to_bring IS NOT NULL
       AND quantity_to_bring != ''
       AND quantity_to_bring != '0'
     ORDER BY sort_order`,
    [checklistId]
  );

  const existingRes = await client.query(
    `SELECT id, product_name FROM received_invoice_items WHERE invoice_id = $1`,
    [invoiceId]
  );
  const existingByName = new Map(existingRes.rows.map(r => [r.product_name, r.id]));
  const checklistNames = new Set(checklistItemsRes.rows.map(r => r.product_name));

  // Insert only items that aren't already on the invoice.
  for (const item of checklistItemsRes.rows) {
    if (existingByName.has(item.product_name)) continue;
    const unitPrice = randomUnitPrice();
    await client.query(
      `INSERT INTO received_invoice_items (invoice_id, product_name, quantity_ordered, quantity_received, unit_price, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [invoiceId, item.product_name, item.quantity_to_bring || '', item.quantity_to_bring || '', unitPrice, item.sort_order]
    );
  }

  // Remove invoice items whose product was removed from the checklist
  // (deselected or quantity cleared) — these are the only rows safe to drop
  // since they no longer correspond to anything the manager is meant to report on.
  for (const [name, id] of existingByName) {
    if (!checklistNames.has(name)) {
      await client.query(`DELETE FROM received_invoice_items WHERE id = $1`, [id]);
    }
  }
}

/**
 * Get or create today's invoice for a manager's store.
 * REQUIRES a submitted checklist for today — the invoice is based on the checklist.
 * If no checklist has been submitted yet, returns a flag so the UI can block access.
 * @param {string} managerId
 * @returns {Promise<{ success: boolean, invoice?: object, checklistPending?: boolean, error?: string }>}
 */
async function getOrCreateTodayInvoice(managerId) {
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
    const today = new Date().toISOString().split('T')[0];

    // Check if there's a submitted/reviewed checklist for today
    const checklistRes = await client.query(
      `SELECT id FROM store_checklists 
       WHERE store_id = $1 AND check_date = $2 AND status IN ('submitted', 'reviewed')
       LIMIT 1`,
      [store_id, today]
    );

    // If no checklist submitted today, block invoice access
    if (checklistRes.rows.length === 0) {
      return { success: false, checklistPending: true, error: 'You must submit today\'s checklist before creating an invoice.' };
    }

    const checklistId = checklistRes.rows[0].id;

    // Check if invoice already exists for today
    let invoiceRes = await client.query(
      `SELECT * FROM received_invoices WHERE store_id = $1 AND invoice_date = $2`,
      [store_id, today]
    );

    let invoiceId;
    let status;

    if (invoiceRes.rows.length === 0) {
      // Create new invoice from today's checklist
      await client.query('BEGIN');

      const insertRes = await client.query(
        `INSERT INTO received_invoices (store_id, checklist_id, submitted_by, invoice_date, status)
         VALUES ($1, $2, $3, $4, 'draft') RETURNING id, status`,
        [store_id, checklistId, managerId, today]
      );
      invoiceId = insertRes.rows[0].id;
      status = 'draft';

      // Populate invoice items from checklist items
      await syncInvoiceItemsFromChecklist(client, invoiceId, checklistId);

      await client.query('COMMIT');
    } else {
      invoiceId = invoiceRes.rows[0].id;
      status = invoiceRes.rows[0].status;

      // If still in draft, sync items with the checklist every time the page loads.
      // This ensures any checklist changes (re-submissions, edits) are reflected.
      if (status === 'draft') {
        const existingChecklistId = invoiceRes.rows[0].checklist_id;

        // Always re-sync: delete old items and regenerate from checklist
        await client.query('BEGIN');

        // Update the checklist reference if it changed
        if (existingChecklistId !== checklistId) {
          await client.query(
            `UPDATE received_invoices SET checklist_id = $1 WHERE id = $2`,
            [checklistId, invoiceId]
          );
        }

        // Sync with the current checklist state (adds newly-selected
        // items, removes items no longer on the checklist) without
        // touching any item that's still on it — see
        // syncInvoiceItemsFromChecklist for why the previous
        // delete-everything-then-recreate approach was removed.
        await syncInvoiceItemsFromChecklist(client, invoiceId, checklistId);

        await client.query('COMMIT');
      }
    }

    // Fetch items
    const itemsRes = await client.query(
      `SELECT id, product_name, quantity_ordered, quantity_received, unit_price, item_notes, sort_order
       FROM received_invoice_items
       WHERE invoice_id = $1
       ORDER BY sort_order`,
      [invoiceId]
    );

    return {
      success: true,
      invoice: {
        id: invoiceId,
        storeId: store_id,
        storeName: store_name,
        invoiceDate: today,
        status,
        checklistId,
        items: itemsRes.rows
      }
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ReceivedInvoiceService] getOrCreateTodayInvoice error', error);
    return { success: false, error: 'Failed to load invoice' };
  } finally {
    client.release();
  }
}

/**
 * Add a new item to an existing draft invoice.
 * @param {string} managerId
 * @param {string} invoiceId
 * @param {string} productName
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function addInvoiceItem(managerId, invoiceId, productName) {
  const client = await pool.connect();
  try {
    // Verify invoice belongs to manager's store and is in draft status
    const checkRes = await client.query(
      `SELECT ri.id, ri.status
       FROM received_invoices ri
       JOIN store_manager_assignments sma ON sma.store_id = ri.store_id
       WHERE ri.id = $1 AND sma.manager_id = $2`,
      [invoiceId, managerId]
    );

    if (checkRes.rows.length === 0) {
      return { success: false, error: 'Invoice not found or access denied' };
    }

    if (checkRes.rows[0].status !== 'draft') {
      return { success: false, error: 'Cannot modify submitted invoice' };
    }

    // Get next sort order
    const sortRes = await client.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
       FROM received_invoice_items WHERE invoice_id = $1`,
      [invoiceId]
    );
    const nextOrder = sortRes.rows[0].next_order;

    // Add item
    await client.query(
      `INSERT INTO received_invoice_items (invoice_id, product_name, quantity_received, unit_price, sort_order)
       VALUES ($1, $2, '', $3, $4)`,
      [invoiceId, productName, randomUnitPrice(), nextOrder]
    );

    return { success: true };
  } catch (error) {
    console.error('[ReceivedInvoiceService] addInvoiceItem error', error);
    return { success: false, error: 'Failed to add item' };
  } finally {
    client.release();
  }
}

/**
 * Update received quantities and notes, then submit invoice to RM001.
 * @param {string} managerId
 * @param {string} invoiceId
 * @param {Object} items - Array of { itemId, quantityReceived, itemNotes }
 * @param {string} generalNotes
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function submitInvoice(managerId, invoiceId, items, generalNotes = '') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify invoice belongs to manager's store
    const checkRes = await client.query(
      `SELECT ri.id, ri.status
       FROM received_invoices ri
       JOIN store_manager_assignments sma ON sma.store_id = ri.store_id
       WHERE ri.id = $1 AND sma.manager_id = $2`,
      [invoiceId, managerId]
    );

    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Invoice not found or access denied' };
    }

    if (checkRes.rows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      return { success: false, error: 'Invoice has already been submitted' };
    }

    // Update each item's received quantity and notes
    for (const item of items) {
      if (item.itemId) {
        await client.query(
          `UPDATE received_invoice_items 
           SET quantity_received = $1, item_notes = $2 
           WHERE id = $3 AND invoice_id = $4`,
          [item.quantityReceived || '', item.itemNotes || '', item.itemId, invoiceId]
        );
      }
    }

    // Mark invoice as submitted
    await client.query(
      `UPDATE received_invoices 
       SET status = 'submitted', submitted_at = NOW(), notes = $1 
       WHERE id = $2`,
      [generalNotes, invoiceId]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[ReceivedInvoiceService] submitInvoice error', error);
    return { success: false, error: 'Failed to submit invoice' };
  } finally {
    client.release();
  }
}

/**
 * Get all submitted invoices (for receiving manager RM001).
 * @param {number} page
 * @param {number} limit
 * @returns {Promise<{ invoices: Array, total: number }>}
 */
async function getSubmittedInvoices(page = 1, limit = 50) {
  limit = Math.min(limit, 50);
  const offset = (page - 1) * limit;

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM received_invoices WHERE status = 'submitted'`
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const res = await pool.query(
    `SELECT ri.id, ri.invoice_date, ri.submitted_at, ri.notes,
            s.name AS store_name,
            u.first_name, u.last_name
     FROM received_invoices ri
     JOIN stores s ON s.id = ri.store_id
     JOIN users u ON u.id = ri.submitted_by
     WHERE ri.status = 'submitted'
     ORDER BY ri.submitted_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return { invoices: res.rows, total };
}

/**
 * Get a specific invoice detail (for receiving manager).
 * @param {string} invoiceId
 * @returns {Promise<{ success: boolean, invoice?: object, error?: string }>}
 */
async function getInvoiceDetail(invoiceId) {
  try {
    const invoiceRes = await pool.query(
      `SELECT ri.id, ri.invoice_date, ri.status, ri.submitted_at, ri.notes,
              s.name AS store_name,
              u.first_name, u.last_name
       FROM received_invoices ri
       JOIN stores s ON s.id = ri.store_id
       JOIN users u ON u.id = ri.submitted_by
       WHERE ri.id = $1`,
      [invoiceId]
    );

    if (invoiceRes.rows.length === 0) {
      return { success: false, error: 'Invoice not found' };
    }

    const invoice = invoiceRes.rows[0];

    const itemsRes = await pool.query(
      `SELECT id, product_name, quantity_ordered, quantity_received, unit_price, item_notes
       FROM received_invoice_items
       WHERE invoice_id = $1
       ORDER BY sort_order`,
      [invoiceId]
    );

    invoice.items = itemsRes.rows;

    return { success: true, invoice };
  } catch (error) {
    console.error('[ReceivedInvoiceService] getInvoiceDetail error', error);
    return { success: false, error: 'Failed to load invoice' };
  }
}

module.exports = {
  getOrCreateTodayInvoice,
  addInvoiceItem,
  submitInvoice,
  getSubmittedInvoices,
  getInvoiceDetail
};
