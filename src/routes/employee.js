const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getAvailableShifts, bookShift, cancelShift, getEmployeeShifts } = require('../services/shiftService');
const { getEmployeeWageEntries, totalWage } = require('../services/wageService');
const { savePushSubscription, removePushSubscription, getNotificationData } = require('../services/notificationService');
const { getVapidPublicKey, saveWebPushSubscription, removeWebPushSubscription, sendPushNotification } = require('../services/webPushService');
const { hasSubmittedThisWeek, recordSubmission, getSubmissionStatus } = require('../services/weeklySubmissionService');

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
    // Check submission status
    const submissionStatus = await getSubmissionStatus(req.user.userId);
    
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

    res.render('employee/shifts', { 
      shifts, 
      nextWeekDays,
      submissionStatus,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (e) {
    console.error('[Employee] shifts error:', e);
    res.render('employee/shifts', { 
      shifts: [], 
      nextWeekDays: [],
      submissionStatus: { canSubmit: false, message: 'Error loading submission status' },
      error: req.query.error || 'Failed to load shifts',
      success: null
    });
  }
});

// Book weekly shifts (new grid form)
router.post('/book-weekly-shifts', async (req, res) => {
  try {
    console.log('[Employee] book-weekly-shifts received:', Object.keys(req.body).length, 'fields');
    
    // Check if employee has already submitted this week
    const { hasSubmitted, submittedAt } = await hasSubmittedThisWeek(req.user.userId);
    if (hasSubmitted) {
      console.log('[Employee] Submission blocked - already submitted at:', submittedAt);
      return res.redirect('/employee/shifts?error=' + encodeURIComponent('You have already submitted your shifts for next week. You can submit again next Wednesday.'));
    }
    
    // Validate submission window (Wed-Sat only)
    const now = new Date();
    const currentDay = now.getDay();
    if (currentDay < 3 || currentDay > 6) {
      console.log('[Employee] Submission blocked - outside window. Current day:', currentDay);
      return res.redirect('/employee/shifts?error=' + encodeURIComponent('Shift booking is only available Wednesday to Saturday'));
    }

    const { pool } = require('../config/database');
    
    // Get employee's store
    const storeRes = await pool.query(
      `SELECT sea.store_id, st.name FROM store_employee_assignments sea JOIN stores st ON st.id = sea.store_id WHERE sea.employee_id = $1 LIMIT 1`,
      [req.user.userId]
    );
    if (storeRes.rows.length === 0) {
      return res.redirect('/employee/shifts?error=' + encodeURIComponent('You are not assigned to a store'));
    }
    const storeId = storeRes.rows[0].store_id;
    const storeName = storeRes.rows[0].name;

    const SHIFT_MAP = {
      '11-1730': { startH: 11, startM: 0, endH: 17, endM: 30 },
      '1730-2100': { startH: 17, startM: 30, endH: 21, endM: 0 },
      '11-2100': { startH: 11, startM: 0, endH: 21, endM: 0 }
    };

    let bookedCount = 0;
    const errors = [];

    // Process each day's selection
    for (const key in req.body) {
      if (key.startsWith('shift_')) {
        const date = key.replace('shift_', '');
        const shiftType = req.body[key];

        // Skip if "none" selected
        if (shiftType === 'none') continue;

        const [y, m, d2] = date.split('-').map(Number);
        let startTime, endTime;

        if (shiftType === 'custom') {
          const customStartKey = `custom_start_${date}`;
          const customEndKey = `custom_end_${date}`;
          const customStart = req.body[customStartKey];
          const customEnd = req.body[customEndKey];

          if (!customStart || !customEnd) {
            errors.push(`${date}: Custom shift requires both start and end times`);
            continue;
          }

          const [sh, sm] = customStart.split(':').map(Number);
          const [eh, em] = customEnd.split(':').map(Number);
          startTime = new Date(y, m - 1, d2, sh, sm, 0);
          endTime = new Date(y, m - 1, d2, eh, em, 0);
        } else {
          const st = SHIFT_MAP[shiftType];
          if (!st) {
            errors.push(`${date}: Invalid shift type`);
            continue;
          }
          startTime = new Date(y, m - 1, d2, st.startH, st.startM, 0);
          endTime = new Date(y, m - 1, d2, st.endH, st.endM, 0);
        }

        if (endTime <= startTime) {
          errors.push(`${date}: End time must be after start time`);
          continue;
        }

        // Find or create shift
        let shiftId;
        const existingShift = await pool.query(
          `SELECT id FROM shifts WHERE store_id = $1 AND start_time = $2 AND end_time = $3`,
          [storeId, startTime, endTime]
        );

        if (existingShift.rows.length > 0) {
          shiftId = existingShift.rows[0].id;
        } else {
          // Bug 7 fix: INSERT ... ON CONFLICT DO NOTHING relies on the unique
          // index on (store_id, start_time, end_time) to atomically avoid
          // creating a duplicate shift row when two requests race for the
          // same new time slot. If this insert loses the race, RETURNING
          // comes back empty and we fall back to selecting the row the
          // winning request just created.
          const newShift = await pool.query(
            `INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id)
             VALUES ($1, $2, $3, 5, $4)
             ON CONFLICT (store_id, start_time, end_time) WHERE store_id IS NOT NULL DO NOTHING
             RETURNING id`,
            [startTime, endTime, storeName, storeId]
          );
          if (newShift.rows.length > 0) {
            shiftId = newShift.rows[0].id;
          } else {
            const winner = await pool.query(
              `SELECT id FROM shifts WHERE store_id = $1 AND start_time = $2 AND end_time = $3`,
              [storeId, startTime, endTime]
            );
            shiftId = winner.rows[0].id;
          }
        }

        // Check if already booked
        const existing = await pool.query(
          `SELECT id FROM shift_bookings WHERE employee_id = $1 AND shift_id = $2`,
          [req.user.userId, shiftId]
        );

        if (existing.rows.length === 0) {
          // Book the shift with pending status
          await pool.query(
            `INSERT INTO shift_bookings (shift_id, employee_id, booking_status) VALUES ($1, $2, 'pending')`,
            [shiftId, req.user.userId]
          );
          bookedCount++;
        }
      }
    }

    if (errors.length > 0) {
      return res.redirect('/employee/shifts?error=' + encodeURIComponent(errors.join('; ')));
    }

    if (bookedCount === 0) {
      return res.redirect('/employee/shifts?error=' + encodeURIComponent('No shifts were selected. Please select at least one shift (Morning, Evening, Full Day, or Custom) before submitting. Choose "No shift" only for days you\'re unavailable.'));
    }

    // Record that employee has submitted for this week
    await recordSubmission(req.user.userId);
    console.log('[Employee] Recorded weekly submission for employee:', req.user.userId);

    return res.redirect('/employee/my-shifts?success=' + encodeURIComponent(`Successfully submitted ${bookedCount} shift request(s) for manager approval. You can submit again next Wednesday.`));
  } catch (e) {
    console.error('[Employee] book-weekly-shifts error', e);
    return res.redirect('/employee/shifts?error=' + encodeURIComponent('Failed to book shifts'));
  }
});

