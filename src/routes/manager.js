const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { calculateAllWages, updateHourlyRate, getManagerWageEntries, totalWage } = require('../services/wageService');
const { getPendingRequests, confirmBooking, rejectBooking } = require('../services/confirmationService');
const { endShift } = require('../services/shiftService');
const { pool } = require('../config/database');
const { getRosterWeek, validateRosterRequest, isWithinNavigationBounds, getRoster } = require('../services/rosterService');
const { generateTimesheet, submitTimesheet } = require('../services/timesheetService');
const { getOrCreateTodayChecklist, submitChecklist: submitStoreChecklist } = require('../services/storeChecklistService');

const router = express.Router();
router.use(requireAuth, roleGuard('store_manager'));

// Manager dashboard: active (confirmed, started) bookings + wage entries (Req 7.1, 9.1, 9.3).
router.get('/dashboard', async (req, res) => {
  try {
    const { entries, errors } = await getManagerWageEntries(req.user.userId);
    const total = totalWage(entries);

    // Fetch confirmed bookings on shifts that have already started (eligible to end).
    const activeRes = await pool.query(
      `SELECT sb.id AS booking_id, u.first_name, u.last_name,
              s.start_time, s.end_time, s.store_location
       FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN store_manager_assignments sma ON sma.store_id = s.store_id
       JOIN users u ON u.id = sb.employee_id
       WHERE sma.manager_id = $1
         AND sb.booking_status = 'confirmed'
         AND s.start_time <= NOW()
       ORDER BY s.start_time ASC`,
      [req.user.userId]
    );

    res.render('manager/dashboard', {
      user: req.user,
      wageEntries: entries,
      wageTotal: total,
      wageErrors: errors,
      activeBookings: activeRes.rows
    });
  } catch (e) {
    console.error('[Manager] dashboard error', e);
    res.render('manager/dashboard', {
      user: req.user,
      wageEntries: [],
      wageTotal: 0,
      wageErrors: [],
      activeBookings: []
    });
  }
});

// Pending confirmation queue for the manager's stores (Req 4.1, 4.2, 4.3).
router.get('/pending', async (req, res) => {
  const { hasManagedStore, requests } = await getPendingRequests(req.user.userId);
  res.render('manager/pending', {
    user: req.user,
    hasManagedStore,
    requests,
    error: null
  });
});

// Confirm a pending booking (Req 5.1, 12.1, 12.2).
router.post('/confirm', async (req, res) => {
  const { bookingId } = req.body;
  const result = await confirmBooking(req.user.userId, req.user.userRole, bookingId);
  if (result.status === 403) {
    return res.status(403).send('403 Forbidden: You do not have access to this resource.');
  }
  if (result.success) {
    return res.redirect('/manager/pending');
  }
  const { hasManagedStore, requests } = await getPendingRequests(req.user.userId);
  return res.render('manager/pending', {
    user: req.user,
    hasManagedStore,
    requests,
    error: result.error
  });
});

// Reject a pending booking (Req 6.1, 12.1, 12.2).
router.post('/reject', async (req, res) => {
  const { bookingId } = req.body;
  const result = await rejectBooking(req.user.userId, req.user.userRole, bookingId);
  if (result.status === 403) {
    return res.status(403).send('403 Forbidden: You do not have access to this resource.');
  }
  if (result.success) {
    return res.redirect('/manager/pending');
  }
  const { hasManagedStore, requests } = await getPendingRequests(req.user.userId);
  return res.render('manager/pending', {
    user: req.user,
    hasManagedStore,
    requests,
    error: result.error
  });
});

// End (complete) a confirmed shift (Req 7.1, 12.1, 12.2).
router.post('/end-shift', async (req, res) => {
  const { bookingId } = req.body;
  const result = await endShift(req.user.userId, bookingId);
  if (result.status === 403) {
    return res.status(403).send('403 Forbidden: You do not have access to this resource.');
  }
  if (result.success) {
    return res.redirect('/manager/dashboard');
  }
  // Non-authorization failure: re-render the dashboard surfacing the error.
  try {
    const { entries, errors } = await getManagerWageEntries(req.user.userId);
    return res.render('manager/dashboard', {
      user: req.user,
      wageEntries: entries,
      wageTotal: totalWage(entries),
      wageErrors: [...errors, result.error]
    });
  } catch (e) {
    console.error('[Manager] end-shift dashboard reload error', e);
    return res.render('manager/dashboard', {
      user: req.user,
      wageEntries: [],
      wageTotal: 0,
      wageErrors: [result.error]
    });
  }
});

