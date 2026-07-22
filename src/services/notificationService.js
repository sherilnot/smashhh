const { pool } = require('../config/database');
const { logNotificationSent } = require('./notificationTrackerService');

/**
 * Notification Service
 * Handles browser notification subscriptions and sending push notifications
 */

/**
 * Store a push subscription for an employee
 * @param {string} employeeId - The user UUID
 * @param {object} subscription - Push subscription object from browser
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function savePushSubscription(employeeId, subscription) {
  try {
    // Ensure the push_subscriptions table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subscription_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, subscription_data)
      )
    `);

    await pool.query(
      `INSERT INTO push_subscriptions (employee_id, subscription_data, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (employee_id, subscription_data) 
       DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
      [employeeId, JSON.stringify(subscription)]
    );

    return { success: true };
  } catch (error) {
    console.error('[NotificationService] savePushSubscription error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove a push subscription for an employee
 * @param {string} employeeId - The user UUID
 * @param {object} subscription - Push subscription object to remove
 * @returns {Promise<{ success: boolean }>}
 */
async function removePushSubscription(employeeId, subscription) {
  try {
    await pool.query(
      `DELETE FROM push_subscriptions 
       WHERE employee_id = $1 AND subscription_data = $2`,
      [employeeId, JSON.stringify(subscription)]
    );
    return { success: true };
  } catch (error) {
    console.error('[NotificationService] removePushSubscription error:', error);
    return { success: false };
  }
}

/**
 * Get all active subscriptions for employees who should be reminded
 * @returns {Promise<Array>}
 */
async function getActiveSubscriptions() {
  try {
    const result = await pool.query(`
      SELECT ps.employee_id, ps.subscription_data, u.first_name, u.last_name
      FROM push_subscriptions ps
      JOIN users u ON u.id = ps.employee_id
      WHERE u.role = 'employee'
      ORDER BY ps.created_at DESC
    `);
    return result.rows;
  } catch (error) {
    console.error('[NotificationService] getActiveSubscriptions error:', error);
    return [];
  }
}

/**
 * Check if employee needs to be reminded about shift booking
 * @param {string} employeeId - The user UUID
 * @returns {Promise<{ needsReminder: boolean, message: string }>}
 */
async function checkShiftBookingReminder(employeeId) {
  try {
    const now = new Date();
    const currentDay = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    
    // Only remind Wed-Sun (3-6, 0)
    if (currentDay >= 1 && currentDay <= 2) {
      return { needsReminder: false, message: 'Outside notification window' };
    }

    // Calculate next week Monday-Sunday
    const diffToNextMonday = currentDay === 0 ? 1 : 8 - currentDay;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + diffToNextMonday);
    nextMonday.setHours(0, 0, 0, 0);

    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    nextSunday.setHours(23, 59, 59, 999);

    // Check if employee has any bookings for next week (pending or confirmed only)
    const result = await pool.query(`
      SELECT COUNT(*) as booking_count
      FROM shift_bookings sb
      JOIN shifts s ON s.id = sb.shift_id
      WHERE sb.employee_id = $1
        AND s.start_time >= $2
        AND s.start_time <= $3
        AND sb.booking_status IN ('pending', 'confirmed')
    `, [employeeId, nextMonday, nextSunday]);

    const bookingCount = parseInt(result.rows[0].booking_count);
    
    console.log(`[NotificationService] Employee ${employeeId}: ${bookingCount} bookings for next week (${nextMonday.toDateString()} - ${nextSunday.toDateString()})`);
    
    if (bookingCount === 0) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return {
        needsReminder: true,
        message: `🍔 Shift Reminder: It's ${dayNames[currentDay]}! Don't forget to book your shifts for next week before Saturday ends.`,
        title: 'Book Your Shifts',
        urgency: currentDay === 6 ? 'high' : 'normal' // More urgent on Saturday
      };
    }

    return { needsReminder: false, message: 'Already has bookings for next week' };
  } catch (error) {
    console.error('[NotificationService] checkShiftBookingReminder error:', error);
    return { needsReminder: false, message: 'Error checking reminder' };
  }
}

/**
 * Get notification data for an employee (to be sent to client)
 * @param {string} employeeId - The user UUID
 * @returns {Promise<object>}
 */
async function getNotificationData(employeeId) {
  const reminder = await checkShiftBookingReminder(employeeId);
  
  // Log notification if one should be sent
  if (reminder.needsReminder) {
    await logNotificationSent(
      employeeId,
      'shift_booking_reminder',
      reminder.message,
      'browser'
    );
  }
  
  return {
    ...reminder,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  savePushSubscription,
  removePushSubscription,
  getActiveSubscriptions,
  checkShiftBookingReminder,
  getNotificationData
};
