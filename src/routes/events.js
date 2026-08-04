const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { pool } = require('../config/database');
const {
  addClient,
  removeClient,
  clientCount,
  eventsSince
} = require('../services/realtimeService');

const router = express.Router();

/**
 * Resolve which store a user belongs to, so events can be scoped to it.
 * Head-office roles (warehouse, payroll, operations) return null and
 * therefore receive events from every store.
 */
async function resolveStoreId(userId, role) {
  try {
    if (role === 'store_manager') {
      const r = await pool.query(
        `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1 LIMIT 1`,
        [userId]
      );
      return r.rows[0] ? r.rows[0].store_id : null;
    }
    if (role === 'employee') {
      const r = await pool.query(
        `SELECT store_id FROM store_employee_assignments WHERE employee_id = $1 LIMIT 1`,
        [userId]
      );
      return r.rows[0] ? r.rows[0].store_id : null;
    }
    return null;
  } catch (e) {
    console.error('[Events] store lookup failed', e);
    return null;
  }
}

/**
 * GET /events — Server-Sent Events stream.
 *
 * The browser keeps this open and receives small "something changed" nudges.
 * Auth is enforced the same way as any other route, so a user only ever gets
 * events for their own role and store.
 */
router.get('/events', requireAuth, async (req, res) => {
  const storeId = await resolveStoreId(req.user.userId, req.user.userRole);

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // Tell nginx not to buffer this response.
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  // iOS Safari / WebKit buffers roughly 2KB of a streaming response before it
  // begins dispatching events. Sending a block of comment padding up front
  // primes its parser so the first real event arrives immediately rather than
  // being held back until enough data accumulates.
  res.write(':' + ' '.repeat(2048) + '\n\n');

  // Tell the browser how long to wait before retrying a dropped connection.
  res.write('retry: 3000\n\n');

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

/**
 * GET /events/since?after=<timestamp> — polling fallback.
 *
 * Used by browsers where the stream isn't reliable (notably iOS Safari, which
 * suspends long-lived connections aggressively). Returns any events the caller
 * is entitled to see that are newer than the supplied timestamp.
 */
router.get('/events/since', requireAuth, async (req, res) => {
  const storeId = await resolveStoreId(req.user.userId, req.user.userRole);

  const events = eventsSince(req.query.after, {
    userId: req.user.userId,
    role: req.user.userRole,
    storeId
  });

  res.set('Cache-Control', 'no-store');
  res.json({ now: Date.now(), events });
});

/** Small health endpoint — useful when checking the stream is wired up. */
router.get('/events/health', requireAuth, (req, res) => {
  res.json({ connections: clientCount() });
});

module.exports = router;
