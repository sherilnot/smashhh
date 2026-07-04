const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getChecklist, markItemChecked, getChecklistHistory } = require('../services/inventoryService');
const { getSubmittedChecklists, getChecklistDetail, markReviewed } = require('../services/storeChecklistService');

const router = express.Router();
router.use(requireAuth, roleGuard('warehouse_manager'));

router.get('/dashboard', async (req, res) => {
  try {
    const { checklists, total } = await getSubmittedChecklists(1, 10);
    res.render('warehouse/dashboard', { user: req.user, checklists, total });
  } catch (e) {
    console.error('[Warehouse] dashboard error', e);
    res.render('warehouse/dashboard', { user: req.user, checklists: [], total: 0 });
  }
});

// View all submitted store checklists
router.get('/store-checklists', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { checklists, total } = await getSubmittedChecklists(page, 50);
    const totalPages = Math.ceil(total / 50);
    res.render('warehouse/store-checklists', { user: req.user, checklists, total, page, totalPages });
  } catch (e) {
    console.error('[Warehouse] store-checklists error', e);
    res.render('warehouse/store-checklists', { user: req.user, checklists: [], total: 0, page: 1, totalPages: 0 });
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

router.get('/checklist', async (req, res) => {
  let date;
  if (req.query.date) {
    const [y, m, d] = String(req.query.date).split('-').map(Number);
    date = new Date(y, (m || 1) - 1, d || 1);
  } else {
    date = new Date();
  }
  date.setHours(0, 0, 0, 0);
  try {
    const checklist = await getChecklist(req.user.userId, date);
    if (!checklist) {
      return res.render('warehouse/no-checklist', { date });
    }
    res.render('warehouse/checklist', { checklist, error: null, date });
  } catch (e) {
    console.error('[Warehouse] checklist error', e);
    res.render('warehouse/no-checklist', { date });
  }
});

router.post('/check-item', async (req, res) => {
  const { checklistId, itemId, actualQuantity } = req.body;
  const qty = parseInt(actualQuantity);

  // Fetch expected quantity to determine status
  const { pool } = require('../config/database');
  const itemRes = await pool.query(
    'SELECT expected_quantity FROM checklist_items WHERE id = $1 AND checklist_id = $2',
    [itemId, checklistId]
  );
  if (!itemRes.rows.length) return res.status(400).json({ error: 'Item not found' });

  const expected = itemRes.rows[0].expected_quantity;
  let status;
  if (qty === 0) status = 'missing';
  else if (qty >= expected) status = 'arrived';
  else status = 'partial';

  const success = await markItemChecked(checklistId, itemId, qty, status);
  if (success) return res.json({ success: true, status });
  return res.status(400).json({ error: 'Failed to update item' });
});

router.get('/history', async (req, res) => {
  const end = new Date();
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  try {
    const history = await getChecklistHistory(req.user.userId, start, end);
    res.render('warehouse/history', { history, error: null });
  } catch (e) {
    res.render('warehouse/history', { history: [], error: 'Failed to load history' });
  }
});

module.exports = router;
