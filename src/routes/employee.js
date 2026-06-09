const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getAvailableShifts, bookShift, cancelShift, getEmployeeShifts } = require('../services/shiftService');

const router = express.Router();

router.use(requireAuth, roleGuard('employee'));

// Dashboard
router.get('/dashboard', (req, res) => {
  res.render('employee/dashboard', { user: req.user });
});

// Available shifts (next 7 days by default)
router.get('/shifts', async (req, res) => {
  const start = req.query.start ? new Date(req.query.start) : new Date();
  const end = req.query.end ? new Date(req.query.end) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try {
    const shifts = await getAvailableShifts(start, end);
    res.render('employee/shifts', { shifts, error: null });
  } catch (e) {
    res.render('employee/shifts', { shifts: [], error: 'Failed to load shifts' });
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
    const shifts = await getAvailableShifts(new Date(), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
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
