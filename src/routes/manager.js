const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { calculateAllWages, updateHourlyRate } = require('../services/wageService');
const { pool } = require('../config/database');

const router = express.Router();
router.use(requireAuth, roleGuard('store_manager'));

router.get('/dashboard', (req, res) => {
  res.render('manager/dashboard', { user: req.user });
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

module.exports = router;
