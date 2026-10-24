/**
 * Realtime Service — Server-Sent Events (SSE) hub.
 *
 * Keeps a registry of connected browsers and pushes small "something changed"
 * messages to the ones that care. Clients then refresh only the affected part
 * of their page — no full reload.
 *
 * Design notes:
 *  - One-way (server -> browser). That's all this app needs.
 *  - Messages are intentionally tiny: a topic name plus optional context.
 *    We never push sensitive data down the stream; the client re-fetches
 *    through the normal authenticated routes.
 *  - Delivery is best-effort. If a browser is offline it simply misses the
 *    nudge and will see fresh data on its next page load.
 */

const { pool } = require('../config/database');

// clientId -> { res, userId, role, storeId }
const clients = new Map();
let nextClientId = 1;

/** Heartbeat keeps proxies from closing idle connections. */
const HEARTBEAT_MS = 25000;

/**
 * Short history of recent events, so clients on the polling fallback (iOS
 * Safari, or anything behind a proxy that kills long connections) can ask
 * "what happened since timestamp X?" and not miss anything.
 *
 * Kept deliberately small and in-memory — this is a catch-up buffer, not a
 * durable queue. Anything older than the window is assumed to have been
 * picked up by a normal page load.
 */
const HISTORY_LIMIT = 100;
const HISTORY_TTL_MS = 5 * 60 * 1000;
const history = []; // { topic, at, roles, storeId, data }

function recordHistory(entry) {
  history.push(entry);
  const cutoff = Date.now() - HISTORY_TTL_MS;
  while (history.length && (history.length > HISTORY_LIMIT || history[0].at < cutoff)) {
    history.shift();
  }
}

/**
 * Events a given viewer is allowed to see, newer than `after`.
 * Mirrors the same role/store filtering used for live delivery.
 */
function eventsSince(after, viewer) {
  const since = Number(after) || 0;
  return history
    .filter((e) => e.at > since)
    .filter((e) => !e.roles || e.roles.includes(viewer.role))
    .filter((e) => !(e.storeId && viewer.storeId && e.storeId !== viewer.storeId))
    .filter((e) => !(e.exceptUserId && e.exceptUserId === viewer.userId))
    .map((e) => ({ topic: e.topic, at: e.at, ...(e.data ? { data: e.data } : {}) }));
}

/**
 * Register a new SSE connection.
 * @param {object} opts
 * @param {import('express').Response} opts.res
 * @param {string} opts.userId
 * @param {string} opts.role
 * @param {string|null} opts.storeId
 * @returns {number} clientId
 */
function addClient({ res, userId, role, storeId }) {
  const id = nextClientId++;
  clients.set(id, { res, userId, role, storeId: storeId || null });
  return id;
}

/** Remove a connection (on disconnect). */
function removeClient(id) {
  clients.delete(id);
}

/** Number of live connections — handy for a health check. */
function clientCount() {
  return clients.size;
}

/** Write one SSE frame. Returns false if the socket is gone. */
function write(client, event, payload) {
  try {
    client.res.write(`event: ${event}\n`);
    client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Push an event to every client matching the filter.
 *
 * @param {string} topic - e.g. 'checklist:submitted'
 * @param {object} [options]
 * @param {string[]} [options.roles] - Only these roles. Omit for all roles.
 * @param {string} [options.storeId] - Only clients bound to this store.
 *        Clients with no storeId (head-office roles) always receive it.
 * @param {string} [options.exceptUserId] - Skip the user who triggered it.
 * @param {object} [options.data] - Small context payload.
 */
function broadcast(topic, options = {}) {
  const { roles, storeId, exceptUserId, data } = options;
  const at = Date.now();
  const payload = { topic, at, ...(data ? { data } : {}) };

  // Keep a copy so polling clients can catch up.
  recordHistory({ topic, at, roles, storeId, exceptUserId, data });

  const dead = [];

  for (const [id, client] of clients) {
    if (roles && !roles.includes(client.role)) continue;
    if (exceptUserId && client.userId === exceptUserId) continue;

    // Store scoping: a client tied to a store only hears about that store.
    // Head-office roles (no storeId) hear everything for their role.
    if (storeId && client.storeId && client.storeId !== storeId) continue;

    if (!write(client, 'update', payload)) dead.push(id);
  }

  dead.forEach(removeClient);
}

/** Send a comment line to all clients so idle connections stay open. */
function heartbeat() {
  const dead = [];
  for (const [id, client] of clients) {
    try {
      client.res.write(': ping\n\n');
    } catch (e) {
      dead.push(id);
    }
  }
  dead.forEach(removeClient);
}

setInterval(heartbeat, HEARTBEAT_MS).unref();

/**
 * The store a user belongs to: the one they manage, or the one they work at.
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
    console.error('[Realtime] store lookup failed', e);
    return null;
  }
}

/**
 * Broadcast to `roles` in the acting user's store (every store when the actor
 * is head office), skipping the actor, whose own page reloads anyway.
 * Fire-and-forget: never delays or fails the request that triggered it.
 */
function broadcastFromUser(topic, user, roles, message) {
  if (!user) return;
  resolveStoreId(user.userId, user.userRole)
    .then((storeId) => broadcast(topic, {
      roles,
      storeId,
      exceptUserId: user.userId,
      data: message ? { message } : undefined
    }))
    .catch((e) => console.error('[Realtime] broadcast failed', e));
}

/**
 * Route middleware: once the handler succeeds, tell other people's open pages
 * that listen for `topic` to refresh. Success means a redirect without
 * ?error=, or a JSON reply below 400 that isn't { success: false } / { error }.
 *
 *   router.post('/cancel', notifyOnSuccess('shifts:changed', ['store_manager']), handler)
 */
function notifyOnSuccess(topic, roles, message) {
  return (req, res, next) => {
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      broadcastFromUser(topic, req.user, roles, message);
    };

    const redirect = res.redirect.bind(res);
    res.redirect = (...args) => {
      if (!/[?&]error=/.test(String(args[args.length - 1]))) send();
      return redirect(...args);
    };

    const json = res.json.bind(res);
    res.json = (body) => {
      const failed = res.statusCode >= 400 || (body && (body.success === false || body.error));
      if (!failed) send();
      return json(body);
    };

    next();
  };
}

module.exports = {
  addClient,
  removeClient,
  clientCount,
  broadcast,
  broadcastFromUser,
  notifyOnSuccess,
  resolveStoreId,
  eventsSince
};
