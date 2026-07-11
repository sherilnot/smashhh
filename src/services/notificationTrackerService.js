const { pool } = require('../config/database');

/**
 * Notification Tracker Service
 * Tracks when notifications are sent and viewed by employees
 */

/**
 * Log when a notification is sent to an employee
 * @param {string} employeeId - The user UUID
 * @param {string} notificationType - Type of notification (e.g., 'shift_booking_reminder')
 * @param {string} message - The notification message
 * @param {string} channel - How it was sent ('browser', 'email', 'sms')
 * @returns {Promise<{ success: boolean, logId?: string }>}
 */
async function logNotificationSent(employeeId, notificationType, message, channel = 'browser') {
  try {
    // Ensure the notification_logs table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_type VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        channel VARCHAR(50) NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        viewed_at TIMESTAMP NULL,
        clicked BOOLEAN DEFAULT FALSE,
        metadata JSONB
      )
    `);

    const result = await pool.query(
      `INSERT INTO notification_logs (employee_id, notification_type, message, channel)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [employeeId, notificationType, message, channel]
    );

    return { success: true, logId: result.rows[0].id };
  } catch (error) {
    console.error('[NotificationTracker] logNotificationSent error:', error);
    return { success: false };
  }
}

/**
 * Mark a notification as viewed
 * @param {string} logId - The notification log UUID
 * @returns {Promise<{ success: boolean }>}
 */
async function markNotificationViewed(logId) {
  try {
    await pool.query(
      `UPDATE notification_logs 
       SET viewed_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND viewed_at IS NULL`,
      [logId]
    );
    return { success: true };
  } catch (error) {
    console.error('[NotificationTracker] markNotificationViewed error:', error);
    return { success: false };
  }
}

/**
 * Mark a notification as clicked
 * @param {string} logId - The notification log UUID
 * @returns {Promise<{ success: boolean }>}
 */
async function markNotificationClicked(logId) {
  try {
    await pool.query(
      `UPDATE notification_logs 
       SET clicked = TRUE 
       WHERE id = $1`,
      [logId]
    );
    return { success: true };
  } catch (error) {
    console.error('[NotificationTracker] markNotificationClicked error:', error);
    return { success: false };
  }
}

/**
 * Get notification statistics for all employees
 * @param {Date} startDate - Start date for the report
 * @param {Date} endDate - End date for the report
 * @returns {Promise<Array>}
 */
async function getNotificationStats(startDate = null, endDate = null) {
  try {
    let query = `
      SELECT 
        u.id as employee_id,
        u.first_name,
        u.last_name,
        u.email,
        COUNT(nl.id) as total_sent,
        COUNT(nl.viewed_at) as total_viewed,
        COUNT(CASE WHEN nl.clicked = TRUE THEN 1 END) as total_clicked,
        MAX(nl.sent_at) as last_sent_at,
        ARRAY_AGG(DISTINCT nl.notification_type) as notification_types
      FROM users u
      LEFT JOIN notification_logs nl ON nl.employee_id = u.id
      WHERE u.role = 'employee'
    `;

    const params = [];
    if (startDate && endDate) {
      query += ` AND nl.sent_at BETWEEN $1 AND $2`;
      params.push(startDate, endDate);
    }

    query += `
      GROUP BY u.id, u.first_name, u.last_name, u.email
      ORDER BY u.last_name, u.first_name
    `;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('[NotificationTracker] getNotificationStats error:', error);
    return [];
  }
}

/**
 * Get employees who need to be notified (no bookings for next week during Wed-Sat)
 * @returns {Promise<Array>}
 */
async function getEmployeesNeedingReminder() {
  try {
    const now = new Date();
    const currentDay = now.getDay();
    
    // Only during Wed-Sat
    if (currentDay < 3 || currentDay > 6) {
      return [];
    }

    // Calculate next week Monday-Sunday
    const diffToNextMonday = currentDay === 0 ? 1 : 8 - currentDay;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + diffToNextMonday);
    nextMonday.setHours(0, 0, 0, 0);

    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    nextSunday.setHours(23, 59, 59, 999);

    // Find employees with no bookings for next week
    const result = await pool.query(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        COALESCE(booking_count.count, 0) as bookings_next_week,
        last_notif.last_sent_at
      FROM users u
      LEFT JOIN (
        SELECT sb.employee_id, COUNT(*) as count
        FROM shift_bookings sb
        JOIN shifts s ON s.id = sb.shift_id
        WHERE s.start_time >= $1 AND s.start_time <= $2
        GROUP BY sb.employee_id
      ) booking_count ON booking_count.employee_id = u.id
      LEFT JOIN (
        SELECT employee_id, MAX(sent_at) as last_sent_at
        FROM notification_logs
        WHERE notification_type = 'shift_booking_reminder'
          AND sent_at >= CURRENT_DATE
        GROUP BY employee_id
      ) last_notif ON last_notif.employee_id = u.id
      WHERE u.role = 'employee'
        AND COALESCE(booking_count.count, 0) = 0
        AND (last_notif.last_sent_at IS NULL 
             OR last_notif.last_sent_at < NOW() - INTERVAL '2 hours')
      ORDER BY u.last_name, u.first_name
    `, [nextMonday, nextSunday]);

    return result.rows;
  } catch (error) {
    console.error('[NotificationTracker] getEmployeesNeedingReminder error:', error);
    return [];
  }
}

/**
 * Get recent notification logs for monitoring
 * @param {number} limit - Number of recent logs to fetch
 * @returns {Promise<Array>}
 */
async function getRecentNotificationLogs(limit = 50) {
  try {
    const result = await pool.query(`
      SELECT 
        nl.id,
        nl.notification_type,
        nl.message,
        nl.channel,
        nl.sent_at,
        nl.viewed_at,
        nl.clicked,
        u.first_name,
        u.last_name,
        u.email
      FROM notification_logs nl
      JOIN users u ON u.id = nl.employee_id
      ORDER BY nl.sent_at DESC
      LIMIT $1
    `, [limit]);

    return result.rows;
  } catch (error) {
    console.error('[NotificationTracker] getRecentNotificationLogs error:', error);
    return [];
  }
}

/**
 * Get notification delivery rate
 * @returns {Promise<object>}
 */
async function getDeliveryRate() {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_sent,
        COUNT(viewed_at) as total_viewed,
        COUNT(CASE WHEN clicked = TRUE THEN 1 END) as total_clicked,
        ROUND(COUNT(viewed_at)::numeric / NULLIF(COUNT(*), 0) * 100, 2) as view_rate,
        ROUND(COUNT(CASE WHEN clicked = TRUE THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 2) as click_rate
      FROM notification_logs
      WHERE sent_at >= CURRENT_DATE - INTERVAL '7 days'
    `);

    return result.rows[0] || {
      total_sent: 0,
      total_viewed: 0,
      total_clicked: 0,
      view_rate: 0,
      click_rate: 0
    };
  } catch (error) {
    console.error('[NotificationTracker] getDeliveryRate error:', error);
    return null;
  }
}

module.exports = {
  logNotificationSent,
  markNotificationViewed,
  markNotificationClicked,
  getNotificationStats,
  getEmployeesNeedingReminder,
  getRecentNotificationLogs,
  getDeliveryRate
};
