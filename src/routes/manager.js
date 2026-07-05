const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getManagerWageEntries, totalWage } = require('../services/wageService');
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
    // Roster always defaults to NEXT week
    const toLocalDateString = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? 1 : 8 - day; // next Monday
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + diffToMonday);
    nextMonday.setHours(0, 0, 0, 0);

    // Allow navigation via ?date= param
    let weekStart;
    if (req.query.date) {
      const [y, m, d2] = req.query.date.split('-').map(Number);
      const parsed = new Date(y, m - 1, d2);
      const pDay = parsed.getDay();
      const diff = pDay === 0 ? -6 : 1 - pDay;
      weekStart = new Date(parsed);
      weekStart.setDate(parsed.getDate() + diff);
      weekStart.setHours(0, 0, 0, 0);
    } else {
      weekStart = nextMonday;
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const bounds = isWithinNavigationBounds(weekStart, now);
    const prevMonday = new Date(weekStart);
    prevMonday.setDate(prevMonday.getDate() - 7);
    const nextMon = new Date(weekStart);
    nextMon.setDate(nextMon.getDate() + 7);

    // Fixed shift types
    const SHIFT_TYPES = [
      { label: '11:00 – 5:30', startH: 11, startM: 0, endH: 17, endM: 30, color: '#C8E6C9' },  // soft green
      { label: '5:30 – 9:00', startH: 17, startM: 30, endH: 21, endM: 0, color: '#FFF59D' },   // soft yellow
      { label: '11:00 – 9:00', startH: 11, startM: 0, endH: 21, endM: 0, color: '#B3E5FC' }    // soft blue
    ];

    // Build day labels & dates
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      dayDates.push(toLocalDateString(d));
    }

    // Get manager's store
    const storeRes = await pool.query(
      `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
      [req.user.userId]
    );
    if (storeRes.rows.length === 0) {
      return res.render('manager/roster', {
        user: req.user, error: null, hasManagedStore: false,
        shiftTypes: [], dayLabels: [], dayDates: [], rosterGrid: [],
        query: req.query, employees: [],
        weekStartFormatted: toLocalDateString(weekStart),
        weekEndFormatted: toLocalDateString(weekEnd),
        prevWeekDate: toLocalDateString(prevMonday),
        nextWeekDate: toLocalDateString(nextMon),
        canGoPrev: bounds.canGoPrev, canGoNext: bounds.canGoNext
      });
    }
    const storeId = storeRes.rows[0].store_id;

    // Get all confirmed bookings for the week
    const bookingsRes = await pool.query(
      `SELECT
         sb.id AS booking_id, sb.employee_id, sb.actual_clock_in,
         u.first_name, u.last_name,
         s.id AS shift_id, s.start_time, s.end_time
       FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN users u ON u.id = sb.employee_id
       WHERE s.store_id = $1
         AND sb.booking_status = 'confirmed'
         AND s.start_time >= $2
         AND s.start_time <= $3
       ORDER BY u.last_name, u.first_name`,
      [storeId, weekStart, weekEnd]
    );

    // Build roster data: employees × days with shift info
    const employeesRes = await pool.query(
      `SELECT DISTINCT u.id, u.user_id, u.first_name, u.last_name, u.employment_type, u.priority_score
       FROM users u
       JOIN store_employee_assignments sea ON sea.employee_id = u.id
       WHERE sea.store_id = $1 AND u.is_active = true AND u.role = 'employee'
       ORDER BY u.last_name, u.first_name`,
      [storeId]
    );

    const rosterRows = employeesRes.rows.map(emp => {
      const byDay = dayDates.map(dateStr => {
        // Find all bookings for this employee on this day
        const bookings = bookingsRes.rows.filter(b => {
          const bStart = new Date(b.start_time);
          const bDate = toLocalDateString(bStart);
          return bDate === dateStr && b.employee_id === emp.id;
        });

        return bookings.map(b => {
          const bStart = new Date(b.start_time);
          const bEnd = new Date(b.end_time);
          
          // Determine shift type and color
          let shiftType = 'custom';
          let color = '#F8BBD0'; // soft pink for custom
          let label = bStart.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) + 
                     '–' + bEnd.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
          
          SHIFT_TYPES.forEach(st => {
            if (bStart.getHours() === st.startH && bStart.getMinutes() === st.startM &&
                bEnd.getHours() === st.endH && bEnd.getMinutes() === st.endM) {
              shiftType = st.label;
              color = st.color;
              label = st.label;
            }
          });

          return {
            booking_id: b.booking_id,
            label,
            color,
            shiftType,
            actual_clock_in: b.actual_clock_in ? new Date(b.actual_clock_in).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : null
          };
        });
      });

      return {
        employee_id: emp.id,
        name: emp.last_name ? (emp.last_name + ', ' + emp.first_name) : emp.first_name,
        employmentType: emp.employment_type,
        priority_score: emp.priority_score || 0,
        byDay
      };
    });

    // Get employees for edit mode
    let employees = [];
    if (req.query.edit === '1') {
      const { getEmployeesByPriority } = require('../services/priorityService');
      employees = await getEmployeesByPriority(storeId);
    }

    res.render('manager/roster', {
      user: req.user, error: null, hasManagedStore: true,
      shiftTypes: SHIFT_TYPES, dayLabels, dayDates, rosterRows,
      query: req.query, employees,
      weekStartFormatted: toLocalDateString(weekStart),
      weekEndFormatted: toLocalDateString(weekEnd),
      prevWeekDate: toLocalDateString(prevMonday),
      nextWeekDate: toLocalDateString(nextMon),
      canGoPrev: bounds.canGoPrev, canGoNext: bounds.canGoNext
    });
  } catch (e) {
    console.error('[Manager] roster error', e);
    res.render('manager/roster', {
      user: req.user, error: 'Failed to load roster',
      hasManagedStore: true, shiftTypes: [], dayLabels: [], dayDates: [], rosterRows: [],
      query: req.query, employees: [],
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
    const { shiftId, employeeId, weekStart, shiftType, day } = req.body;

    // Get manager's store
    const storeRes = await pool.query(
      `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
      [req.user.userId]
    );
    if (storeRes.rows.length === 0) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
    }
    const storeId = storeRes.rows[0].store_id;

    let targetShiftId = shiftId;

    // If shiftType + day provided (new format), find or create the shift
    if (!targetShiftId && shiftType && day) {
      const SHIFT_MAP = {
        '11-1730': { startH: 11, startM: 0, endH: 17, endM: 30 },
        '1730-2100': { startH: 17, startM: 30, endH: 21, endM: 0 },
        '11-2100': { startH: 11, startM: 0, endH: 21, endM: 0 }
      };
      const st = SHIFT_MAP[shiftType];
      if (!st) return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);

      const [y, m, d2] = day.split('-').map(Number);
      const startTime = new Date(y, m - 1, d2, st.startH, st.startM, 0);
      const endTime = new Date(y, m - 1, d2, st.endH, st.endM, 0);

      // Find existing shift or create one
      const existingShift = await pool.query(
        `SELECT id FROM shifts WHERE store_id = $1 AND start_time = $2 AND end_time = $3`,
        [storeId, startTime, endTime]
      );

      if (existingShift.rows.length > 0) {
        targetShiftId = existingShift.rows[0].id;
      } else {
        // Get store name for location
        const storeNameRes = await pool.query(`SELECT name FROM stores WHERE id = $1`, [storeId]);
        const location = storeNameRes.rows[0]?.name || 'Store';
        const newShift = await pool.query(
          `INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id) VALUES ($1, $2, $3, 5, $4) RETURNING id`,
          [startTime, endTime, location, storeId]
        );
        targetShiftId = newShift.rows[0].id;
      }
    }

    if (!targetShiftId) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
    }

    // Insert booking as confirmed (manager-assigned)
    await pool.query(
      `INSERT INTO shift_bookings (shift_id, employee_id, booking_status, assigned_by)
       VALUES ($1, $2, 'confirmed', $3)
       ON CONFLICT DO NOTHING`,
      [targetShiftId, employeeId, req.user.userId]
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
    // Default to LAST week if no date provided
    let dateParam = req.query.date || null;
    if (!dateParam) {
      const now = new Date();
      const day = now.getDay();
      const diffToLastMonday = day === 0 ? -13 : -6 - day; // last week's Monday
      const lastMonday = new Date(now);
      lastMonday.setDate(now.getDate() + diffToLastMonday);
      dateParam = `${lastMonday.getFullYear()}-${String(lastMonday.getMonth() + 1).padStart(2, '0')}-${String(lastMonday.getDate()).padStart(2, '0')}`;
    }
    const validation = validateRosterRequest({ date: dateParam });

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
        name: emp.last_name ? (emp.last_name + ', ' + emp.first_name) : emp.first_name,
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
