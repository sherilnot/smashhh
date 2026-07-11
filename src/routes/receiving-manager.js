const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getSubmittedTimesheets, getTimesheetDetail } = require('../services/timesheetService');
const { pool } = require('../config/database');
const { getSubmittedInvoices, getInvoiceDetail } = require('../services/receivedInvoiceService');

const router = express.Router();
router.use(requireAuth, roleGuard('receiving_manager'));

// Dashboard — redirect to timesheets list
router.get('/dashboard', (req, res) => {
  res.redirect('/receiving-manager/timesheets');
});

// List submitted timesheets (paginated)
router.get('/timesheets', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const { timesheets, total } = await getSubmittedTimesheets(page, limit);
    const totalPages = Math.ceil(total / limit);

    res.render('receiving-manager/timesheets', {
      user: req.user,
      timesheets,
      page,
      totalPages,
      total,
      error: null
    });
  } catch (e) {
    console.error('[ReceivingManager] timesheets list error', e);
    res.render('receiving-manager/timesheets', {
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
      return res.status(404).render('receiving-manager/timesheet-detail', {
        user: req.user,
        timesheet: null,
        error: result.error
      });
    }

    res.render('receiving-manager/timesheet-detail', {
      user: req.user,
      timesheet: result.timesheet,
      error: null
    });
  } catch (e) {
    console.error('[ReceivingManager] timesheet detail error', e);
    res.status(500).render('receiving-manager/timesheet-detail', {
      user: req.user,
      timesheet: null,
      error: 'Failed to load timesheet details'
    });
  }
});

// List all employees with wages
router.get('/wages', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.user_id, u.first_name, u.last_name, u.hourly_wage, u.employment_type, u.is_active
       FROM users u
       WHERE u.role = 'employee'
       ORDER BY u.last_name, u.first_name`
    );

    const employees = result.rows;

    res.render('receiving-manager/wages', {
      user: req.user,
      employees,
      error: null
    });
  } catch (e) {
    console.error('[ReceivingManager] wages error', e);
    res.render('receiving-manager/wages', {
      user: req.user,
      employees: [],
      error: 'Failed to load employee wages'
    });
  }
});

// Update employee hourly rate
router.post('/update-wage', async (req, res) => {
  try {
    const { employeeId, newRate } = req.body;
    const rate = parseFloat(newRate);

    if (isNaN(rate) || rate < 0) {
      return res.status(400).json({ success: false, error: 'Invalid wage rate' });
    }

    await pool.query(
      `UPDATE users SET hourly_wage = $1 WHERE id = $2 AND role = 'employee'`,
      [rate, employeeId]
    );

    res.json({ success: true });
  } catch (e) {
    console.error('[ReceivingManager] update wage error', e);
    res.status(500).json({ success: false, error: 'Failed to update wage' });
  }
});

// ─── Received Invoices (View invoices from shop managers) ─────────────────────

router.get('/received-invoices', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { invoices, total } = await getSubmittedInvoices(page, 50);
    const totalPages = Math.ceil(total / 50);

    res.render('receiving-manager/received-invoices', {
      user: req.user,
      invoices,
      page,
      totalPages,
      total
    });
  } catch (e) {
    console.error('[ReceivingManager] received-invoices error', e);
    res.render('receiving-manager/received-invoices', {
      user: req.user,
      invoices: [],
      page: 1,
      totalPages: 0,
      total: 0
    });
  }
});

router.get('/received-invoices/:id', async (req, res) => {
  try {
    const result = await getInvoiceDetail(req.params.id);
    if (!result.success) {
      return res.status(404).render('receiving-manager/received-invoice-detail', {
        user: req.user,
        invoice: null,
        error: result.error
      });
    }
    res.render('receiving-manager/received-invoice-detail', {
      user: req.user,
      invoice: result.invoice,
      error: null
    });
  } catch (e) {
    console.error('[ReceivingManager] received-invoice detail error', e);
    res.status(500).render('receiving-manager/received-invoice-detail', {
      user: req.user,
      invoice: null,
      error: 'Failed to load invoice'
    });
  }
});

module.exports = router;
