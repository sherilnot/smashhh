const webPush = require('web-push');
const { pool } = require('../config/database');
const { logNotificationSent } = require('./notificationTrackerService');

/**
 * Web Push Notification Service
 * Sends push notifications using Web Push API (works even when browser is closed)
 */

// Configure web-push with VAPID keys
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (vapidPublicKey && vapidPrivateKey) {
  webPush.setVapidDetails(
    vapidSubject,
    vapidPublicKey,
    vapidPrivateKey
  );
  console.log('[WebPush] VAPID keys configured successfully');
} else {
  console.warn('[WebPush] VAPID keys not configured. Push notifications will not work.');
}

/**
 * Get VAPID public key for client-side subscription
 * @returns {string}
 */
function getVapidPublicKey() {
  return vapidPublicKey;
}

/**
 * Save a web push subscription for an employee
 * @param {string} employeeId - The user UUID
 * @param {object} subscription - Web Push subscription object from browser
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function saveWebPushSubscription(employeeId, subscription) {
  try {
    // Ensure the web_push_subscriptions table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS web_push_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, endpoint)
      )
    `);

    // Extract keys from subscription
    const endpoint = subscription.endpoint;
    const p256dh = subscription.keys.p256dh;
    const auth = subscription.keys.auth;

    await pool.query(
      `INSERT INTO web_push_subscriptions (employee_id, endpoint, p256dh, auth, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (employee_id, endpoint) 
       DO UPDATE SET p256dh = $3, auth = $4, updated_at = CURRENT_TIMESTAMP`,
      [employeeId, endpoint, p256dh, auth]
    );

    console.log(`[WebPush] Subscription saved for employee ${employeeId}`);
    return { success: true };
  } catch (error) {
    console.error('[WebPush] saveWebPushSubscription error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove a web push subscription
 * @param {string} employeeId - The user UUID
 * @param {string} endpoint - The subscription endpoint
 * @returns {Promise<{ success: boolean }>}
 */
async function removeWebPushSubscription(employeeId, endpoint) {
  try {
    await pool.query(
      `DELETE FROM web_push_subscriptions 
       WHERE employee_id = $1 AND endpoint = $2`,
      [employeeId, endpoint]
    );
    console.log(`[WebPush] Subscription removed for employee ${employeeId}`);
    return { success: true };
  } catch (error) {
    console.error('[WebPush] removeWebPushSubscription error:', error);
    return { success: false };
  }
}

/**
 * Get all subscriptions for an employee
 * @param {string} employeeId - The user UUID
 * @returns {Promise<Array>}
 */
async function getEmployeeSubscriptions(employeeId) {
  try {
    const result = await pool.query(
      `SELECT endpoint, p256dh, auth FROM web_push_subscriptions WHERE employee_id = $1`,
      [employeeId]
    );
    
    return result.rows.map(row => ({
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth
      }
    }));
  } catch (error) {
    console.error('[WebPush] getEmployeeSubscriptions error:', error);
    return [];
  }
}

/**
 * Send a push notification to an employee
 * @param {string} employeeId - The user UUID
 * @param {object} payload - Notification payload { title, message, data }
 * @returns {Promise<{ success: boolean, sent: number, failed: number }>}
 */
async function sendPushNotification(employeeId, payload) {
  try {
    const subscriptions = await getEmployeeSubscriptions(employeeId);
    
    if (subscriptions.length === 0) {
      console.log(`[WebPush] No subscriptions found for employee ${employeeId}`);
      return { success: false, sent: 0, failed: 0, error: 'No subscriptions' };
    }

    const notificationPayload = JSON.stringify({
      title: payload.title || 'Book Your Shifts',
      message: payload.message || payload.body || 'Don\'t forget to book your shifts!',
      data: payload.data || { url: '/employee/shifts' }
    });

    let sent = 0;
    let failed = 0;

    // Send to all subscriptions for this employee
    const sendPromises = subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(subscription, notificationPayload);
        console.log(`[WebPush] Notification sent to ${employeeId} via ${subscription.endpoint.substring(0, 50)}...`);
        sent++;
      } catch (error) {
        console.error(`[WebPush] Failed to send to ${subscription.endpoint}:`, error.message);
        
        // If subscription is expired/invalid (410 Gone), remove it
        if (error.statusCode === 410 || error.statusCode === 404) {
          console.log(`[WebPush] Removing expired subscription for ${employeeId}`);
          await removeWebPushSubscription(employeeId, subscription.endpoint);
        }
        failed++;
      }
    });

    await Promise.all(sendPromises);

    // Log the notification
    if (sent > 0) {
      await logNotificationSent(
        employeeId,
        'shift_booking_reminder',
        payload.message || payload.body || 'Book your shifts reminder',
        'webpush'
      );
    }

    return { success: sent > 0, sent, failed };
  } catch (error) {
    console.error('[WebPush] sendPushNotification error:', error);
    return { success: false, sent: 0, failed: 0, error: error.message };
  }
}

/**
 * Send push notifications to multiple employees
 * @param {Array<{employeeId: string, payload: object}>} notifications
 * @returns {Promise<{ totalSent: number, totalFailed: number, results: Array }>}
 */
async function sendBulkPushNotifications(notifications) {
  let totalSent = 0;
  let totalFailed = 0;
  const results = [];

  for (const { employeeId, payload } of notifications) {
    const result = await sendPushNotification(employeeId, payload);
    totalSent += result.sent;
    totalFailed += result.failed;
    results.push({ employeeId, ...result });
  }

  console.log(`[WebPush] Bulk send complete: ${totalSent} sent, ${totalFailed} failed`);
  return { totalSent, totalFailed, results };
}

/**
 * Send reminder notifications to all employees who need them
 * @returns {Promise<{ success: boolean, sent: number, failed: number }>}
 */
async function sendShiftBookingReminders() {
  try {
    const { getEmployeesNeedingReminder } = require('./notificationTrackerService');
    const employees = await getEmployeesNeedingReminder();

    if (employees.length === 0) {
      console.log('[WebPush] No employees need reminders at this time');
      return { success: true, sent: 0, failed: 0 };
    }

    console.log(`[WebPush] Sending reminders to ${employees.length} employees`);

    const now = new Date();
    const currentDay = now.getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const urgency = currentDay === 6 ? 'high' : 'normal';

    const notifications = employees.map(emp => ({
      employeeId: emp.id,
      payload: {
        title: '🍔 Book Your Shifts',
        message: `It's ${dayNames[currentDay]}! Don't forget to book your shifts for next week before Saturday ends.`,
        data: {
          url: '/employee/shifts',
          urgency,
          timestamp: now.toISOString()
        }
      }
    }));

    const result = await sendBulkPushNotifications(notifications);
    
    return {
      success: result.totalSent > 0,
      sent: result.totalSent,
      failed: result.totalFailed,
      employeesNotified: employees.length
    };
  } catch (error) {
    console.error('[WebPush] sendShiftBookingReminders error:', error);
    return { success: false, sent: 0, failed: 0, error: error.message };
  }
}

module.exports = {
  getVapidPublicKey,
  saveWebPushSubscription,
  removeWebPushSubscription,
  getEmployeeSubscriptions,
  sendPushNotification,
  sendBulkPushNotifications,
  sendShiftBookingReminders
};
