const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');
const { getChecklist, markItemChecked, getChecklistHistory } = require('../services/inventoryService');

const router = express.Router();
router.use(requireAuth, roleGuard('warehouse_manager'));

router.get('/dashboard', (req, res) => {
  res.render('warehouse/dashboard', { user: req.user });
});

router.get('/checklist', async (req, res) => {
  const date = req.query.date ? new Date(req.query.date) : new Date();
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
