/**
 * Dev-only helper: creates a week of past shifts for Store A, books them with
 * emp001/emp002/emp003, confirms the bookings as mgr001, and ends (completes)
 * them — so the manager dashboard's Roster and Timesheet pages have real data
 * to display.
 *
 * Run with: node scripts/simulate-shift-history.js
 */
require('dotenv').config();
const { pool } = require('../src/config/database');
const { bookShift, endShift } = require('../src/services/shiftService');
const { confirmBooking } = require('../src/services/confirmationService');

async function main() {
  const client = await pool.connect();
  try {
    // Look up store + manager + employees
    const storeRes = await client.query(`SELECT id FROM stores WHERE name = 'Store A'`);
    const storeId = storeRes.rows[0].id;

    const mgrRes = await client.query(`SELECT id FROM users WHERE user_id = 'mgr001'`);
    const managerId = mgrRes.rows[0].id;

    const empRes = await client.query(
      `SELECT id, user_id FROM users WHERE user_id IN ('emp001','emp002','emp003') ORDER BY user_id`
    );
    const employees = empRes.rows;

    // Create 5 past weekday shifts (last week, Mon-Fri, 9am-5pm) directly —
    // bypassing bookShift's "must be future" rule is not needed here since we
    // insert the shift rows ourselves, then use the real service functions
    // for booking/confirming/completing.
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7); // Monday of last week
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
      console.log(`Created shift ${start.toISOString().split('T')[0]} 09:00-17:00`);
    }

    // For each shift, book all 3 employees, confirm, then end (complete).
    for (const shiftId of shiftIds) {
      for (const emp of employees) {
        // Insert booking directly as 'pending' (mirrors bookShift's insert,
        // since bookShift itself rejects past-dated shifts).
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

        const endResult = await endShift(managerId, bookingId);
        if (!endResult.success) {
          console.error(`  End-shift failed for ${emp.user_id}:`, endResult.error);
          continue;
        }
        console.log(`  ${emp.user_id}: booked -> confirmed -> completed`);
      }
    }

    console.log('\nDone. Store A now has a full week of completed shifts for emp001-003.');
    console.log('Log in as mgr001 / 123 and check Roster, Timesheet, and Wages.');
  } catch (err) {
    console.error('Simulation failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
