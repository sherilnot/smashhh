const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getSubmittedChecklists, getChecklistDetail, markReviewed } = require('../services/storeChecklistService');

const router = express.Router();
router.use(requireAuth, roleGuard('warehouse_manager'));

router.get('/dashboard', async (req, res) => {
  try {
    const { checklists, total, byStore } = await getSubmittedChecklists(1, 50);
    res.render('warehouse/dashboard', { user: req.user, checklists, total, byStore });
  } catch (e) {
    console.error('[Warehouse] dashboard error', e);
    res.render('warehouse/dashboard', { user: req.user, checklists: [], total: 0, byStore: {} });
  }
});

// View all submitted store checklists
router.get('/store-checklists', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { checklists, total, byStore } = await getSubmittedChecklists(page, 50);
    const totalPages = Math.ceil(total / 50);
    res.render('warehouse/store-checklists', { user: req.user, checklists, total, page, totalPages, byStore });
  } catch (e) {
    console.error('[Warehouse] store-checklists error', e);
    res.render('warehouse/store-checklists', { user: req.user, checklists: [], total: 0, page: 1, totalPages: 0, byStore: {} });
  }
});

// View a specific submitted store checklist
router.get('/store-checklists/:id', async (req, res) => {
  try {
    const result = await getChecklistDetail(req.params.id);
    if (!result.success) {
      return res.status(404).render('warehouse/store-checklist-detail', {
        user: req.user, checklist: null, error: result.error
      });
    }
    res.render('warehouse/store-checklist-detail', {
      user: req.user, checklist: result.checklist, error: null
    });
  } catch (e) {
    console.error('[Warehouse] store-checklist detail error', e);
    res.status(500).render('warehouse/store-checklist-detail', {
      user: req.user, checklist: null, error: 'Failed to load checklist'
    });
  }
});

// Mark a checklist as reviewed
router.post('/store-checklists/:id/review', async (req, res) => {
  try {
    await markReviewed(req.params.id, req.user.userId);
    res.redirect(`/warehouse/store-checklists/${req.params.id}`);
  } catch (e) {
    console.error('[Warehouse] review error', e);
    res.redirect('/warehouse/store-checklists');
  }
});

module.exports = router;
