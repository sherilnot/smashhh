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

// clientId -> { res, userId, role, storeId }
const clients = new Map();
let nextClientId = 1;

/** Heartbeat keeps proxies from closing idle connections. */
const HEARTBEAT_MS = 25000;

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
  const payload = { topic, at: Date.now(), ...(data ? { data } : {}) };

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

module.exports = {
  addClient,
  removeClient,
  clientCount,
  broadcast
};
