const express = require('express');
const { requireAuth, roleGuard } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, roleGuard('operation_manager'));

// Placeholder dashboard — functionality to be added later.
router.get('/dashboard', (req, res) => {
  res.render('operation-manager/dashboard', { user: req.user });
});

module.exports = router;