router.get('/wages', async (req, res) => {
  const now = new Date();
  const start = req.query.start ? new Date(req.query.start) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = req.query.end ? new Date(req.query.end) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
  try {
    const reports = await calculateAllWages(start, end);
    const totalWages = reports.reduce((s, r) => s + r.totalWages, 0);
    const totalHours = reports.reduce((s, r) => s + r.totalHours, 0);
    res.render('manager/wages', {
      reports, error: null,
      summary: {
        totalEmployees: reports.length,
        totalWages: totalWages.toFixed(2),
        totalHours: totalHours.toFixed(2),
        periodStart: start.toISOString().split('T')[0],
        periodEnd: end.toISOString().split('T')[0]
      },
      filters: {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
      }
    });
  } catch (e) {
    console.error('[Manager] wages error', e);
    res.render('manager/wages', { reports: [], error: 'Failed to load wages', summary: null, filters: {} });
  }
});

router.post('/update-rate', async (req, res) => {
  const { employeeId, newRate } = req.body;
  const result = await updateHourlyRate(employeeId, parseFloat(newRate));
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

// Get all employees for rate management
router.get('/employees', async (req, res) => {
  const result = await pool.query(
    `SELECT id, user_id, first_name, last_name, hourly_wage
     FROM users WHERE role = 'employee' AND is_active = true ORDER BY last_name`
  );
  res.render('manager/employees', { employees: result.rows, error: null });
});

// ─── Weekly Roster ─────────────────────────────────────────────────────────────

router.get('/roster', async (req, res) => {
  try {
    const validation = validateRosterRequest({ date: req.query.date || null });

    if (!validation.valid) {
      return res.render('manager/roster', {
        user: req.user, error: validation.error,
        hasManagedStore: true, roster: [],
        weekStartFormatted: '', weekEndFormatted: '',
        prevWeekDate: '', nextWeekDate: '',
        canGoPrev: false, canGoNext: false
      });
    }

    const { start: weekStart, end: weekEnd } = validation.week;
    const result = await getRoster(req.user.userId, weekStart, weekEnd);
    const bounds = isWithinNavigationBounds(weekStart, new Date());

    // Compute prev/next week dates
    const prevMonday = new Date(weekStart);
    prevMonday.setDate(prevMonday.getDate() - 7);
    const nextMonday = new Date(weekStart);
    nextMonday.setDate(nextMonday.getDate() + 7);

    res.render('manager/roster', {
      user: req.user,
      error: null,
      hasManagedStore: result.hasManagedStore,
      roster: result.roster,
      weekStartFormatted: weekStart.toISOString().split('T')[0],
      weekEndFormatted: weekEnd.toISOString().split('T')[0],
      prevWeekDate: prevMonday.toISOString().split('T')[0],
      nextWeekDate: nextMonday.toISOString().split('T')[0],
      canGoPrev: bounds.canGoPrev,
      canGoNext: bounds.canGoNext
    });
  } catch (e) {
    console.error('[Manager] roster error', e);
    res.render('manager/roster', {
      user: req.user, error: 'Failed to load roster',
      hasManagedStore: true, roster: [],
      weekStartFormatted: '', weekEndFormatted: '',
      prevWeekDate: '', nextWeekDate: '',
      canGoPrev: false, canGoNext: false
    });
  }
});

// ─── Weekly Timesheet ──────────────────────────────────────────────────────────

router.get('/timesheet', async (req, res) => {
  try {
    const validation = validateRosterRequest({ date: req.query.date || null });

    if (!validation.valid) {
      return res.render('manager/timesheet', {
        user: req.user, error: validation.error, success: false,
        hasStore: true, timesheet: null, isFutureWeek: false,
        weekStartFormatted: '', weekEndFormatted: '',
        prevWeekDate: '', nextWeekDate: '',
        canGoPrev: false, canGoNext: false
      });
    }

    const { start: weekStart, end: weekEnd } = validation.week;
    const result = await generateTimesheet(req.user.userId, weekStart, weekEnd);
    const bounds = isWithinNavigationBounds(weekStart, new Date());
    const isFutureWeek = weekEnd.getTime() > Date.now();

    const prevMonday = new Date(weekStart);
    prevMonday.setDate(prevMonday.getDate() - 7);
    const nextMonday = new Date(weekStart);
    nextMonday.setDate(nextMonday.getDate() + 7);

    if (!result.success) {
      return res.render('manager/timesheet', {
        user: req.user, error: result.error, success: false,
        hasStore: false, timesheet: null, isFutureWeek,
        weekStartFormatted: weekStart.toISOString().split('T')[0],
        weekEndFormatted: weekEnd.toISOString().split('T')[0],
        prevWeekDate: prevMonday.toISOString().split('T')[0],
        nextWeekDate: nextMonday.toISOString().split('T')[0],
        canGoPrev: bounds.canGoPrev, canGoNext: bounds.canGoNext
      });
    }

    res.render('manager/timesheet', {
      user: req.user, error: null, success: false,
      hasStore: true, timesheet: result.timesheet, isFutureWeek,
      weekStartFormatted: weekStart.toISOString().split('T')[0],
      weekEndFormatted: weekEnd.toISOString().split('T')[0],
      prevWeekDate: prevMonday.toISOString().split('T')[0],
      nextWeekDate: nextMonday.toISOString().split('T')[0],
      canGoPrev: bounds.canGoPrev, canGoNext: bounds.canGoNext
    });
  } catch (e) {
    console.error('[Manager] timesheet error', e);
    res.render('manager/timesheet', {
      user: req.user, error: 'Failed to load timesheet', success: false,
      hasStore: true, timesheet: null, isFutureWeek: false,
      weekStartFormatted: '', weekEndFormatted: '',
      prevWeekDate: '', nextWeekDate: '',
      canGoPrev: false, canGoNext: false
    });
  }
});

router.post('/timesheet/submit', async (req, res) => {
  try {
    const { weekStart, weekEnd } = req.body;
    const wsDate = new Date(weekStart);
    const weDate = new Date(weekEnd);
    weDate.setHours(23, 59, 59, 999);

    const result = await submitTimesheet(req.user.userId, wsDate, weDate);

    if (!result.success) {
      const bounds = isWithinNavigationBounds(wsDate, new Date());
      const isFutureWeek = weDate.getTime() > Date.now();
      const tsResult = await generateTimesheet(req.user.userId, wsDate, weDate);

      const prevMonday = new Date(wsDate);
      prevMonday.setDate(prevMonday.getDate() - 7);
      const nextMonday = new Date(wsDate);
      nextMonday.setDate(nextMonday.getDate() + 7);

      return res.render('manager/timesheet', {
        user: req.user, error: result.error, success: false,
        hasStore: true, timesheet: tsResult.success ? tsResult.timesheet : null, isFutureWeek,
        weekStartFormatted: weekStart,
        weekEndFormatted: weekEnd,
        prevWeekDate: prevMonday.toISOString().split('T')[0],
        nextWeekDate: nextMonday.toISOString().split('T')[0],
        canGoPrev: bounds.canGoPrev, canGoNext: bounds.canGoNext
      });
    }

    // Success — redirect back to timesheet view
    res.redirect(`/manager/timesheet?date=${weekStart}`);
  } catch (e) {
    console.error('[Manager] timesheet submit error', e);
    res.redirect('/manager/timesheet');
  }
});

// ─── Store Daily Checklist ──────────────────────────────────────────────────────

router.get('/store-checklist', async (req, res) => {
  try {
    const result = await getOrCreateTodayChecklist(req.user.userId);
    if (!result.success) {
      return res.render('manager/store-checklist', {
        user: req.user, checklist: null, error: result.error, success: false, edit: false
      });
    }
    res.render('manager/store-checklist', {
      user: req.user, checklist: result.checklist, error: null, success: false, edit: req.query.edit === '1'
    });
  } catch (e) {
    console.error('[Manager] store-checklist error', e);
    res.render('manager/store-checklist', {
      user: req.user, checklist: null, error: 'Failed to load checklist', success: false, edit: false
    });
  }
});

router.post('/store-checklist/submit', async (req, res) => {
  try {
    const { checklistId, ...body } = req.body;

    // Extract quantities from form (fields named qty_<itemId>)
    const quantities = {};
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('qty_')) {
        const itemId = key.replace('qty_', '');
        quantities[itemId] = value;
      }
    }

    const result = await submitStoreChecklist(req.user.userId, checklistId, quantities);

    if (!result.success) {
      const checklistResult = await getOrCreateTodayChecklist(req.user.userId);
      return res.render('manager/store-checklist', {
        user: req.user,
        checklist: checklistResult.success ? checklistResult.checklist : null,
        error: result.error,
        success: false,
        edit: false
      });
    }

    // Reload to show submitted state
    const checklistResult = await getOrCreateTodayChecklist(req.user.userId);
    res.render('manager/store-checklist', {
      user: req.user,
      checklist: checklistResult.success ? checklistResult.checklist : null,
      error: null,
      success: true,
      edit: false
    });
  } catch (e) {
    console.error('[Manager] store-checklist submit error', e);
    res.render('manager/store-checklist', {
      user: req.user, checklist: null, error: 'Failed to submit checklist', success: false, edit: false
    });
  }
});

// ─── (Legacy checklist upload removed — replaced by store-checklist) ────────────

module.exports = router;
