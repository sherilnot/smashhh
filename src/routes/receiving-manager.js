const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getSubmittedTimesheets, getTimesheetDetail } = require('../services/timesheetService');

const router = express.Router();
router.use(requireAuth, roleGuard('receiving_manager'));

// Dashboard — redirect to timesheets list
router.get('/dashboard', (req, res) => {
  res.redirect('/receiving-manager/timesheets');
});

// List submitted timesheets (paginated)
router.get('/timesheets', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const { timesheets, total } = await getSubmittedTimesheets(page, limit);
    const totalPages = Math.ceil(total / limit);

    res.render('receiving-manager/timesheets', {
      user: req.user,
      timesheets,
      page,
      totalPages,
      total,
      error: null
    });
  } catch (e) {
    console.error('[ReceivingManager] timesheets list error', e);
    res.render('receiving-manager/timesheets', {
      user: req.user,
      timesheets: [],
      page: 1,
      totalPages: 0,
      total: 0,
      error: 'Failed to load timesheets'
    });
  }
});

// View timesheet detail
router.get('/timesheets/:id', async (req, res) => {
  try {
    const result = await getTimesheetDetail(req.params.id);

    if (!result.success) {
      return res.status(404).render('receiving-manager/timesheet-detail', {
        user: req.user,
        timesheet: null,
        error: result.error
      });
    }

    res.render('receiving-manager/timesheet-detail', {
      user: req.user,
      timesheet: result.timesheet,
      error: null
    });
  } catch (e) {
    console.error('[ReceivingManager] timesheet detail error', e);
    res.status(500).render('receiving-manager/timesheet-detail', {
      user: req.user,
      timesheet: null,
      error: 'Failed to load timesheet details'
    });
  }
});

module.exports = router;
