require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employee');
const managerRoutes = require('./routes/manager');
const warehouseRoutes = require('./routes/warehouse');

const { scheduleNightlyJob } = require('./services/schedulerService');
const { generateNightlyChecklists } = require('./services/inventoryService');
const { requireAuth } = require('./middleware/auth');

const app = express();

// Security headers (Req 17.4)
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
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

// Routes
app.use('/', authRoutes);
app.use('/employee', employeeRoutes);
app.use('/manager', managerRoutes);
app.use('/warehouse', warehouseRoutes);

// Root redirect based on session role
app.get('/', requireAuth, (req, res) => {
  const role = req.user.userRole;
  if (role === 'employee') return res.redirect('/employee/dashboard');
  if (role === 'store_manager') return res.redirect('/manager/dashboard');
  if (role === 'warehouse_manager') return res.redirect('/warehouse/dashboard');
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[App] Server running on http://localhost:${PORT}`);
});

module.exports = app;
