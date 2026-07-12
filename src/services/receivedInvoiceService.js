const { pool } = require('../config/database');

/**
 * Received Invoice Service
 * Manages daily invoices where shop managers report actual quantities received from warehouse.
 */

/**
 * Get or create today's invoice for a manager's store.
 * Optionally populates items from today's submitted checklist.
 * @param {string} managerId
 * @returns {Promise<{ success: boolean, invoice?: object, error?: string }>}
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

    // Check if invoice already exists for today
    let invoiceRes = await client.query(
      `SELECT * FROM received_invoices WHERE store_id = $1 AND invoice_date = $2`,
      [store_id, today]
    );

    let invoiceId;
    let status;
    let checklistId = null;

    if (invoiceRes.rows.length === 0) {
      // Create new invoice
      await client.query('BEGIN');

      // Check if there's a submitted checklist for today to reference
      const checklistRes = await client.query(
        `SELECT id FROM store_checklists 
         WHERE store_id = $1 AND check_date = $2 AND status IN ('submitted', 'reviewed')
         LIMIT 1`,
        [store_id, today]
      );

      if (checklistRes.rows.length > 0) {
        checklistId = checklistRes.rows[0].id;
      }

      const insertRes = await client.query(
        `INSERT INTO received_invoices (store_id, checklist_id, submitted_by, invoice_date, status)
         VALUES ($1, $2, $3, $4, 'draft') RETURNING id, status`,
        [store_id, checklistId, managerId, today]
      );
      invoiceId = insertRes.rows[0].id;
      status = 'draft';

      // If we have a checklist, populate invoice items from checklist items
      if (checklistId) {
        const checklistItemsRes = await client.query(
          `SELECT product_name, quantity_to_bring, sort_order
           FROM store_checklist_items
           WHERE checklist_id = $1
           ORDER BY sort_order`,
          [checklistId]
        );

        for (const item of checklistItemsRes.rows) {
          await client.query(
            `INSERT INTO received_invoice_items (invoice_id, product_name, quantity_ordered, quantity_received, sort_order)
             VALUES ($1, $2, $3, '', $4)`,
            [invoiceId, item.product_name, item.quantity_to_bring || '', item.sort_order]
          );
        }
      }

      await client.query('COMMIT');
    } else {
      invoiceId = invoiceRes.rows[0].id;
      status = invoiceRes.rows[0].status;
      checklistId = invoiceRes.rows[0].checklist_id;
    }

    // Fetch items
    const itemsRes = await client.query(
      `SELECT id, product_name, quantity_ordered, quantity_received, item_notes, sort_order
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
      `INSERT INTO received_invoice_items (invoice_id, product_name, quantity_received, sort_order)
       VALUES ($1, $2, '', $3)`,
      [invoiceId, productName, nextOrder]
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
              s.name AS store_name, s.location,
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
      `SELECT id, product_name, quantity_ordered, quantity_received, item_notes
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
