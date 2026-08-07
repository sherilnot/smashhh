const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getSubmittedTimesheets, getTimesheetDetail } = require('../services/timesheetService');
const { pool } = require('../config/database');
const { getSubmittedInvoices, getInvoiceDetail } = require('../services/receivedInvoiceService');
const { getAllCashSubmissions, getCashSubmissionDetail } = require('../services/cashSubmissionService');

const router = express.Router();
router.use(requireAuth, roleGuard('receiving_manager'));

// Dashboard — redirect to latest timesheet
router.get('/dashboard', async (req, res) => {
  try {
    // Find the most recent submitted timesheet and go directly to it
    const latest = await pool.query(
      `SELECT id FROM timesheets ORDER BY submitted_at DESC LIMIT 1`
    );
    if (latest.rows.length > 0) {
      return res.redirect(`/receiving-manager/timesheets/${latest.rows[0].id}`);
    }
    res.redirect('/receiving-manager/timesheets');
  } catch (e) {
    res.redirect('/receiving-manager/timesheets');
  }
});

// List submitted timesheets — grouped by store
router.get('/timesheets', async (req, res) => {
  try {
    const { timesheets, total } = await getSubmittedTimesheets(1, 200);

    // Group by store
    const byStore = {};
    timesheets.forEach(ts => {
      if (!byStore[ts.store_name]) byStore[ts.store_name] = [];
      byStore[ts.store_name].push(ts);
    });

    res.render('receiving-manager/timesheets', {
      user: req.user,
      byStore,
      total,
      error: null
    });
  } catch (e) {
    console.error('[ReceivingManager] timesheets list error', e);
    res.render('receiving-manager/timesheets', {
      user: req.user,
      byStore: {},
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

    // Fetch any wage multiplier overrides for this timesheet
    const overridesRes = await pool.query(
      `SELECT employee_id, hourly_wage FROM timesheet_wage_overrides WHERE timesheet_id = $1`,
      [req.params.id]
    );
    const overrides = {};
    overridesRes.rows.forEach(r => { overrides[r.employee_id] = parseFloat(r.hourly_wage); });

    // Apply overrides to timesheet rows
    if (result.timesheet.timesheetRows) {
      result.timesheet.timesheetRows.forEach(row => {
        // Find employee_id from name match in entries
        const empEntry = overridesRes.rows.find(o => {
          // Match by checking if any override applies
          return true; // We'll match by index below
        });
      });

      // Re-query employee IDs for the timesheet entries to match overrides
      const entriesRes = await pool.query(
        `SELECT DISTINCT te.employee_id, u.first_name, u.last_name
         FROM timesheet_entries te
         JOIN users u ON u.id = te.employee_id
         WHERE te.timesheet_id = $1`,
        [req.params.id]
      );

      const empNameToId = {};
      entriesRes.rows.forEach(r => {
        const name = r.last_name ? (r.first_name + ' ' + r.last_name) : r.first_name;
        empNameToId[name] = r.employee_id;
      });

      // Apply overrides and recalculate earned amounts (override applies to weekend only)
      let totalWagesOverridden = 0;
      result.timesheet.timesheetRows.forEach(row => {
        const empId = empNameToId[row.name];
        if (empId && overrides[empId]) {
          row.overrideRate = overrides[empId];
          row.hasOverride = true;
          // Weekend hours at override rate, weekday hours at normal rate
          const normalRate = parseFloat(row.hourly_wage || 0);
          const weekendRate = overrides[empId];
          row.totalEarned = Math.round((row.weekdayHours * normalRate + row.weekendHours * weekendRate) * 100) / 100;
        } else {
          row.hasOverride = false;
        }
        totalWagesOverridden += row.totalEarned;
      });
      result.timesheet.total_wages = Math.round(totalWagesOverridden * 100) / 100;
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

// Weekly wages report
router.get('/wages-weekly', async (req, res) => {
  try {
    // Default to this week
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    // Allow date nav
    if (req.query.date) {
      const [y, m, d2] = req.query.date.split('-').map(Number);
      const parsed = new Date(y, m - 1, d2);
      const pDay = parsed.getDay();
      const dff = pDay === 0 ? -6 : 1 - pDay;
      monday.setTime(parsed.getTime());
      monday.setDate(parsed.getDate() + dff);
      monday.setHours(0, 0, 0, 0);
      sunday.setTime(monday.getTime());
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);
    }

    const toLocal = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const weekStart = toLocal(monday);
    const weekEnd = toLocal(sunday);
    const prevMon = new Date(monday); prevMon.setDate(prevMon.getDate() - 7);
    const nextMon = new Date(monday); nextMon.setDate(nextMon.getDate() + 7);

    const result = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.hourly_wage, s2.name AS store_name,
              SUM(te.hours_worked) AS total_hours
       FROM timesheet_entries te
       JOIN users u ON u.id = te.employee_id
       JOIN store_employee_assignments sea ON sea.employee_id = u.id
       JOIN stores s2 ON s2.id = sea.store_id
       JOIN timesheets t ON t.id = te.timesheet_id
       WHERE t.week_start = $1
       GROUP BY u.id, u.first_name, u.last_name, u.hourly_wage, s2.name
       ORDER BY s2.name, u.first_name`,
      [weekStart]
    );

    // Group by store
    const byStore = {};
    let grandTotalHours = 0, grandTotalPay = 0;
    result.rows.forEach(r => {
      if (!byStore[r.store_name]) byStore[r.store_name] = [];
      const hours = parseFloat(r.total_hours) || 0;
      const rate = parseFloat(r.hourly_wage) || 0;
      const pay = Math.round(hours * rate * 100) / 100;
      grandTotalHours += hours;
      grandTotalPay += pay;
      byStore[r.store_name].push({ ...r, total_hours: hours, pay });
    });

    res.render('receiving-manager/wages-weekly', {
      user: req.user,
      byStore,
      weekStart,
      weekEnd,
      prevWeekDate: toLocal(prevMon),
      nextWeekDate: toLocal(nextMon),
      grandTotalHours: Math.round(grandTotalHours * 100) / 100,
      grandTotalPay: Math.round(grandTotalPay * 100) / 100
    });
  } catch (e) {
    console.error('[ReceivingManager] wages-weekly error', e);
    res.render('receiving-manager/wages-weekly', { user: req.user, byStore: {}, weekStart: '', weekEnd: '', prevWeekDate: '', nextWeekDate: '', grandTotalHours: 0, grandTotalPay: 0 });
  }
});

// Monthly wages report
router.get('/wages-monthly', async (req, res) => {
  try {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth(); // 0-indexed

    if (req.query.month) {
      const [y, m] = req.query.month.split('-').map(Number);
      year = y;
      month = m - 1;
    }

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthLabel = monthNames[month] + ' ' + year;

    const prevMonth = month === 0 ? `${year-1}-12` : `${year}-${String(month).padStart(2,'0')}`;
    const nextMonth = month === 11 ? `${year+1}-01` : `${year}-${String(month+2).padStart(2,'0')}`;

    const toLocal = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const result = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.hourly_wage, s2.name AS store_name,
              SUM(te.hours_worked) AS total_hours
       FROM timesheet_entries te
       JOIN users u ON u.id = te.employee_id
       JOIN store_employee_assignments sea ON sea.employee_id = u.id
       JOIN stores s2 ON s2.id = sea.store_id
       JOIN timesheets t ON t.id = te.timesheet_id
       WHERE te.shift_date >= $1 AND te.shift_date <= $2
       GROUP BY u.id, u.first_name, u.last_name, u.hourly_wage, s2.name
       ORDER BY s2.name, u.first_name`,
      [toLocal(monthStart), toLocal(monthEnd)]
    );

    const byStore = {};
    let grandTotalHours = 0, grandTotalPay = 0;
    result.rows.forEach(r => {
      if (!byStore[r.store_name]) byStore[r.store_name] = [];
      const hours = parseFloat(r.total_hours) || 0;
      const rate = parseFloat(r.hourly_wage) || 0;
      const pay = Math.round(hours * rate * 100) / 100;
      grandTotalHours += hours;
      grandTotalPay += pay;
      byStore[r.store_name].push({ ...r, total_hours: hours, pay });
    });

    res.render('receiving-manager/wages-monthly', {
      user: req.user,
      byStore,
      monthLabel,
      prevMonth,
      nextMonth,
      grandTotalHours: Math.round(grandTotalHours * 100) / 100,
      grandTotalPay: Math.round(grandTotalPay * 100) / 100
    });
  } catch (e) {
    console.error('[ReceivingManager] wages-monthly error', e);
    res.render('receiving-manager/wages-monthly', { user: req.user, byStore: {}, monthLabel: '', prevMonth: '', nextMonth: '', grandTotalHours: 0, grandTotalPay: 0 });
  }
});

// List all employees with wages (rates)
router.get('/wages', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.hourly_wage, u.employment_type, u.is_active,
              s.name AS store_name
       FROM users u
       JOIN store_employee_assignments sea ON sea.employee_id = u.id
       JOIN stores s ON s.id = sea.store_id
       WHERE u.role = 'employee'
       ORDER BY s.name, u.first_name, u.last_name`
    );

    // Group by store
    const byStore = {};
    result.rows.forEach(r => {
      if (!byStore[r.store_name]) byStore[r.store_name] = [];
      byStore[r.store_name].push(r);
    });

    res.render('receiving-manager/wages', {
      user: req.user,
      byStore,
      error: null
    });
  } catch (e) {
    console.error('[ReceivingManager] wages error', e);
    res.render('receiving-manager/wages', {
      user: req.user,
      byStore: {},
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

// Apply wage multiplier to selected employees for weekend shifts only
router.post('/apply-multiplier', async (req, res) => {
  try {
    const { employeeIds, multiplier, timesheetId } = req.body;
    const mult = parseFloat(multiplier);

    if (isNaN(mult) || (mult !== 1.5 && mult !== 2.0)) {
      return res.status(400).json({ success: false, error: 'Multiplier must be 1.5 or 2.0' });
    }

    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, error: 'No employees selected' });
    }

    if (!timesheetId) {
      return res.status(400).json({ success: false, error: 'No timesheet specified' });
    }

    // Resolve names to IDs
    const entriesRes = await pool.query(
      `SELECT DISTINCT te.employee_id, u.first_name, u.last_name
       FROM timesheet_entries te JOIN users u ON u.id = te.employee_id
       WHERE te.timesheet_id = $1`,
      [timesheetId]
    );
    const nameToId = {};
    entriesRes.rows.forEach(r => {
      const name = r.last_name ? (r.first_name + ' ' + r.last_name) : r.first_name;
      nameToId[name] = r.employee_id;
    });

    let updated = 0;
    for (const nameOrId of employeeIds) {
      const empId = nameToId[nameOrId] || nameOrId;
      // Store the weekend multiplier — hourly_wage * multiplier for weekend calculation
      await pool.query(
        `INSERT INTO timesheet_wage_overrides (timesheet_id, employee_id, hourly_wage, set_by)
         SELECT $1, $2, u.hourly_wage * $3, $4
         FROM users u WHERE u.id = $2
         ON CONFLICT (timesheet_id, employee_id)
         DO UPDATE SET hourly_wage = (SELECT hourly_wage FROM users WHERE id = $2) * $3, set_by = $4, set_at = NOW()`,
        [timesheetId, empId, mult, req.user.userId]
      );
      updated++;
    }

    res.json({ success: true, updated });
  } catch (e) {
    console.error('[ReceivingManager] apply-multiplier error', e);
    res.status(500).json({ success: false, error: 'Failed to apply multiplier' });
  }
});

// Remove wage multiplier for an employee on a timesheet
router.post('/remove-multiplier', async (req, res) => {
  try {
    const { employeeId, timesheetId } = req.body;

    // employeeId might be a name — resolve
    const entriesRes = await pool.query(
      `SELECT DISTINCT te.employee_id, u.first_name, u.last_name
       FROM timesheet_entries te JOIN users u ON u.id = te.employee_id
       WHERE te.timesheet_id = $1`,
      [timesheetId]
    );
    let resolvedId = employeeId;
    entriesRes.rows.forEach(r => {
      const name = r.last_name ? (r.first_name + ' ' + r.last_name) : r.first_name;
      if (name === employeeId) resolvedId = r.employee_id;
    });

    await pool.query(
      `DELETE FROM timesheet_wage_overrides WHERE timesheet_id = $1 AND employee_id = $2`,
      [timesheetId, resolvedId]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('[ReceivingManager] remove-multiplier error', e);
    res.status(500).json({ success: false, error: 'Failed to remove multiplier' });
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

// ─── Timesheet Downloads (weekly + monthly Excel) ──────────────────────────────

const { buildTimesheetCsv, buildMonthlyTimesheetCsv } = require('../services/exportService');

/** Normalise a DB date (Date object or string) to YYYY-MM-DD. */
function toDateOnly(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.substring(0, 10);
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Download a single weekly timesheet as Excel/CSV
router.get('/timesheets/:id/download', async (req, res) => {
  try {
    const result = await getTimesheetDetail(req.params.id);
    if (!result.success) return res.status(404).send('Timesheet not found');

    const ts = result.timesheet;

    // Apply any weekend rate overrides so the export matches the on-screen values
    const ovRes = await pool.query(
      `SELECT employee_id, hourly_wage FROM timesheet_wage_overrides WHERE timesheet_id = $1`,
      [req.params.id]
    );
    if (ovRes.rows.length > 0) {
      const empRes = await pool.query(
        `SELECT DISTINCT u.id, u.first_name, u.last_name
         FROM timesheet_entries te JOIN users u ON u.id = te.employee_id
         WHERE te.timesheet_id = $1`,
        [req.params.id]
      );
      const nameToId = {};
      empRes.rows.forEach(r => {
        nameToId[r.last_name ? r.first_name + ' ' + r.last_name : r.first_name] = r.id;
      });
      const overrides = {};
      ovRes.rows.forEach(r => { overrides[r.employee_id] = parseFloat(r.hourly_wage); });

      ts.timesheetRows.forEach(row => {
        const eid = nameToId[row.name];
        if (eid && overrides[eid] !== undefined) {
          row.hasOverride = true;
          row.overrideRate = overrides[eid];
        }
      });
    }

    const csv = buildTimesheetCsv(ts);
    const wk = toDateOnly(ts.week_start);
    const filename = `timesheet_${String(ts.store_name).replace(/\s+/g, '_')}_${wk}.csv`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) {
    console.error('[ReceivingManager] timesheet download error', e);
    res.status(500).send('Failed to generate download');
  }
});

// Download all timesheets for a month as one Excel/CSV
router.get('/timesheets-monthly/download', async (req, res) => {
  try {
    // month param: YYYY-MM (defaults to current month)
    const monthParam = req.query.month;
    let year, month;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      [year, month] = monthParam.split('-').map(Number);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Optional store filter
    const store = req.query.store || null;
    const params = [monthStart, monthEnd];
    let storeFilter = '';
    if (store) { params.push(store); storeFilter = ' AND s.name = $3'; }

    const listRes = await pool.query(
      `SELECT t.id FROM timesheets t
       JOIN stores s ON s.id = t.store_id
       WHERE t.week_start >= $1 AND t.week_start <= $2${storeFilter}
       ORDER BY s.name, t.week_start`,
      params
    );

    const weeks = [];
    for (const row of listRes.rows) {
      const d = await getTimesheetDetail(row.id);
      if (d.success) weeks.push(d.timesheet);
    }

    const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
      + (store ? ` — ${store}` : '');
    const csv = buildMonthlyTimesheetCsv(monthLabel, weeks);
    const safeStore = store ? String(store).replace(/\s+/g, '_') + '_' : '';
    const filename = `timesheets_${safeStore}${year}-${String(month).padStart(2, '0')}.csv`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) {
    console.error('[ReceivingManager] monthly timesheet download error', e);
    res.status(500).send('Failed to generate download');
  }
});

// ─── Cash Reports (Payroll receives cash submissions from shop managers) ───────

router.get('/cash', async (req, res) => {
  try {
    const { submissions, total } = await getAllCashSubmissions(1, 200);

    // Group by store
    const byStore = {};
    submissions.forEach(sub => {
      if (!byStore[sub.store_name]) byStore[sub.store_name] = [];
      byStore[sub.store_name].push(sub);
    });

    // ─── Wages history per store: all weeks + all months ───────────────
    const toLocal = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // All weeks that have timesheets, grouped by store
    const weeklyWagesRes = await pool.query(
      `SELECT s.name AS store_name, t.week_start,
              SUM(te.hours_worked) AS hours,
              SUM(te.hours_worked * COALESCE(u.hourly_wage, 0)) AS pay
       FROM timesheet_entries te
       JOIN timesheets t ON t.id = te.timesheet_id
       JOIN users u ON u.id = te.employee_id
       JOIN stores s ON s.id = t.store_id
       GROUP BY s.name, t.week_start
       ORDER BY t.week_start DESC`
    );

    // All months that have data, grouped by store
    const monthlyWagesRes = await pool.query(
      `SELECT s.name AS store_name,
              date_trunc('month', te.shift_date) AS month_start,
              SUM(te.hours_worked) AS hours,
              SUM(te.hours_worked * COALESCE(u.hourly_wage, 0)) AS pay
       FROM timesheet_entries te
       JOIN timesheets t ON t.id = te.timesheet_id
       JOIN users u ON u.id = te.employee_id
       JOIN stores s ON s.id = t.store_id
       GROUP BY s.name, date_trunc('month', te.shift_date)
       ORDER BY month_start DESC`
    );

    // Group into { storeName: { weeks: [...], months: [...] } }
    const wagesByStore = {};
    weeklyWagesRes.rows.forEach(r => {
      if (!wagesByStore[r.store_name]) wagesByStore[r.store_name] = { weeks: [], months: [] };
      const ws = typeof r.week_start === 'string' ? r.week_start.substring(0, 10) : toLocal(new Date(r.week_start));
      wagesByStore[r.store_name].weeks.push({
        weekStart: ws,
        hours: Math.round((parseFloat(r.hours) || 0) * 10) / 10,
        pay: Math.round((parseFloat(r.pay) || 0) * 100) / 100
      });
    });
    monthlyWagesRes.rows.forEach(r => {
      if (!wagesByStore[r.store_name]) wagesByStore[r.store_name] = { weeks: [], months: [] };
      const ms = new Date(r.month_start);
      wagesByStore[r.store_name].months.push({
        label: ms.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' }),
        hours: Math.round((parseFloat(r.hours) || 0) * 10) / 10,
        pay: Math.round((parseFloat(r.pay) || 0) * 100) / 100
      });
    });

    res.render('receiving-manager/cash', {
      user: req.user,
      byStore,
      total,
      wagesByStore
    });
  } catch (e) {
    console.error('[ReceivingManager] cash list error', e);
    res.render('receiving-manager/cash', {
      user: req.user,
      byStore: {},
      total: 0,
      wagesByStore: {}
    });
  }
});

router.get('/cash/:id', async (req, res) => {
  try {
    const result = await getCashSubmissionDetail(req.params.id);
    if (!result.success) {
      return res.status(404).render('receiving-manager/cash-detail', { user: req.user, submission: null, error: 'Not found' });
    }
    res.render('receiving-manager/cash-detail', { user: req.user, submission: result.submission, error: null });
  } catch (e) {
    console.error('[ReceivingManager] cash detail error', e);
    res.status(500).render('receiving-manager/cash-detail', { user: req.user, submission: null, error: 'Failed to load' });
  }
});

module.exports = router;
