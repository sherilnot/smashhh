const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getSubmittedInvoices, getInvoiceDetail } = require('../services/receivedInvoiceService');
const { getSubmittedTimesheets, getTimesheetDetail } = require('../services/timesheetService');
const { getAllCashSubmissions, getCashSubmissionDetail } = require('../services/cashSubmissionService');
const { generateInvoicePdf } = require('../services/invoicePdfService');
const { getAllMaintenanceReports, getMaintenanceReportDetail } = require('../services/maintenanceService');

const router = express.Router();
router.use(requireAuth, roleGuard('operation_manager'));

// Dashboard — redirect to invoices list
router.get('/dashboard', (req, res) => {
  res.redirect('/operation-manager/invoices');
});

// ─── Invoices ─────────────────────────────────────────────────────────────────

// List all submitted invoices from shop managers — grouped by store
router.get('/invoices', async (req, res) => {
  try {
    const { invoices, total } = await getSubmittedInvoices(1, 200);

    // Group by store_name
    const byStore = {};
    invoices.forEach(inv => {
      if (!byStore[inv.store_name]) byStore[inv.store_name] = [];
      byStore[inv.store_name].push(inv);
    });

    res.render('operation-manager/invoices', {
      user: req.user,
      byStore,
      total
    });
  } catch (e) {
    console.error('[OperationManager] invoices error', e);
    res.render('operation-manager/invoices', {
      user: req.user,
      byStore: {},
      total: 0
    });
  }
});

// View a specific invoice detail
router.get('/invoices/:id', async (req, res) => {
  try {
    const result = await getInvoiceDetail(req.params.id);
    if (!result.success) {
      return res.status(404).render('operation-manager/invoice-detail', {
        user: req.user,
        invoice: null,
        error: result.error
      });
    }
    res.render('operation-manager/invoice-detail', {
      user: req.user,
      invoice: result.invoice,
      error: null
    });
  } catch (e) {
    console.error('[OperationManager] invoice detail error', e);
    res.status(500).render('operation-manager/invoice-detail', {
      user: req.user,
      invoice: null,
      error: 'Failed to load invoice'
    });
  }
});