// Book a shift using day + shift type selection (legacy route - kept for backwards compatibility)
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
        `INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id)
         VALUES ($1, $2, $3, 5, $4)
         ON CONFLICT (store_id, start_time, end_time) WHERE store_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [startTime, endTime, storeName, storeId]
      );
      if (newShift.rows.length > 0) {
        shiftId = newShift.rows[0].id;
      } else {
        const winner = await pool.query(
          `SELECT id FROM shifts WHERE store_id = $1 AND start_time = $2 AND end_time = $3`,
          [storeId, startTime, endTime]
        );
        shiftId = winner.rows[0].id;
      }
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
    res.render('employee/my-shifts', { 
      shifts, 
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (e) {
    res.render('employee/my-shifts', { 
      shifts: [], 
      error: req.query.error || 'Failed to load your shifts',
      success: null
    });
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

// ─── Notification Routes ──────────────────────────────────────────────────────

// Get VAPID public key for web push
router.get('/notifications/vapid-public-key', (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

// Subscribe to web push notifications
router.post('/notifications/webpush-subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    const result = await saveWebPushSubscription(req.user.userId, subscription);
    
    if (result.success) {
      res.json({ success: true, message: 'Subscribed to web push notifications' });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('[Employee] webpush-subscribe error:', error);
    res.status(500).json({ success: false, error: 'Failed to subscribe' });
  }
});

// Unsubscribe from web push notifications
router.post('/notifications/webpush-unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    await removeWebPushSubscription(req.user.userId, endpoint);
    res.json({ success: true, message: 'Unsubscribed from web push notifications' });
  } catch (error) {
    console.error('[Employee] webpush-unsubscribe error:', error);
    res.status(500).json({ success: false, error: 'Failed to unsubscribe' });
  }
});

// Test push notification
router.post('/notifications/test-push', async (req, res) => {
  try {
    const result = await sendPushNotification(req.user.userId, {
      title: '🧪 Test Notification',
      message: 'This is a test push notification. If you see this, Web Push is working!',
      data: { url: '/employee/dashboard', test: true }
    });
    
    if (result.success) {
      res.json({ success: true, message: `Test notification sent (${result.sent} devices)` });
    } else {
      res.status(500).json({ success: false, error: result.error || 'Failed to send test notification' });
    }
  } catch (error) {
    console.error('[Employee] test-push error:', error);
    res.status(500).json({ success: false, error: 'Failed to send test notification' });
  }
});

// Subscribe to notifications (legacy - basic browser notifications)
router.post('/notifications/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    const result = await savePushSubscription(req.user.userId, subscription);
    
    if (result.success) {
      res.json({ success: true, message: 'Subscribed to notifications' });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('[Employee] notifications/subscribe error:', error);
    res.status(500).json({ success: false, error: 'Failed to subscribe' });
  }
});

// Unsubscribe from notifications (legacy)
router.post('/notifications/unsubscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    await removePushSubscription(req.user.userId, subscription);
    res.json({ success: true, message: 'Unsubscribed from notifications' });
  } catch (error) {
    console.error('[Employee] notifications/unsubscribe error:', error);
    res.status(500).json({ success: false, error: 'Failed to unsubscribe' });
  }
});

// Check if employee needs notification reminder
router.get('/notifications/check', async (req, res) => {
  try {
    const data = await getNotificationData(req.user.userId);
    res.json(data);
  } catch (error) {
    console.error('[Employee] notifications/check error:', error);
    res.status(500).json({ 
      needsReminder: false, 
      message: 'Error checking notification status' 
    });
  }
});

// Debug endpoint - see booking details for next week
router.get('/notifications/debug', async (req, res) => {
  try {
    const now = new Date();
    const currentDay = now.getDay();
    const diffToNextMonday = currentDay === 0 ? 1 : 8 - currentDay;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + diffToNextMonday);
    nextMonday.setHours(0, 0, 0, 0);

    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    nextSunday.setHours(23, 59, 59, 999);

    const { pool } = require('../config/database');
    
    // Get all bookings for this employee for next week
    const bookingsResult = await pool.query(`
      SELECT 
        sb.id as booking_id,
        sb.booking_status,
        s.start_time,
        s.end_time,
        s.store_location
      FROM shift_bookings sb
      JOIN shifts s ON s.id = sb.shift_id
      WHERE sb.employee_id = $1
        AND s.start_time >= $2
        AND s.start_time <= $3
      ORDER BY s.start_time
    `, [req.user.userId, nextMonday, nextSunday]);

    // Count by status
    const statusCount = {
      pending: 0,
      confirmed: 0,
      cancelled: 0,
      rejected: 0
    };
    
    bookingsResult.rows.forEach(b => {
      statusCount[b.booking_status] = (statusCount[b.booking_status] || 0) + 1;
    });

    res.json({
      currentDay: currentDay,
      currentDayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDay],
      inBookingWindow: currentDay >= 3 && currentDay <= 6,
      nextWeekRange: {
        monday: nextMonday.toDateString(),
        sunday: nextSunday.toDateString()
      },
      totalBookings: bookingsResult.rows.length,
      statusCount,
      activeBookings: statusCount.pending + statusCount.confirmed,
      shouldRemind: (statusCount.pending + statusCount.confirmed) === 0,
      bookings: bookingsResult.rows.map(b => ({
        booking_id: b.booking_id,
        status: b.booking_status,
        shift: `${new Date(b.start_time).toLocaleString()} - ${new Date(b.end_time).toLocaleTimeString()}`,
        location: b.store_location
      }))
    });
  } catch (error) {
    console.error('[Employee] notifications/debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
