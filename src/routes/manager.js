const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getPendingRequests, confirmBooking, rejectBooking } = require('../services/confirmationService');
const { endShift } = require('../services/shiftService');
const { pool } = require('../config/database');
const { getRosterWeek, validateRosterRequest, isWithinNavigationBounds, getRoster } = require('../services/rosterService');
const { generateTimesheet, submitTimesheet, confirmTimesheet } = require('../services/timesheetService');
const { getOrCreateTodayChecklist, submitChecklist: submitStoreChecklist } = require('../services/storeChecklistService');
const { getNotificationStats, getEmployeesNeedingReminder, getRecentNotificationLogs, getDeliveryRate } = require('../services/notificationTrackerService');
const { getOrCreateTodayInvoice, submitInvoice: submitReceivedInvoice, addInvoiceItem } = require('../services/receivedInvoiceService');
const { createCashSubmission, getManagerCashSubmissions } = require('../services/cashSubmissionService');
const { createManagementReport, getManagerReports } = require('../services/managementReportService');

// Multer config for cash photo uploads.
//
// Security: uploads are stored OUTSIDE public/ (so they're never served by
// express.static() to unauthenticated requests) and are only ever exposed
// through the authenticated /manager/cash/photo/:filename and
// /operation-manager/cash/photo/:filename routes below. The saved filename
// always uses a fixed, server-generated extension chosen from an allowlist
// based on the file's actual signature — never the client-supplied
// originalname or mimetype, both of which are trivially spoofable and were
// previously used to let arbitrary file types (proved: a raw .php webshell)
// get stored and served as static files.
const CASH_UPLOAD_DIR = path.join(__dirname, '../../uploads/cash');
fs.mkdirSync(CASH_UPLOAD_DIR, { recursive: true });

// Minimal magic-byte signatures for the image formats we accept. Checking
// actual file content (rather than trusting the client-supplied Content-Type
// header) prevents disguising a non-image file as an image upload.
const IMAGE_SIGNATURES = [
  { ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: '.gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: '.webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, webp: true } // RIFF....WEBP
];

function detectImageExtension(buffer) {
  for (const sig of IMAGE_SIGNATURES) {
    if (buffer.length < sig.bytes.length) continue;
    const matches = sig.bytes.every((b, i) => buffer[i] === b);
    if (matches) {
      if (sig.webp) {
        // WEBP: bytes 0-3 are 'RIFF', bytes 8-11 must be 'WEBP'.
        const isWebp = buffer.length >= 12 &&
          buffer.slice(8, 12).toString('ascii') === 'WEBP';
        if (isWebp) return '.webp';
        continue;
      }
      return sig.ext;
    }
  }
  return null;
}

// Use memory storage first so we can inspect the actual file bytes before
// deciding whether/how to persist it to disk.
const cashUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    // Cheap first-pass filter on the client-claimed type; the authoritative
    // check happens after upload via detectImageExtension() on the real
    // bytes, since this header is attacker-controlled.
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

/**
 * Persist multer's in-memory files to disk after verifying their real
 * content is actually an image, using a safe server-generated filename.
 * Files that fail content verification are silently dropped rather than
 * saved — the caller should treat req.files as this filtered/rewritten set.
 *
 * @param {Array} files - req.files from multer memoryStorage
 * @returns {Array<{ filename, originalname, mimetype, size }>}
 */