// Download invoice as PDF
router.get('/invoices/:id/download', async (req, res) => {
  try {
    const result = await getInvoiceDetail(req.params.id);
    if (!result.success) {
      return res.status(404).send('Invoice not found');
    }

    const invoice = result.invoice;
    const filename = `invoice_${(invoice.store_name || 'store').replace(/\s+/g, '_')}_${invoice.invoice_date}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const pdfStream = generateInvoicePdf(invoice);
    pdfStream.pipe(res);
  } catch (e) {
    console.error('[OperationManager] invoice PDF download error', e);
    res.status(500).send('Failed to generate PDF');
  }
});

// Download invoice as CSV (legacy)
router.get('/invoices/:id/download-csv', async (req, res) => {
  try {
    const result = await getInvoiceDetail(req.params.id);
    if (!result.success) {
      return res.status(404).send('Invoice not found');
    }

    const invoice = result.invoice;
    const rows = [['#', 'Product', 'Ordered Qty', 'Received Qty', 'Unit Price', 'Total', 'Notes']];

    let grandTotal = 0;
    let idx = 0;
    (invoice.items || []).forEach(item => {
      const price = parseFloat(item.unit_price) || 0;
      const qty = parseFloat(item.quantity_received) || 0;
      if (item.item_notes === 'NOT SELECTED' || qty === 0) return;
      const lineTotal = price * qty;
      grandTotal += lineTotal;
      idx++;
      rows.push([
        idx,
        `"${(item.product_name || '').replace(/"/g, '""')}"`,
        item.quantity_ordered || '',
        item.quantity_received || '',
        price.toFixed(2),
        lineTotal.toFixed(2),
        `"${(item.item_notes || '').replace(/"/g, '""')}"`
      ]);
    });

    rows.push([]);
    rows.push(['', '', '', '', 'Grand Total:', grandTotal.toFixed(2), '']);

    const csv = rows.map(r => r.join(',')).join('\n');
    const filename = `invoice_${invoice.store_name.replace(/\s+/g, '_')}_${invoice.invoice_date}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) {
    console.error('[OperationManager] invoice CSV download error', e);
    res.status(500).send('Failed to generate download');
  }
});

// ─── Timesheets ───────────────────────────────────────────────────────────────

// List submitted timesheets
router.get('/timesheets', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { timesheets, total } = await getSubmittedTimesheets(page, 50);
    const totalPages = Math.ceil(total / 50);

    res.render('operation-manager/timesheets', {
      user: req.user,
      timesheets,
      page,
      totalPages,
      total,
      error: null
    });
  } catch (e) {
    console.error('[OperationManager] timesheets error', e);
    res.render('operation-manager/timesheets', {
      user: req.user,
      timesheets: [],
      page: 1,
      totalPages: 0,
      total: 0,
      error: 'Failed to load timesheets'
    });
  }
});

// View timesheet detail
router.get('/timesheets/:id', async (req, res) => {
  try {
    const result = await getTimesheetDetail(req.params.id);
    if (!result.success) {
      return res.status(404).render('operation-manager/timesheet-detail', {
        user: req.user,
        timesheet: null,
        error: result.error
      });
    }
    res.render('operation-manager/timesheet-detail', {
      user: req.user,
      timesheet: result.timesheet,
      error: null
    });
  } catch (e) {
    console.error('[OperationManager] timesheet detail error', e);
    res.status(500).render('operation-manager/timesheet-detail', {
      user: req.user,
      timesheet: null,
      error: 'Failed to load timesheet'
    });
  }
});

// Download timesheet as CSV — removed per requirements

// ─── Cash Reports ─────────────────────────────────────────────────────────────

// List all cash submissions — grouped by store
router.get('/cash', async (req, res) => {
  try {
    const { submissions, total } = await getAllCashSubmissions(1, 200);
    const byStore = {};
    submissions.forEach(sub => {
      if (!byStore[sub.store_name]) byStore[sub.store_name] = [];
      byStore[sub.store_name].push(sub);
    });

    res.render('operation-manager/cash', {
      user: req.user,
      byStore,
      total
    });
  } catch (e) {
    console.error('[OperationManager] cash list error', e);
    res.render('operation-manager/cash', {
      user: req.user,
      byStore: {},
      total: 0
    });
  }
});

// View cash submission detail
router.get('/cash/:id', async (req, res) => {
  try {
    const result = await getCashSubmissionDetail(req.params.id);
    if (!result.success) {
      return res.status(404).render('operation-manager/cash-detail', {
        user: req.user,
        submission: null,
        error: result.error
      });
    }
    res.render('operation-manager/cash-detail', {
      user: req.user,
      submission: result.submission,
      error: null
    });
  } catch (e) {
    console.error('[OperationManager] cash detail error', e);
    res.status(500).render('operation-manager/cash-detail', {
      user: req.user,
      submission: null,
      error: 'Failed to load submission'
    });
  }
});

// ─── Maintenance Reports ──────────────────────────────────────────────────────

// List all maintenance reports from shop managers
router.get('/maintenance', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { submissions, total } = await getAllMaintenanceReports(page, 50);
    const totalPages = Math.ceil(total / 50);

    res.render('operation-manager/maintenance', {
      user: req.user,
      reports: submissions,
      page,
      totalPages,
      total
    });
  } catch (e) {
    console.error('[OperationManager] maintenance list error', e);
    res.render('operation-manager/maintenance', {
      user: req.user,
      reports: [],
      page: 1,
      totalPages: 0,
      total: 0
    });
  }
});

// View maintenance report detail
router.get('/maintenance/:id', async (req, res) => {
  try {
    const result = await getMaintenanceReportDetail(req.params.id);
    if (!result.success) {
      return res.status(404).render('operation-manager/maintenance-detail', {
        user: req.user,
        report: null,
        error: 'Report not found'
      });
    }
    res.render('operation-manager/maintenance-detail', {
      user: req.user,
      report: result.report,
      error: null
    });
  } catch (e) {
    console.error('[OperationManager] maintenance detail error', e);
    res.status(500).render('operation-manager/maintenance-detail', {
      user: req.user,
      report: null,
      error: 'Failed to load report'
    });
  }
});

module.exports = router;
