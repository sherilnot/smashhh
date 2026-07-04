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
    `SELECT u.id, u.user_id, u.first_name, u.last_name, u.hourly_wage, u.employment_type
     FROM users u
     JOIN store_employee_assignments sea ON sea.employee_id = u.id
     JOIN store_manager_assignments sma ON sma.store_id = sea.store_id
     WHERE u.role = 'employee' AND u.is_active = true
       AND sma.manager_id = $1
     ORDER BY u.last_name`,
    [req.user.userId]
  );

  const permanent = result.rows.filter(e => e.employment_type === 'permanent');
  const casual = result.rows.filter(e => e.employment_type === 'casual');

  res.render('manager/employees', { permanent, casual, error: null });
});

// ─── Weekly Roster ─────────────────────────────────────────────────────────────

router.get('/roster', async (req, res) => {
  try {
    const validation = validateRosterRequest({ date: req.query.date || null });

    if (!validation.valid) {
      return res.render('manager/roster', {
        user: req.user, error: validation.error,
        hasManagedStore: true, roster: [], rosterRows: [], dayLabels: [], dayDates: [],
        shifts: [], employees: [], query: req.query,
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

    const toLocalDateString = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Build Monday..Sunday day labels + date keys for this week's grid columns
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      dayDates.push(toLocalDateString(d));
    }

    // Index each employee's shifts by day-of-week (0=Mon..6=Sun) and split
    // worked hours into weekday (Mon-Fri) vs weekend (Sat-Sun) totals.
    const rosterRows = result.roster.map(entry => {
      const byDay = Array(7).fill(null);
      let weekdayHours = 0;
      let weekendHours = 0;

      entry.shifts.forEach(shift => {
        const start = new Date(shift.start_time);
        const end = new Date(shift.end_time);
        const dateKey = toLocalDateString(start);
        const dayIdx = dayDates.indexOf(dateKey);
        const hours = (end - start) / 3600000;

        if (dayIdx === 5 || dayIdx === 6) {
          weekendHours += hours;
        } else {
          weekdayHours += hours;
        }

        if (dayIdx !== -1) {
          byDay[dayIdx] = {
            shift_id: shift.shift_id,
            booking_id: shift.booking_id,
            startLabel: start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
            endLabel: end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
            startISO: start.toISOString().slice(0, 16),
            endISO: end.toISOString().slice(0, 16),
            location: shift.store_location,
            actual_clock_in: shift.actual_clock_in ? new Date(shift.actual_clock_in).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : null,
            actual_clock_out: shift.actual_clock_out ? new Date(shift.actual_clock_out).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : null
          };
        }
      });

      return {
        name: `${entry.employee.last_name}, ${entry.employee.first_name}`,
        employeeId: entry.employee.id,
        employmentType: entry.employee.employment_type,
        byDay,
        weekdayHours: Math.round(weekdayHours * 100) / 100,
        weekendHours: Math.round(weekendHours * 100) / 100,
        totalHours: Math.round((weekdayHours + weekendHours) * 100) / 100
      };
    });

    // Get available employees for edit mode
    let employees = [];
    if (req.query.edit === '1') {
      const storeRes2 = await pool.query(
        `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
        [req.user.userId]
      );
      if (storeRes2.rows.length > 0) {
        const { getEmployeesByPriority } = require('../services/priorityService');
        employees = await getEmployeesByPriority(storeRes2.rows[0].store_id);
      }
    }

    res.render('manager/roster', {
      user: req.user,
      error: null,
      hasManagedStore: result.hasManagedStore,
      roster: result.roster,
      rosterRows,
      dayLabels,
      dayDates,
      shifts: result.shifts || [],
      employees,
      query: req.query,
      weekStartFormatted: toLocalDateString(weekStart),
      weekEndFormatted: toLocalDateString(weekEnd),
      prevWeekDate: toLocalDateString(prevMonday),
      nextWeekDate: toLocalDateString(nextMonday),
      canGoPrev: bounds.canGoPrev,
      canGoNext: bounds.canGoNext
    });
  } catch (e) {
    console.error('[Manager] roster error', e);
    res.render('manager/roster', {
      user: req.user, error: 'Failed to load roster',
      hasManagedStore: true, roster: [], rosterRows: [], dayLabels: [], dayDates: [],
      shifts: [], employees: [], query: req.query,
      weekStartFormatted: '', weekEndFormatted: '',
      prevWeekDate: '', nextWeekDate: '',
      canGoPrev: false, canGoNext: false
    });
  }
});

// ─── Roster Editing ────────────────────────────────────────────────────────────

const { recalculatePriority, getEmployeesByPriority, autoFillRoster } = require('../services/priorityService');

// Get available employees for assignment (JSON endpoint for the edit UI)
router.get('/roster/employees', async (req, res) => {
  try {
    const storeRes = await pool.query(
      `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
      [req.user.userId]
    );
    if (storeRes.rows.length === 0) return res.json([]);
    const storeId = storeRes.rows[0].store_id;
    const employees = await getEmployeesByPriority(storeId);
    res.json(employees);
  } catch (e) {
    console.error('[Manager] roster/employees error', e);
    res.json([]);
  }
});

// Assign an employee to a shift
router.post('/roster/assign', async (req, res) => {
  try {
    const { shiftId, employeeId, weekStart } = req.body;

    // Verify shift belongs to manager's store
    const verifyRes = await pool.query(
      `SELECT s.id FROM shifts s
       JOIN store_manager_assignments sma ON sma.store_id = s.store_id
       WHERE s.id = $1 AND sma.manager_id = $2`,
      [shiftId, req.user.userId]
    );
    if (verifyRes.rows.length === 0) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
    }

    // Insert booking as confirmed (manager-assigned)
    await pool.query(
      `INSERT INTO shift_bookings (shift_id, employee_id, booking_status, assigned_by)
       VALUES ($1, $2, 'confirmed', $3)
       ON CONFLICT DO NOTHING`,
      [shiftId, employeeId, req.user.userId]
    );

    res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
  } catch (e) {
    console.error('[Manager] roster/assign error', e);
    res.redirect('/manager/roster?edit=1');
  }
});

// Unassign an employee from a shift
router.post('/roster/unassign', async (req, res) => {
  try {
    const { bookingId, weekStart } = req.body;

    // Verify booking belongs to manager's store
    const verifyRes = await pool.query(
      `SELECT sb.id FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN store_manager_assignments sma ON sma.store_id = s.store_id
       WHERE sb.id = $1 AND sma.manager_id = $2`,
      [bookingId, req.user.userId]
    );
    if (verifyRes.rows.length === 0) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
    }

    await pool.query(`DELETE FROM shift_bookings WHERE id = $1`, [bookingId]);
    res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
  } catch (e) {
    console.error('[Manager] roster/unassign error', e);
    res.redirect('/manager/roster?edit=1');
  }
});

// Edit shift times
router.post('/roster/edit-shift', async (req, res) => {
  try {
    const { shiftId, startTime, endTime, weekStart } = req.body;

    // Verify shift belongs to manager's store
    const verifyRes = await pool.query(
      `SELECT s.id FROM shifts s
       JOIN store_manager_assignments sma ON sma.store_id = s.store_id
       WHERE s.id = $1 AND sma.manager_id = $2`,
      [shiftId, req.user.userId]
    );
    if (verifyRes.rows.length === 0) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
    }

    await pool.query(
      `UPDATE shifts SET start_time = $1, end_time = $2, updated_at = NOW() WHERE id = $3`,
      [startTime, endTime, shiftId]
    );

    res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
  } catch (e) {
    console.error('[Manager] roster/edit-shift error', e);
    res.redirect('/manager/roster?edit=1');
  }
});