function persistVerifiedCashPhotos(files) {
  const saved = [];
  for (const file of files || []) {
    const ext = detectImageExtension(file.buffer);
    if (!ext) continue; // not a real image — drop it
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const filename = 'cash-' + uniqueSuffix + ext;
    fs.writeFileSync(path.join(CASH_UPLOAD_DIR, filename), file.buffer);
    saved.push({
      filename,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
  }
  return saved;
}

// Same idea as CASH_UPLOAD_DIR/persistVerifiedCashPhotos above, but for
// management report photos. Kept as a separate directory/prefix so report
// images and cash images never collide or get mixed up, even though the
// underlying validation (real image content check, safe generated filename)
// is identical.
const REPORT_UPLOAD_DIR = path.join(__dirname, '../../uploads/reports');
fs.mkdirSync(REPORT_UPLOAD_DIR, { recursive: true });

const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

function persistVerifiedReportPhotos(files) {
  const saved = [];
  for (const file of files || []) {
    const ext = detectImageExtension(file.buffer);
    if (!ext) continue; // not a real image — drop it
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const filename = 'report-' + uniqueSuffix + ext;
    fs.writeFileSync(path.join(REPORT_UPLOAD_DIR, filename), file.buffer);
    saved.push({
      filename,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
  }
  return saved;
}

const router = express.Router();
router.use(requireAuth, roleGuard('store_manager'));

// Fixed shift types - used by both roster and timesheet
const SHIFT_TYPES = [
  { label: '11:00 – 5:30', startH: 11, startM: 0, endH: 17, endM: 30, color: '#C8E6C9' },  // soft green
  { label: '5:30 – 9:00', startH: 17, startM: 30, endH: 21, endM: 0, color: '#FFF59D' },   // soft yellow
  { label: '11:00 – 9:00', startH: 11, startM: 0, endH: 21, endM: 0, color: '#B3E5FC' }    // soft blue
];

// Manager dashboard: active (confirmed, started) bookings
router.get('/dashboard', async (req, res) => {
  try {
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
      activeBookings: activeRes.rows
    });
  } catch (e) {
    console.error('[Manager] dashboard error', e);
    res.render('manager/dashboard', {
      user: req.user,
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
        shiftTypes: [], dayLabels: [], dayDates: [], rosterRows: [],
        query: req.query, employees: [],
        weekStartFormatted: toLocalDateString(weekStart),
        weekEndFormatted: toLocalDateString(weekEnd),
        prevWeekDate: toLocalDateString(prevMonday),
        nextWeekDate: toLocalDateString(nextMon),
        canGoPrev: bounds.canGoPrev, canGoNext: bounds.canGoNext
      });
    }
    const storeId = storeRes.rows[0].store_id;

    // Get all confirmed bookings for the week (or include cancelled if in edit mode)
    const bookingsRes = await pool.query(
      `SELECT
         sb.id AS booking_id, sb.employee_id, sb.actual_clock_in, sb.booking_status,
         u.first_name, u.last_name,
         s.id AS shift_id, s.start_time, s.end_time
       FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN users u ON u.id = sb.employee_id
       WHERE s.store_id = $1
         AND sb.booking_status IN ('confirmed', 'cancelled')
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
            booking_status: b.booking_status,
            actual_clock_in: b.actual_clock_in ? new Date(b.actual_clock_in).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : null
          };
        });
      });

      return {
        employee_id: emp.id,
        name: emp.last_name ? (emp.first_name + ' ' + emp.last_name) : emp.first_name,
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
      user: req.user, error: req.query.error || null, hasManagedStore: true,
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
          `INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id)
           VALUES ($1, $2, $3, 5, $4)
           ON CONFLICT (store_id, start_time, end_time) WHERE store_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [startTime, endTime, location, storeId]
        );
        if (newShift.rows.length > 0) {
          targetShiftId = newShift.rows[0].id;
        } else {
          const winner = await pool.query(
            `SELECT id FROM shifts WHERE store_id = $1 AND start_time = $2 AND end_time = $3`,
            [storeId, startTime, endTime]
          );
          targetShiftId = winner.rows[0].id;
        }
      }
    }

    if (!targetShiftId) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
    }

    // Bug 8 fix: manager-assign was inserting a 'confirmed' booking directly,
    // bypassing the same capacity check bookShift() enforces for employee
    // self-bookings. This wraps the insert in a transaction that locks the
    // shift row and re-checks occupied capacity first, exactly like
    // bookShift()/applyDecision() already do, so a manager can never assign
    // more employees to a shift than its capacity allows.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM shifts WHERE id = $1 FOR UPDATE', [targetShiftId]);

      const capRes = await client.query(
        `SELECT capacity FROM shifts WHERE id = $1`,
        [targetShiftId]
      );
      const capacity = capRes.rows[0]?.capacity ?? 0;

      const dupRes = await client.query(
        `SELECT id FROM shift_bookings
         WHERE shift_id = $1 AND employee_id = $2 AND booking_status IN ('pending', 'confirmed')`,
        [targetShiftId, employeeId]
      );

      const countRes = await client.query(
        `SELECT COUNT(*) AS count FROM shift_bookings
         WHERE shift_id = $1 AND booking_status IN ('pending', 'confirmed')`,
        [targetShiftId]
      );
      const occupied = parseInt(countRes.rows[0].count);

      if (dupRes.rows.length === 0 && occupied < capacity) {
        await client.query(
          `INSERT INTO shift_bookings (shift_id, employee_id, booking_status, assigned_by)
           VALUES ($1, $2, 'confirmed', $3)
           ON CONFLICT DO NOTHING`,
          [targetShiftId, employeeId, req.user.userId]
        );
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

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
      `SELECT sb.id, sb.booking_status FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN store_manager_assignments sma ON sma.store_id = s.store_id
       WHERE sb.id = $1 AND sma.manager_id = $2`,
      [bookingId, req.user.userId]
    );
    if (verifyRes.rows.length === 0) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
    }

    const currentStatus = verifyRes.rows[0].booking_status;
    
    // Toggle: if cancelled, restore to confirmed; otherwise cancel it
    if (currentStatus === 'cancelled') {
      await pool.query(
        `UPDATE shift_bookings SET booking_status = 'confirmed', cancelled_at = NULL WHERE id = $1`,
        [bookingId]
      );
    } else {
      await pool.query(
        `UPDATE shift_bookings SET booking_status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
        [bookingId]
      );
    }
    
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

    // Bug 10 fix: validate end is after start before hitting the DB, so a bad
    // edit gets a clear error instead of silently failing the check_shift_times
    // constraint and leaving the manager thinking their change was saved.
    if (new Date(endTime) <= new Date(startTime)) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1&error=${encodeURIComponent('End time must be after start time')}`);
    }

    await pool.query(
      `UPDATE shifts SET start_time = $1, end_time = $2, updated_at = NOW() WHERE id = $3`,
      [startTime, endTime, shiftId]
    );

    res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
  } catch (e) {
    console.error('[Manager] roster/edit-shift error', e);
    res.redirect(`/manager/roster?date=${req.body.weekStart || ''}&edit=1&error=${encodeURIComponent('Failed to update shift times')}`);
  }
});

