/**
 * Dev-only helper: creates this week's shifts for Store A, books and confirms
 * them (but does NOT end/complete them) — so the manager's Roster page has
 * upcoming confirmed shifts to display alongside the completed history from
 * simulate-shift-history.js.
 *
 * Run with: node scripts/simulate-upcoming-roster.js
 */
require('dotenv').config();
const { pool } = require('../src/config/database');
const { confirmBooking } = require('../src/services/confirmationService');

async function main() {
  const client = await pool.connect();
  try {
    const storeRes = await client.query(`SELECT id FROM stores WHERE name = 'Store A'`);
    const storeId = storeRes.rows[0].id;

    const mgrRes = await client.query(`SELECT id FROM users WHERE user_id = 'mgr001'`);
    const managerId = mgrRes.rows[0].id;

    const empRes = await client.query(
      `SELECT id, user_id FROM users WHERE user_id IN ('emp001','emp002','emp003') ORDER BY user_id`
    );
    const employees = empRes.rows;

    // This week's Monday
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const shiftIds = [];
    for (let d = 0; d < 5; d++) {
      const start = new Date(monday);
      start.setDate(monday.getDate() + d);
      start.setHours(9, 0, 0, 0);
      const end = new Date(start);
      end.setHours(17, 0, 0, 0);

      const res = await client.query(
        `INSERT INTO shifts (start_time, end_time, store_location, store_id, capacity)
         VALUES ($1, $2, 'Store A', $3, 3) RETURNING id`,
        [start, end, storeId]
      );
      shiftIds.push(res.rows[0].id);
      console.log(`Created upcoming shift ${start.toISOString().split('T')[0]} 09:00-17:00`);
    }

    for (const shiftId of shiftIds) {
      for (const emp of employees) {
        const bookingRes = await client.query(
          `INSERT INTO shift_bookings (shift_id, employee_id, booking_status)
           VALUES ($1, $2, 'pending') RETURNING id`,
          [shiftId, emp.id]
        );
        const bookingId = bookingRes.rows[0].id;

        const confirmResult = await confirmBooking(managerId, 'store_manager', bookingId);
        if (!confirmResult.success) {
          console.error(`  Confirm failed for ${emp.user_id}:`, confirmResult.error);
          continue;
        }
        console.log(`  ${emp.user_id}: booked -> confirmed (left as-is for roster)`);
      }
    }

    console.log('\nDone. Store A now has a full current week of CONFIRMED shifts for emp001-003.');
    console.log('Log in as mgr001 / 123 and check Roster.');
  } catch (err) {
    console.error('Simulation failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
