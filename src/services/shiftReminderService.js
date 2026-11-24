const { pool } = require('../config/database');
const { sendPushNotification } = require('./webPushService');

/**
 * Shift Reminder Service
 * Pushes "your shift starts in 3 hours" to employees with an approved shift.
 * Runs every few minutes; each booking is reminded once (reminder_sent_at).
 */

const REMINDER_LEAD_MINUTES = 180;

function formatTime(date) {
  return date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ');
}

/** "in 3 hours", "in 1 hour", "in 40 minutes" */
function startsIn(minutes) {
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `in ${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  return `in ${Math.max(1, Math.round(minutes))} minutes`;
}

/**
 * Send reminders for approved shifts starting within the next 3 hours that
 * haven't been reminded yet. A shift that is approved or assigned less than
 * 3 hours before it starts still gets one reminder, with the actual time left.
 * @returns {Promise<{ reminded: number, delivered: number }>}
 */
async function sendUpcomingShiftReminders() {
  const now = new Date();
  const until = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60 * 1000);

  // Claim the bookings first so a slow or overlapping run can't remind twice
  const claimed = await pool.query(
    `UPDATE shift_bookings sb
     SET reminder_sent_at = CURRENT_TIMESTAMP
     FROM shifts s
     WHERE s.id = sb.shift_id
       AND sb.booking_status = 'confirmed'
       AND sb.reminder_sent_at IS NULL
       AND s.start_time > $1 AND s.start_time <= $2
     RETURNING sb.id, sb.employee_id, s.start_time, s.end_time, s.store_id, s.store_location`,
    [now, until]
  );
  if (claimed.rows.length === 0) return { reminded: 0, delivered: 0 };

  const storeIds = [...new Set(claimed.rows.map(r => r.store_id).filter(Boolean))];
  const stores = storeIds.length
    ? await pool.query(`SELECT id, name FROM stores WHERE id = ANY($1)`, [storeIds])
    : { rows: [] };
  const storeName = Object.fromEntries(stores.rows.map(s => [s.id, s.name]));

  let delivered = 0;
  for (const booking of claimed.rows) {
    const start = new Date(booking.start_time);
    const end = new Date(booking.end_time);
    const minutesLeft = (start - now) / 60000;
    const where = storeName[booking.store_id] || booking.store_location || 'the store';
    try {
      const result = await sendPushNotification(booking.employee_id, {
        title: `Shift ${startsIn(minutesLeft)}`,
        message: `Your shift at ${where} starts at ${formatTime(start)} (${formatTime(start)}–${formatTime(end)}).`,
        data: { url: '/employee/my-shifts' }
      });
      if (result.sent > 0) delivered++;
    } catch (error) {
      // Leave it marked as sent: a retry every few minutes could spam the employee
      console.error('[ShiftReminder] Failed to notify', booking.employee_id, error.message);
    }
  }

  console.log(`[ShiftReminder] ${claimed.rows.length} shift(s) reminded, ${delivered} delivered to a device`);
  return { reminded: claimed.rows.length, delivered };
}

module.exports = { sendUpcomingShiftReminders, REMINDER_LEAD_MINUTES };