// Record actual clock-in time for an employee
router.post('/roster/clock-in', async (req, res) => {
  try {
    const { bookingId, clockIn, clockOut, weekStart } = req.body;

    // Verify booking belongs to manager's store, and fetch its current status
    // and existing clock times (needed to validate clockOut > clockIn when
    // only one of the two fields is being updated in this request).
    const verifyRes = await pool.query(
      `SELECT sb.id, sb.booking_status, sb.actual_clock_in, sb.actual_clock_out
       FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN store_manager_assignments sma ON sma.store_id = s.store_id
       WHERE sb.id = $1 AND sma.manager_id = $2`,
      [bookingId, req.user.userId]
    );
    if (verifyRes.rows.length === 0) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1`);
    }

    const booking = verifyRes.rows[0];

    // Bug 9 fix: clock times only make sense for bookings that were actually
    // approved to work (confirmed) or have already been completed. Blocking
    // pending/cancelled/rejected/no_show prevents recording hours for a shift
    // that was never approved.
    if (booking.booking_status !== 'confirmed' && booking.booking_status !== 'completed') {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1&error=${encodeURIComponent('Only confirmed or completed bookings can have clock times recorded')}`);
    }

    // Bug 2 fix: validate clock-out is after clock-in using whichever values
    // will be in effect after this update (new value if provided, otherwise
    // the existing stored value).
    const effectiveClockIn = clockIn || booking.actual_clock_in;
    const effectiveClockOut = clockOut || booking.actual_clock_out;
    if (effectiveClockIn && effectiveClockOut && new Date(effectiveClockOut) <= new Date(effectiveClockIn)) {
      return res.redirect(`/manager/roster?date=${weekStart || ''}&edit=1&error=${encodeURIComponent('Clock-out time must be after clock-in time')}`);
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
        isConfirmed: false, isSubmitted: false, canEdit: false,
        query: req.query,
        weekStartFormatted: '', weekEndFormatted: '',
        prevWeekDate: '', nextWeekDate: '',
        canGoPrev: false, canGoNext: false
      });
    }

    const { start: weekStart, end: weekEnd } = validation.week;
    const result = await generateTimesheet(req.user.userId, weekStart, weekEnd);
    const bounds = isWithinNavigationBounds(weekStart, new Date());
    
    // Allow submission/editing until confirmed
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isSunday = now.getDay() === 0;
    const weekEndDate = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
    const isFutureWeek = weekEndDate > today && !(isSunday && weekEndDate.getTime() === today.getTime());

    const isConfirmed = result.timesheet && result.timesheet.alreadySubmitted && 
                        result.timesheet.status === 'confirmed';
    const isSubmitted = result.timesheet && result.timesheet.alreadySubmitted;
    const canEdit = !isConfirmed && !isFutureWeek;

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
        isConfirmed, isSubmitted, canEdit,
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
          // Use actual clock times if available, otherwise use scheduled times
          const start = shift.actual_clock_in ? new Date(shift.actual_clock_in) : new Date(shift.shift_start);
          const end = shift.actual_clock_out ? new Date(shift.actual_clock_out) : new Date(shift.shift_end);
          const startLabel = start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
          const endLabel = end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

          // Determine shift type and color based on SCHEDULED times (for consistency)
          const scheduledStart = new Date(shift.shift_start);
          const scheduledEnd = new Date(shift.shift_end);
          let shiftType = 'custom';
          let color = '#F8BBD0'; // soft pink for custom
          let label = startLabel + '–' + endLabel;
          
          SHIFT_TYPES.forEach(st => {
            if (scheduledStart.getHours() === st.startH && scheduledStart.getMinutes() === st.startM &&
                scheduledEnd.getHours() === st.endH && scheduledEnd.getMinutes() === st.endM) {
              color = st.color;
            }
          });

          byDay[dayIdx] = {
            booking_id: shift.booking_id,
            startLabel,
            endLabel,
            label,
            color,
            hours_worked: shift.hours_worked,
            no_show: shift.no_show,
            adjusted: shift.adjusted,
            has_actual_times: !!(shift.actual_clock_in || shift.actual_clock_out)
          };

          if (dayIdx >= 5) {
            weekendHours += shift.hours_worked;
          } else {
            weekdayHours += shift.hours_worked;
          }
        }
      });

      return {
        name: emp.last_name ? (emp.first_name + ' ' + emp.last_name) : emp.first_name,
        employmentType: emp.employment_type || null,
        totalHours: emp.totalHours,
        weekdayHours: Math.round(weekdayHours * 100) / 100,
        weekendHours: Math.round(weekendHours * 100) / 100,
        byDay
      };
    });

    res.render('manager/timesheet', {
      user: req.user, error: null, success: false,
      hasStore: true, timesheet: result.timesheet, timesheetRows, dayLabels, dayDates, 
      isFutureWeek, isSubmitted, isConfirmed, canEdit,
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
      isConfirmed: false, isSubmitted: false, canEdit: false,
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
    const { bookingId, action, adjustedHours, startTime, endTime, weekStart } = req.body;

    // Verify the booking belongs to a shift in the manager's store
    const verifyRes = await pool.query(
      `SELECT sb.id, sb.booking_status, s.id as shift_id, s.start_time, s.end_time, s.store_id
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

    // Bug 19 fix: once a timesheet has been confirmed (locked, sent to the
    // receiving manager), the bookings feeding it must not change underneath
    // it — otherwise the confirmed totals and the underlying data silently
    // diverge. Find the Monday of the week containing this booking's shift
    // and check whether that week's timesheet is already confirmed.
    const shiftStart = new Date(booking.start_time);
    const shiftDay = shiftStart.getDay();
    const diffToMonday = shiftDay === 0 ? -6 : 1 - shiftDay;
    const weekMonday = new Date(shiftStart.getFullYear(), shiftStart.getMonth(), shiftStart.getDate() + diffToMonday);

    const tsStatusRes = await pool.query(
      `SELECT status FROM timesheets WHERE store_id = $1 AND week_start = $2`,
      [booking.store_id, weekMonday]
    );
    if (tsStatusRes.rows.length > 0 && tsStatusRes.rows[0].status === 'confirmed') {
      return res.redirect(`/manager/timesheet?date=${weekStart || ''}&error=${encodeURIComponent('This timesheet has been confirmed and can no longer be edited')}`);
    }

    if (action === 'adjust_times') {
      // Parse the new times
      if (!startTime || !endTime) {
        return res.redirect(`/manager/timesheet?date=${weekStart || ''}&edit=1&error=Invalid time values`);
      }
      
      // Get the original shift date
      const originalStart = new Date(booking.start_time);
      const shiftDate = new Date(originalStart.getFullYear(), originalStart.getMonth(), originalStart.getDate());
      
      // Parse time strings (HH:MM format)
      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);
      
      const actualClockIn = new Date(shiftDate);
      actualClockIn.setHours(startH, startM, 0, 0);
      
      const actualClockOut = new Date(shiftDate);
      actualClockOut.setHours(endH, endM, 0, 0);
      
      // Calculate hours
      const diffMs = actualClockOut - actualClockIn;
      const hours = diffMs / (1000 * 60 * 60);
      
      if (hours <= 0) {
        return res.redirect(`/manager/timesheet?date=${weekStart || ''}&edit=1&error=End time must be after start time`);
      }
      
      // Record actual clock-in/out times on this specific booking
      // This doesn't modify the shift itself, just records when THIS employee actually worked
      await pool.query(
        `UPDATE shift_bookings SET actual_clock_in = $1, actual_clock_out = $2, no_show = false WHERE id = $3`,
        [actualClockIn, actualClockOut, bookingId]
      );
    } else if (action === 'no_show') {
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

// AJAX endpoint for smooth timesheet edits
router.post('/timesheet/edit-ajax', async (req, res) => {
  try {
    const { bookingId, action, startTime, endTime } = req.body;

    // Verify the booking belongs to a shift in the manager's store
    const verifyRes = await pool.query(
      `SELECT sb.id, sb.booking_status, s.id as shift_id, s.start_time, s.end_time, s.store_id
       FROM shift_bookings sb
       JOIN shifts s ON s.id = sb.shift_id
       JOIN store_manager_assignments sma ON sma.store_id = s.store_id
       WHERE sb.id = $1 AND sma.manager_id = $2`,
      [bookingId, req.user.userId]
    );

    if (verifyRes.rows.length === 0) {
      return res.json({ success: false, error: 'Booking not found or not in your store' });
    }

    const booking = verifyRes.rows[0];

    // Bug 19 fix: same guard as /timesheet/edit — block changes once the
    // week's timesheet has been confirmed.
    const shiftStart = new Date(booking.start_time);
    const shiftDay = shiftStart.getDay();
    const diffToMonday = shiftDay === 0 ? -6 : 1 - shiftDay;
    const weekMonday = new Date(shiftStart.getFullYear(), shiftStart.getMonth(), shiftStart.getDate() + diffToMonday);

    const tsStatusRes = await pool.query(
      `SELECT status FROM timesheets WHERE store_id = $1 AND week_start = $2`,
      [booking.store_id, weekMonday]
    );
    if (tsStatusRes.rows.length > 0 && tsStatusRes.rows[0].status === 'confirmed') {
      return res.json({ success: false, error: 'This timesheet has been confirmed and can no longer be edited' });
    }

    if (action === 'adjust_times') {
      if (!startTime || !endTime) {
        return res.json({ success: false, error: 'Invalid time values' });
      }
      
      const originalStart = new Date(booking.start_time);
      const shiftDate = new Date(originalStart.getFullYear(), originalStart.getMonth(), originalStart.getDate());
      
      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);
      
      const actualClockIn = new Date(shiftDate);
      actualClockIn.setHours(startH, startM, 0, 0);
      
      const actualClockOut = new Date(shiftDate);
      actualClockOut.setHours(endH, endM, 0, 0);
      
      const diffMs = actualClockOut - actualClockIn;
      const hours = diffMs / (1000 * 60 * 60);
      
      if (hours <= 0) {
        return res.json({ success: false, error: 'End time must be after start time' });
      }
      
      await pool.query(
        `UPDATE shift_bookings SET actual_clock_in = $1, actual_clock_out = $2, no_show = false WHERE id = $3`,
        [actualClockIn, actualClockOut, bookingId]
      );
      
      return res.json({ success: true, newHours: Math.round(hours * 100) / 100 });
    } else if (action === 'delete_entry') {
      const checkRes = await pool.query(`SELECT no_show FROM shift_bookings WHERE id = $1`, [bookingId]);
      if (checkRes.rows.length > 0 && checkRes.rows[0].no_show) {
        await pool.query(`UPDATE shift_bookings SET no_show = false, adjusted_hours = NULL WHERE id = $1`, [bookingId]);
      } else {
        await pool.query(`UPDATE shift_bookings SET no_show = true, adjusted_hours = 0 WHERE id = $1`, [bookingId]);
      }
      return res.json({ success: true });
    }

    res.json({ success: false, error: 'Unknown action' });
  } catch (e) {
    console.error('[Manager] timesheet edit-ajax error', e);
    res.json({ success: false, error: 'Server error' });
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
      
      // Allow submission on Sunday for current week
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const isSunday = now.getDay() === 0;
      const weekEndDate = new Date(weDate.getFullYear(), weDate.getMonth(), weDate.getDate());
      const isFutureWeek = weekEndDate > today && !(isSunday && weekEndDate.getTime() === today.getTime());
      
      const tsResult = await generateTimesheet(req.user.userId, wsDate, weDate);

      // Bug 11 fix: this render path was missing canEdit/isConfirmed/isSubmitted,
      // which timesheet.ejs references unconditionally — crashing with a 500
      // ("canEdit is not defined") any time a submit attempt failed validation.
      // Computed the same way the GET route does, from the regenerated timesheet.
      const isConfirmedOnFailure = tsResult.timesheet && tsResult.timesheet.alreadySubmitted &&
                                    tsResult.timesheet.status === 'confirmed';
      const isSubmittedOnFailure = tsResult.timesheet && tsResult.timesheet.alreadySubmitted;
      const canEditOnFailure = !isConfirmedOnFailure && !isFutureWeek;

      const prevMonday = new Date(wsDate);
      prevMonday.setDate(prevMonday.getDate() - 7);
      const nextMonday = new Date(wsDate);
      nextMonday.setDate(nextMonday.getDate() + 7);

      return res.render('manager/timesheet', {
        user: req.user, error: result.error, success: false,
        hasStore: true, timesheet: tsResult.success ? tsResult.timesheet : null, 
        timesheetRows: [], dayLabels: [], dayDates: [], isFutureWeek, query: req.query,
        isConfirmed: isConfirmedOnFailure, isSubmitted: isSubmittedOnFailure, canEdit: canEditOnFailure,
        weekStartFormatted: weekStart,
        weekEndFormatted: weekEnd,
        prevWeekDate: toLocalDateString(prevMonday),
        nextWeekDate: toLocalDateString(nextMonday),
        canGoPrev: bounds.canGoPrev, canGoNext: bounds.canGoNext
      });
    }

    // Success — redirect back to timesheet view with success message
    res.redirect(`/manager/timesheet?date=${weekStart}&success=submitted`);
  } catch (e) {
    console.error('[Manager] timesheet submit error', e);
    res.redirect('/manager/timesheet');
  }
});

// Confirm and lock timesheet (final submission to receiving manager)
router.post('/timesheet/confirm', async (req, res) => {
  try {
    const { weekStart } = req.body;
    const [y, m, d] = weekStart.split('-').map(Number);
    const ws = new Date(y, m - 1, d);
    
    const result = await confirmTimesheet(req.user.userId, ws);
    if (result.success) {
      return res.redirect(`/manager/timesheet?date=${weekStart}&success=confirmed`);
    }
    return res.redirect(`/manager/timesheet?date=${weekStart}&error=${encodeURIComponent(result.error)}`);
  } catch (e) {
    console.error('[Manager] timesheet confirm error', e);
    return res.redirect(`/manager/timesheet?date=${req.body.weekStart || ''}&error=Failed to confirm timesheet`);
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

    // Determine which items were selected (checkbox fields named selected_<itemId>)
    const selectedItems = new Set();
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('selected_') && value === '1') {
        selectedItems.add(key.replace('selected_', ''));
      }
    }

    // Extract quantities only for selected items (fields named qty_<itemId>)
    const quantities = {};
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('qty_')) {
        const itemId = key.replace('qty_', '');
        if (selectedItems.has(itemId)) {
          quantities[itemId] = value;
        } else {
          // Unselected items get cleared (empty quantity)
          quantities[itemId] = '';
        }
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

// ─── Notification Monitor ──────────────────────────────────────────────────────

router.get('/notification-monitor', async (req, res) => {
  try {
    const stats = await getNotificationStats();
    const needingReminder = await getEmployeesNeedingReminder();
    const recentLogs = await getRecentNotificationLogs(50);
    const deliveryRate = await getDeliveryRate();

    res.render('manager/notification-monitor', {
      user: req.user,
      stats,
      needingReminder,
      recentLogs,
      deliveryRate
    });
  } catch (error) {
    console.error('[Manager] notification-monitor error:', error);
    res.render('manager/notification-monitor', {
      user: req.user,
      stats: [],
      needingReminder: [],
      recentLogs: [],
      deliveryRate: { total_sent: 0, total_viewed: 0, total_clicked: 0, view_rate: 0, click_rate: 0 }
    });
  }
});

// ─── Received Invoice (Shop Manager reports actual quantities received) ─────────

router.get('/received-invoice', async (req, res) => {
  try {
    const result = await getOrCreateTodayInvoice(req.user.userId);
    if (!result.success) {
      return res.render('manager/received-invoice', {
        user: req.user,
        error: result.error,
        invoice: null,
        checklistPending: result.checklistPending || false
      });
    }
    res.render('manager/received-invoice', {
      user: req.user,
      error: req.query.error || null,
      invoice: result.invoice,
      checklistPending: false
    });
  } catch (e) {
    console.error('[Manager] received-invoice error', e);
    res.render('manager/received-invoice', {
      user: req.user,
      error: 'Failed to load invoice',
      invoice: null,
      checklistPending: false
    });
  }
});

router.post('/received-invoice/add-item', async (req, res) => {
  try {
    const { invoiceId, productName } = req.body;

    if (!productName || !productName.trim()) {
      return res.redirect(`/manager/received-invoice?error=${encodeURIComponent('Product name is required')}`);
    }

    const result = await addInvoiceItem(req.user.userId, invoiceId, productName.trim());
    if (!result.success) {
      return res.redirect(`/manager/received-invoice?error=${encodeURIComponent(result.error)}`);
    }
    res.redirect('/manager/received-invoice');
  } catch (e) {
    console.error('[Manager] add invoice item error', e);
    res.redirect(`/manager/received-invoice?error=${encodeURIComponent('Failed to add item')}`);
  }
});

router.post('/received-invoice/submit', async (req, res) => {
  try {
    const { invoiceId, generalNotes } = req.body;
    
    // Determine which items were selected via checkboxes
    const selectedItems = new Set();
    for (const key in req.body) {
      if (key.startsWith('selected_') && req.body[key] === '1') {
        selectedItems.add(key.replace('selected_', ''));
      }
    }

    // Build items array only for selected items
    const items = [];
    for (const key in req.body) {
      if (key.startsWith('quantity_')) {
        const itemId = key.replace('quantity_', '');
        if (selectedItems.has(itemId)) {
          items.push({
            itemId,
            quantityReceived: req.body[`quantity_${itemId}`] || '',
            itemNotes: req.body[`notes_${itemId}`] || ''
          });
        } else {
          // Unselected items get quantity cleared (won't appear in invoice)
          items.push({
            itemId,
            quantityReceived: '0',
            itemNotes: 'NOT SELECTED'
          });
        }
      }
    }

    const result = await submitReceivedInvoice(req.user.userId, invoiceId, items, generalNotes);
    if (!result.success) {
      return res.redirect('/manager/received-invoice?error=' + encodeURIComponent(result.error));
    }
    res.redirect('/manager/received-invoice?success=1');
  } catch (e) {
    console.error('[Manager] submit invoice error', e);
    res.redirect('/manager/received-invoice');
  }
});

// Reopen a submitted invoice (reverts to draft and re-syncs from checklist)
router.post('/received-invoice/reopen', async (req, res) => {
  try {
    const { invoiceId } = req.body;

    // Verify invoice belongs to manager's store
    const checkRes = await pool.query(
      `SELECT ri.id, ri.status
       FROM received_invoices ri
       JOIN store_manager_assignments sma ON sma.store_id = ri.store_id
       WHERE ri.id = $1 AND sma.manager_id = $2`,
      [invoiceId, req.user.userId]
    );

    if (checkRes.rows.length === 0) {
      return res.redirect('/manager/received-invoice?error=' + encodeURIComponent('Invoice not found'));
    }

    // Revert status back to draft — the getOrCreateTodayInvoice will re-sync items from checklist
    await pool.query(
      `UPDATE received_invoices SET status = 'draft', submitted_at = NULL WHERE id = $1`,
      [invoiceId]
    );

    res.redirect('/manager/received-invoice');
  } catch (e) {
    console.error('[Manager] reopen invoice error', e);
    res.redirect('/manager/received-invoice?error=' + encodeURIComponent('Failed to reopen invoice'));
  }
});

// ─── Cash Submissions (Send cash photos to OM001) ───────────────────────────────

router.get('/cash', async (req, res) => {
  try {
    const result = await getManagerCashSubmissions(req.user.userId);
    res.render('manager/cash', {
      user: req.user,
      submissions: result.success ? result.submissions : [],
      error: result.success ? (req.query.error || null) : result.error,
      success: req.query.success === '1'
    });
  } catch (e) {
    console.error('[Manager] cash page error', e);
    res.render('manager/cash', {
      user: req.user,
      submissions: [],
      error: 'Failed to load page',
      success: false
    });
  }
});

router.post('/cash/submit', cashUpload.array('photos', 5), async (req, res) => {
  try {
    const { amount, notes } = req.body;
    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || parsedAmount < 0) {
      return res.redirect('/manager/cash?error=' + encodeURIComponent('Please enter a valid amount'));
    }

    if (!req.files || req.files.length === 0) {
      return res.redirect('/manager/cash?error=' + encodeURIComponent('Please upload at least one photo'));
    }

    // Verify each file's actual content is a real image before persisting
    // to disk; anything that fails the signature check (e.g. a non-image
    // file disguised with an image MIME type) is silently dropped.
    const verifiedFiles = persistVerifiedCashPhotos(req.files);
    if (verifiedFiles.length === 0) {
      return res.redirect('/manager/cash?error=' + encodeURIComponent('None of the uploaded files were valid images'));
    }

    const result = await createCashSubmission(req.user.userId, parsedAmount, notes, verifiedFiles);
    if (!result.success) {
      return res.redirect('/manager/cash?error=' + encodeURIComponent(result.error));
    }

    res.redirect('/manager/cash?success=1');
  } catch (e) {
    console.error('[Manager] cash submit error', e);
    res.redirect('/manager/cash?error=' + encodeURIComponent('Failed to submit'));
  }
});

// Serve a cash submission photo — requires auth and store-scoped access, so
// uploaded financial evidence is never reachable by an unauthenticated
// request the way it was when these files lived under public/uploads.
router.get('/cash/photo/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    // Guard against path traversal in the filename param itself.
    if (path.basename(filename) !== filename) {
      return res.status(400).send('Invalid filename');
    }

    const ownsRes = await pool.query(
      `SELECT 1 FROM cash_submission_images csi
       JOIN cash_submissions cs ON cs.id = csi.submission_id
       JOIN store_manager_assignments sma ON sma.store_id = cs.store_id
       WHERE csi.filename = $1 AND sma.manager_id = $2`,
      [filename, req.user.userId]
    );
    if (ownsRes.rows.length === 0) {
      return res.status(404).send('Not found');
    }

    res.sendFile(path.join(CASH_UPLOAD_DIR, filename));
  } catch (e) {
    console.error('[Manager] cash photo error', e);
    res.status(500).send('Failed to load photo');
  }
});

// ─── Management Reports (Send text + photos to OM001) ──────────────────────────

router.get('/reports', async (req, res) => {
  try {
    const result = await getManagerReports(req.user.userId);
    res.render('manager/reports', {
      user: req.user,
      reports: result.success ? result.reports : [],
      error: result.success ? (req.query.error || null) : result.error,
      success: req.query.success === '1'
    });
  } catch (e) {
    console.error('[Manager] reports page error', e);
    res.render('manager/reports', {
      user: req.user,
      reports: [],
      error: 'Failed to load page',
      success: false
    });
  }
});

router.post('/reports/submit', reportUpload.array('photos', 5), async (req, res) => {
  try {
    const { reportText } = req.body;

    if (!reportText || !reportText.trim()) {
      return res.redirect('/manager/reports?error=' + encodeURIComponent('Please enter a report'));
    }

    // Verify each file's actual content is a real image before persisting
    // to disk; anything that fails the signature check (e.g. a non-image
    // file disguised with an image MIME type) is silently dropped.
    const verifiedFiles = req.files && req.files.length > 0 ? persistVerifiedReportPhotos(req.files) : [];
    if (req.files && req.files.length > 0 && verifiedFiles.length === 0) {
      return res.redirect('/manager/reports?error=' + encodeURIComponent('None of the uploaded files were valid images'));
    }

    const result = await createManagementReport(req.user.userId, reportText.trim(), verifiedFiles);
    if (!result.success) {
      return res.redirect('/manager/reports?error=' + encodeURIComponent(result.error));
    }

    res.redirect('/manager/reports?success=1');
  } catch (e) {
    console.error('[Manager] reports submit error', e);
    res.redirect('/manager/reports?error=' + encodeURIComponent('Failed to submit'));
  }
});

// Serve a management report photo — requires auth and store-scoped access,
// so uploaded report evidence is never reachable by an unauthenticated
// request.
router.get('/reports/photo/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    // Guard against path traversal in the filename param itself.
    if (path.basename(filename) !== filename) {
      return res.status(400).send('Invalid filename');
    }

    const ownsRes = await pool.query(
      `SELECT 1 FROM management_report_images mri
       JOIN management_reports mr ON mr.id = mri.report_id
       JOIN store_manager_assignments sma ON sma.store_id = mr.store_id
       WHERE mri.filename = $1 AND sma.manager_id = $2`,
      [filename, req.user.userId]
    );
    if (ownsRes.rows.length === 0) {
      return res.status(404).send('Not found');
    }

    res.sendFile(path.join(REPORT_UPLOAD_DIR, filename));
  } catch (e) {
    console.error('[Manager] report photo error', e);
    res.status(500).send('Failed to load photo');
  }
});

module.exports = router;

