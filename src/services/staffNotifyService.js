const { pool } = require('../config/database');
const { sendPushNotification } = require('./webPushService');

/**
 * Staff Notify Service
 * Phone/browser push notifications for managers and head office when
 * something happens in a store (availability sent, cash report, maintenance...).
 * Only people who turned notifications on are contacted. Fire-and-forget:
 * a failure here never affects the action that triggered it.
 */

/** Where tapping the notification takes each role, unless a call says otherwise. */
const HOME_BY_ROLE = {
  employee: '/employee/dashboard',
  store_manager: '/manager/dashboard',
  warehouse_manager: '/warehouse/dashboard',
  receiving_manager: '/receiving-manager/timesheets',
  operation_manager: '/operation-manager/dashboard'
};

/**
 * Users with one of `roles` who have a phone or browser registered for push.
 * Store managers only for `storeId` (when given); head-office roles always.
 */
async function recipients(roles, storeId, exceptUserId) {
  const res = await pool.query(
    `SELECT u.id, u.role
     FROM users u
     WHERE u.role = ANY($1)
       AND ($3::uuid IS NULL OR u.id <> $3::uuid)
       AND (u.role <> 'store_manager' OR $2::uuid IS NULL OR EXISTS (
             SELECT 1 FROM store_manager_assignments sma WHERE sma.manager_id = u.id AND sma.store_id = $2::uuid))
       AND (EXISTS (SELECT 1 FROM native_push_tokens t WHERE t.employee_id = u.id)
            OR EXISTS (SELECT 1 FROM web_push_subscriptions w WHERE w.employee_id = u.id))`,
    [roles, storeId || null, exceptUserId || null]
  );
  return res.rows;
}

/**
 * Send one notification to the matching staff.
 * @param {object} opts
 * @param {string[]} opts.roles - e.g. ['store_manager'] or ['receiving_manager', 'operation_manager']
 * @param {string} [opts.storeId] - limits store managers to this store
 * @param {string} [opts.exceptUserId] - usually the person who did the action
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {object} [opts.urlByRole] - page to open per role, e.g. { operation_manager: '/operation-manager/cash' }
 */
async function notifyStaff({ roles, storeId, exceptUserId, title, message, urlByRole = {} }) {
  try {
    const people = await recipients(roles, storeId, exceptUserId);
    for (const person of people) {
      const url = urlByRole[person.role] || HOME_BY_ROLE[person.role] || '/';
      await sendPushNotification(person.id, { title, message, data: { url } })
        .catch(e => console.error('[StaffNotify] send failed', person.id, e.message));
    }
    if (people.length) console.log(`[StaffNotify] "${title}" -> ${people.length} recipient(s)`);
  } catch (error) {
    console.error('[StaffNotify] notify failed', error.message);
  }
}

/** Name and store of the person who did something, for notification text. */
async function actorInfo(userId) {
  const res = await pool.query(
    `SELECT u.first_name, u.last_name, u.role,
            COALESCE(ms.id, es.id) AS store_id, COALESCE(ms.name, es.name) AS store_name
     FROM users u
     LEFT JOIN store_manager_assignments sma ON sma.manager_id = u.id
     LEFT JOIN stores ms ON ms.id = sma.store_id
     LEFT JOIN store_employee_assignments sea ON sea.employee_id = u.id
     LEFT JOIN stores es ON es.id = sea.store_id
     WHERE u.id = $1 LIMIT 1`,
    [userId]
  );
  const r = res.rows[0] || {};
  return {
    name: r.last_name && r.role !== 'store_manager' ? `${r.first_name} ${r.last_name}` : (r.first_name || 'Someone'),
    storeId: r.store_id || null,
    storeName: r.store_name || 'a store'
  };
}

/**
 * Notify staff about something `userId` just did in their store.
 * `title` and `message` may be strings or functions of { name, storeName }.
 */
function notifyFromUser(userId, { roles, title, message, urlByRole, storeScoped = true }) {
  actorInfo(userId)
    .then(actor => notifyStaff({
      roles,
      storeId: storeScoped ? actor.storeId : null,
      exceptUserId: userId,
      title: typeof title === 'function' ? title(actor) : title,
      message: typeof message === 'function' ? message(actor) : message,
      urlByRole
    }))
    .catch(e => console.error('[StaffNotify] notifyFromUser failed', e.message));
}

module.exports = { notifyStaff, notifyFromUser, HOME_BY_ROLE };
