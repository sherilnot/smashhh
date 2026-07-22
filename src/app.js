require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employee');
const managerRoutes = require('./routes/manager');
const warehouseRoutes = require('./routes/warehouse');
const receivingManagerRoutes = require('./routes/receiving-manager');
const operationManagerRoutes = require('./routes/operation-manager');

const { scheduleNightlyJob } = require('./services/schedulerService');
const { generateNightlyChecklists } = require('./services/inventoryService');
const { sendShiftBookingReminders } = require('./services/webPushService');
const { autoCompleteShifts } = require('./services/shiftService');
const { requireAuth } = require('./middleware/auth');

const app = express();

// Security headers (Req 17.4)
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; manifest-src 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Global date formatter available in all EJS templates
app.locals.formatDate = function(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
app.locals.formatDateTime = function(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
app.locals.formatDateShort = function(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
};

// Routes
app.use('/', authRoutes);
app.use('/employee', employeeRoutes);
app.use('/manager', managerRoutes);
app.use('/warehouse', warehouseRoutes);
app.use('/receiving-manager', receivingManagerRoutes);
app.use('/operation-manager', operationManagerRoutes);

// Root redirect based on session role
app.get('/', requireAuth, (req, res) => {
  const role = req.user.userRole;
  if (role === 'employee') return res.redirect('/employee/dashboard');
  if (role === 'store_manager') return res.redirect('/manager/dashboard');
  if (role === 'warehouse_manager') return res.redirect('/warehouse/dashboard');
  if (role === 'receiving_manager') return res.redirect('/receiving-manager/dashboard');
  if (role === 'operation_manager') return res.redirect('/operation-manager/dashboard');
  res.redirect('/login');
});

// 404
app.use((req, res) => {
  res.status(404).send('404 Not Found');
});

// Global error handler (Req 16.5)
app.use((err, req, res, next) => {
  console.error('[App] Unhandled error', { error: err.message, stack: err.stack, timestamp: new Date().toISOString() });
  res.status(500).send('An unexpected error occurred. Please try again.');
});

// Start nightly scheduler at 10 PM (Req 9.1)
scheduleNightlyJob('generate-inventory-checklists', '0 22 * * *', generateNightlyChecklists);

// Send shift booking reminders during booking window (Wed-Sun)
// Runs at 9 AM, 2 PM, and 6 PM on Wednesday through Sunday
scheduleNightlyJob('send-shift-reminders-morning', '0 9 * * 3-0', sendShiftBookingReminders);
scheduleNightlyJob('send-shift-reminders-afternoon', '0 14 * * 3-0', sendShiftBookingReminders);
scheduleNightlyJob('send-shift-reminders-evening', '0 18 * * 3-0', sendShiftBookingReminders);

// Auto-complete shifts whose end time has passed, every 15 minutes. This is
// purely a safety net — managers can still manually end a shift early via
// the End Shift button at any time; this job only catches whatever hasn't
// already been ended by the time it runs, so a forgotten shift still counts
// toward wages/timesheets instead of sitting as 'confirmed' forever.
scheduleNightlyJob('auto-complete-shifts', '*/15 * * * *', async () => {
  const { completed } = await autoCompleteShifts();
  if (completed > 0) {
    console.log(`[Scheduler] auto-complete-shifts: completed ${completed} booking(s)`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[App] Server running on http://localhost:${PORT}`);
});

module.exports = app;