// Record actual clock-in time for an employee
router.post('/roster/clock-in', async (req, res) => {
  try {
    const { bookingId, clockIn, clockOut, weekStart } = req.body;

    // Verify booking belongs to manager's store
    const verifyRes = await pool.query(
      `SELECT sb.id FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN store_manager_assignments sma ON sma.store_id = s.store_id
       WHERE sb.id = $1 AND sma.manager_id = $2`,
      [bookingId, req.user.userId]
    );
    if (verifyRes.rows.length === 0) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (clockIn) {
      updates.push(`actual_clock_in = $${idx++}`);
      values.push(clockIn);
    }
    if (clockOut) {
      updates.push(`actual_clock_out = $${idx++}`);
      values.push(clockOut);
    }

    if (updates.length > 0) {
      values.push(bookingId);
      await pool.query(
        `UPDATE shift_bookings SET ${updates.join(', ')} WHERE id = $${idx}`,
        values
      );
    }

    res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
  } catch (e) {
    console.error('[Manager] roster/clock-in error', e);
    res.redirect('/manager/roster?edit=1');
  }
});

// Auto-fill roster with priority employees
router.post('/roster/auto-fill', async (req, res) => {
  try {
    const { weekStart } = req.body;
    const storeRes = await pool.query(
      `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
      [req.user.userId]
    );
    if (storeRes.rows.length === 0) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}`);
    }

    const storeId = storeRes.rows[0].store_id;

    // Recalculate priorities first
    await recalculatePriority(storeId);

    // Parse week bounds
    const parseLocalDate = (str) => {
      const [y, m, d] = String(str).split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    };
    const wsDate = parseLocalDate(weekStart);
    const weDate = new Date(wsDate);
    weDate.setDate(weDate.getDate() + 6);
    weDate.setHours(23, 59, 59, 999);

    await autoFillRoster(req.user.userId, storeId, wsDate, weDate);
    res.redirect(`/manager/roster?date=${weekStart || ''}`);
  } catch (e) {
    console.error('[Manager] roster/auto-fill error', e);
    res.redirect('/manager/roster');
  }
});

