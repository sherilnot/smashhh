const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getAvailableShifts, bookShift, cancelShift, getEmployeeShifts } = require('../services/shiftService');
const { getEmployeeWageEntries, totalWage } = require('../services/wageService');

const router = express.Router();

router.use(requireAuth, roleGuard('employee'));

// Dashboard - shows the employee's own completed-shift wage entries and total
router.get('/dashboard', async (req, res) => {
  try {
    const { entries } = await getEmployeeWageEntries(req.user.userId);
    const total = totalWage(entries);
    res.render('employee/dashboard', { user: req.user, wageEntries: entries, wageTotal: total });
  } catch (e) {
    res.render('employee/dashboard', { user: req.user, wageEntries: [], wageTotal: 0 });
  }
});

// Available shifts (next 7 days by default) — filtered to employee's assigned store
router.get('/shifts', async (req, res) => {
  const start = req.query.start ? new Date(req.query.start) : new Date();
  const end = req.query.end ? new Date(req.query.end) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  try {
    const shifts = await getAvailableShifts(start, end, req.user.userId);

    // Build next week's days for the booking form
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? 1 : 8 - day;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + diffToMonday);
    nextMonday.setHours(0, 0, 0, 0);

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const nextWeekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(nextMonday);
      d.setDate(nextMonday.getDate() + i);
      nextWeekDays.push({
        label: dayNames[i],
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      });
    }

    res.render('employee/shifts', { shifts, nextWeekDays, error: null });
  } catch (e) {
    res.render('employee/shifts', { shifts: [], nextWeekDays: [], error: 'Failed to load shifts' });
  }
});

// Book a shift using day + shift type selection
router.post('/book-shift', async (req, res) => {
  const { day, shiftType, customStart, customEnd } = req.body;
  try {
    const SHIFT_MAP = {
      '11-1730': { startH: 11, startM: 0, endH: 17, endM: 30 },
      '1730-2100': { startH: 17, startM: 30, endH: 21, endM: 0 },
      '11-2100': { startH: 11, startM: 0, endH: 21, endM: 0 }
    };

    const [y, m, d2] = day.split('-').map(Number);
    let startTime, endTime;

    if (shiftType === 'custom') {
      if (!customStart || !customEnd) {
        return res.render('employee/shifts', { shifts: [], nextWeekDays: [], error: 'Please provide custom start and end times' });
      }
      const [sh, sm] = customStart.split(':').map(Number);
      const [eh, em] = customEnd.split(':').map(Number);
      startTime = new Date(y, m - 1, d2, sh, sm, 0);
      endTime = new Date(y, m - 1, d2, eh, em, 0);
    } else {
      const st = SHIFT_MAP[shiftType];
      if (!st) {
        return res.render('employee/shifts', { shifts: [], nextWeekDays: [], error: 'Invalid shift type' });
      }
      startTime = new Date(y, m - 1, d2, st.startH, st.startM, 0);
      endTime = new Date(y, m - 1, d2, st.endH, st.endM, 0);
    }

    if (endTime <= startTime) {
      return res.render('employee/shifts', { shifts: [], nextWeekDays: [], error: 'End time must be after start time' });
    }

    // Get employee's store
    const { pool } = require('../config/database');
    const storeRes = await pool.query(
      `SELECT sea.store_id, st.name FROM store_employee_assignments sea JOIN stores st ON st.id = sea.store_id WHERE sea.employee_id = $1 LIMIT 1`,
      [req.user.userId]
    );
    if (storeRes.rows.length === 0) {
      return res.render('employee/shifts', { shifts: [], nextWeekDays: [], error: 'You are not assigned to a store' });
    }
    const storeId = storeRes.rows[0].store_id;
    const storeName = storeRes.rows[0].name;

    // Find or create shift
    let shiftId;
    const existingShift = await pool.query(
      `SELECT id FROM shifts WHERE store_id = $1 AND start_time = $2 AND end_time = $3`,
      [storeId, startTime, endTime]
    );
    if (existingShift.rows.length > 0) {
      shiftId = existingShift.rows[0].id;
    } else {
      const newShift = await pool.query(
        `INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id) VALUES ($1, $2, $3, 5, $4) RETURNING id`,
        [startTime, endTime, storeName, storeId]
      );
      shiftId = newShift.rows[0].id;
    }

    // Book the shift
    const result = await bookShift(req.user.userId, shiftId);
    if (result.success) return res.redirect('/employee/my-shifts');

    return res.render('employee/shifts', { shifts: [], nextWeekDays: [], error: result.error });
  } catch (e) {
    console.error('[Employee] book-shift error', e);
    return res.render('employee/shifts', { shifts: [], nextWeekDays: [], error: 'Failed to book shift' });
  }
});

// My booked shifts
router.get('/my-shifts', async (req, res) => {
  const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = req.query.end ? new Date(req.query.end) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  try {
    const shifts = await getEmployeeShifts(req.user.userId, start, end);
    res.render('employee/my-shifts', { shifts, error: null });
  } catch (e) {
    res.render('employee/my-shifts', { shifts: [], error: 'Failed to load your shifts' });
  }
});

// Book a shift
router.post('/book', async (req, res) => {
  const { shiftId } = req.body;
  const result = await bookShift(req.user.userId, shiftId);
  if (result.success) return res.redirect('/employee/my-shifts');
  // Re-render shifts with error
  try {
    const shifts = await getAvailableShifts(new Date(), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), req.user.userId);
    return res.render('employee/shifts', { shifts, error: result.error });
  } catch (e) {
    return res.render('employee/shifts', { shifts: [], error: result.error });
  }
});

// Cancel a shift
router.post('/cancel', async (req, res) => {
  const { shiftId } = req.body;
  const result = await cancelShift(req.user.userId, shiftId);
  if (result.success) return res.redirect('/employee/my-shifts');
  try {
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const shifts = await getEmployeeShifts(req.user.userId, start, end);
    return res.render('employee/my-shifts', { shifts, error: result.error });
  } catch (e) {
    return res.render('employee/my-shifts', { shifts: [], error: result.error });
  }
});

module.exports = router;
