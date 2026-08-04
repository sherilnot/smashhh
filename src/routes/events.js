const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { pool } = require('../config/database');
const { addClient, removeClient, clientCount } = require('../services/realtimeService');

const router = express.Router();

/**
 * GET /events — Server-Sent Events stream.
 *
 * The browser keeps this open and receives small "something changed" nudges.
 * Auth is enforced the same way as any other route, so a user only ever gets
 * events for their own role and store.
 */
router.get('/events', requireAuth, async (req, res) => {
  // Resolve the user's store so we can scope events to it.
  let storeId = null;
  try {
    const role = req.user.userRole;
    if (role === 'store_manager') {
      const r = await pool.query(
        `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
        [req.user.userId]
      );
      storeId = r.rows[0] ? r.rows[0].store_id : null;
    } else if (role === 'employee') {
      const r = await pool.query(
        `SELECT store_id FROM store_employee_assignments WHERE employee_id = $1 LIMIT 1`,
        [req.user.userId]
      );
      storeId = r.rows[0] ? r.rows[0].store_id : null;
    }
    // Head-office roles (warehouse, payroll, operations) stay unscoped
    // so they receive events from every store.
  } catch (e) {
    console.error('[Events] store lookup failed', e);
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // Tell nginx not to buffer this response.
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  // Greet the client so it knows the stream is live.
  res.write('event: ready\n');
  res.write(`data: ${JSON.stringify({ ok: true })}\n\n`);

  const clientId = addClient({
    res,
    userId: req.user.userId,
    role: req.user.userRole,
    storeId
  });

  req.on('close', () => {
    removeClient(clientId);
  });
});

/** Small health endpoint — useful when checking the stream is wired up. */
router.get('/events/health', requireAuth, (req, res) => {
  res.json({ connections: clientCount() });
});

module.exports = router;