// ─── Weekly Timesheet ──────────────────────────────────────────────────────────

router.get('/timesheet', async (req, res) => {
  try {
    const validation = validateRosterRequest({ date: req.query.date || null });

    if (!validation.valid) {
      return res.render('manager/timesheet', {
        user: req.user, error: validation.error, success: false,
        hasStore: true, timesheet: null, timesheetRows: [], dayLabels: [], dayDates: [], isFutureWeek: false,
        query: req.query,
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

    const toLocalDateString = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    if (!result.success) {
      return res.render('manager/timesheet', {
        user: req.user, error: result.error, success: false,
        hasStore: false, timesheet: null, timesheetRows: [], dayLabels: [], dayDates: [], isFutureWeek,
        query: req.query,
        weekStartFormatted: toLocalDateString(weekStart),
        weekEndFormatted: toLocalDateString(weekEnd),
        prevWeekDate: toLocalDateString(prevMonday),
        nextWeekDate: toLocalDateString(nextMonday),
        canGoPrev: bounds.canGoPrev, canGoNext: bounds.canGoNext
      });
    }

    // Build day labels and date keys (Mon..Sun)
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      dayDates.push(toLocalDateString(d));
    }

    // Build grid rows: one per employee, with shifts indexed by day
    const timesheetRows = result.timesheet.employees.map(emp => {
      const byDay = Array(7).fill(null);
      let weekdayHours = 0;
      let weekendHours = 0;

      emp.shifts.forEach(shift => {
        const dateKey = shift.shift_date instanceof Date
          ? toLocalDateString(shift.shift_date)
          : toLocalDateString(new Date(shift.shift_date));
        const dayIdx = dayDates.indexOf(dateKey);
        if (dayIdx !== -1) {
          const start = new Date(shift.shift_start);
          const end = new Date(shift.shift_end);
          const startLabel = start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
          const endLabel = end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

          byDay[dayIdx] = {
            booking_id: shift.booking_id,
            startLabel,
            endLabel,
            hours_worked: shift.hours_worked,
            no_show: shift.no_show,
            adjusted: shift.adjusted
          };

          if (dayIdx >= 5) {
            weekendHours += shift.hours_worked;
          } else {
            weekdayHours += shift.hours_worked;
          }
        }
      });

      return {
        name: emp.last_name + ', ' + emp.first_name,
        employmentType: emp.employment_type || null,
        totalHours: emp.totalHours,
        weekdayHours: Math.round(weekdayHours * 100) / 100,
        weekendHours: Math.round(weekendHours * 100) / 100,
        byDay
      };
    });

    res.render('manager/timesheet', {
      user: req.user, error: null, success: false,
      hasStore: true, timesheet: result.timesheet, timesheetRows, dayLabels, dayDates, isFutureWeek,
      query: req.query,
      weekStartFormatted: toLocalDateString(weekStart),
      weekEndFormatted: toLocalDateString(weekEnd),
      prevWeekDate: toLocalDateString(prevMonday),
      nextWeekDate: toLocalDateString(nextMonday),
      canGoPrev: bounds.canGoPrev, canGoNext: bounds.canGoNext
    });
  } catch (e) {
    console.error('[Manager] timesheet error', e);
    res.render('manager/timesheet', {
      user: req.user, error: 'Failed to load timesheet', success: false,
      hasStore: true, timesheet: null, timesheetRows: [], dayLabels: [], dayDates: [], isFutureWeek: false,
      query: req.query,
      weekStartFormatted: '', weekEndFormatted: '',
      prevWeekDate: '', nextWeekDate: '',
      canGoPrev: false, canGoNext: false
    });
  }
});

// ─── Timesheet Edit: mark no-show or adjust hours ───────────────────────────

router.post('/timesheet/edit', async (req, res) => {
  try {
    const { bookingId, action, adjustedHours, weekStart } = req.body;

    // Verify the booking belongs to a shift in the manager's store
    const verifyRes = await pool.query(
      `SELECT sb.id, sb.booking_status, s.start_time, s.end_time
       FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN store_manager_assignments sma ON sma.store_id = s.store_id
       WHERE sb.id = $1 AND sma.manager_id = $2`,
      [bookingId, req.user.userId]
    );

    if (verifyRes.rows.length === 0) {
      return res.redirect(`/manager/timesheet?date=${weekStart || ''}&error=Booking not found or not in your store`);
    }

    const booking = verifyRes.rows[0];

    if (action === 'no_show') {
      await pool.query(
        `UPDATE shift_bookings SET no_show = true, adjusted_hours = 0 WHERE id = $1`,
        [bookingId]
      );
    } else if (action === 'delete_entry') {
      // Toggle: if already marked no_show, undo it; otherwise mark it
      const checkRes = await pool.query(
        `SELECT no_show FROM shift_bookings WHERE id = $1`,
        [bookingId]
      );
      if (checkRes.rows.length > 0 && checkRes.rows[0].no_show) {
        await pool.query(
          `UPDATE shift_bookings SET no_show = false, adjusted_hours = NULL WHERE id = $1`,
          [bookingId]
        );
      } else {
        await pool.query(
          `UPDATE shift_bookings SET no_show = true, adjusted_hours = 0 WHERE id = $1`,
          [bookingId]
        );
      }
    } else if (action === 'undo_no_show') {
      await pool.query(
        `UPDATE shift_bookings SET no_show = false, adjusted_hours = NULL WHERE id = $1`,
        [bookingId]
      );
    } else if (action === 'adjust_hours') {
      const hours = parseFloat(adjustedHours);
      if (isNaN(hours) || hours < 0 || hours > 24) {
        return res.redirect(`/manager/timesheet?date=${weekStart || ''}&edit=1&error=Invalid hours value`);
      }
      await pool.query(
        `UPDATE shift_bookings SET adjusted_hours = $1, no_show = false WHERE id = $2`,
        [hours, bookingId]
      );
    } else if (action === 'reset_hours') {
      await pool.query(
        `UPDATE shift_bookings SET adjusted_hours = NULL, no_show = false WHERE id = $1`,
        [bookingId]
      );
    }

    res.redirect(`/manager/timesheet?date=${weekStart || ''}&edit=1`);
  } catch (e) {
    console.error('[Manager] timesheet edit error', e);
    res.redirect('/manager/timesheet');
  }
});

router.post('/timesheet/submit', async (req, res) => {
  try {
    const { weekStart, weekEnd } = req.body;

    const parseLocalDate = (str) => {
      const [y, m, d] = String(str).split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    };
    const toLocalDateString = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const wsDate = parseLocalDate(weekStart);
    const weDate = parseLocalDate(weekEnd);
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
        prevWeekDate: toLocalDateString(prevMonday),
        nextWeekDate: toLocalDateString(nextMonday),
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
