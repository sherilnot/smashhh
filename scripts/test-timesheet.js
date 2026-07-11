require('dotenv').config();
const { pool } = require('../src/config/database');

/**
 * Create test data for timesheet testing
 * - Creates shifts for last week
 * - Books employees to those shifts
 * - Marks them as completed
 * - Manager can then edit actual times
 */

async function createTestTimesheetData() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get Store A manager and employees
    const storeRes = await client.query(
      `SELECT id, name FROM stores WHERE name = 'Store A' LIMIT 1`
    );
    if (storeRes.rows.length === 0) {
      console.log('[Test] Store A not found. Run seed-data.js first.');
      await client.query('ROLLBACK');
      return;
    }
    const storeId = storeRes.rows[0].id;
    const storeName = storeRes.rows[0].name;

    const employeesRes = await client.query(
      `SELECT u.id, u.user_id, u.first_name, u.last_name
       FROM users u
       JOIN store_employee_assignments sea ON sea.employee_id = u.id
       WHERE sea.store_id = $1 AND u.role = 'employee'
       ORDER BY u.user_id
       LIMIT 3`,
      [storeId]
    );

    if (employeesRes.rows.length === 0) {
      console.log('[Test] No employees found for Store A.');
      await client.query('ROLLBACK');
      return;
    }

    const employees = employeesRes.rows;
    console.log(`[Test] Found ${employees.length} employees for Store A`);

    // Calculate last week (Monday to Sunday)
    const now = new Date();
    const day = now.getDay();
    const diffToLastMonday = day === 0 ? -13 : -6 - day;
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() + diffToLastMonday);
    lastMonday.setHours(0, 0, 0, 0);

    console.log(`[Test] Creating shifts for week starting: ${lastMonday.toISOString().split('T')[0]}`);

    // Create shifts for last week (Mon, Wed, Fri)
    const shifts = [];
    const shiftDays = [0, 2, 4]; // Monday, Wednesday, Friday

    for (const dayOffset of shiftDays) {
      const shiftDate = new Date(lastMonday);
      shiftDate.setDate(lastMonday.getDate() + dayOffset);

      // Morning shift: 11:00 - 17:30 (6.5 hours)
      const morningStart = new Date(shiftDate);
      morningStart.setHours(11, 0, 0, 0);
      const morningEnd = new Date(shiftDate);
      morningEnd.setHours(17, 30, 0, 0);

      const morningShift = await client.query(
        `INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id)
         VALUES ($1, $2, $3, 5, $4)
         RETURNING id, start_time, end_time`,
        [morningStart, morningEnd, storeName, storeId]
      );
      shifts.push({ ...morningShift.rows[0], type: 'morning', dayName: ['Mon', 'Wed', 'Fri'][shiftDays.indexOf(dayOffset)] });

      // Evening shift: 17:30 - 21:00 (3.5 hours)
      const eveningStart = new Date(shiftDate);
      eveningStart.setHours(17, 30, 0, 0);
      const eveningEnd = new Date(shiftDate);
      eveningEnd.setHours(21, 0, 0, 0);

      const eveningShift = await client.query(
        `INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id)
         VALUES ($1, $2, $3, 5, $4)
         RETURNING id, start_time, end_time`,
        [eveningStart, eveningEnd, storeName, storeId]
      );
      shifts.push({ ...eveningShift.rows[0], type: 'evening', dayName: ['Mon', 'Wed', 'Fri'][shiftDays.indexOf(dayOffset)] });
    }

    console.log(`[Test] Created ${shifts.length} shifts`);

    // Book employees to shifts and mark as completed
    let bookingCount = 0;
    for (let i = 0; i < shifts.length; i++) {
      const shift = shifts[i];
      const employee = employees[i % employees.length];

      const booking = await client.query(
        `INSERT INTO shift_bookings (shift_id, employee_id, booking_status)
         VALUES ($1, $2, 'completed')
         RETURNING id`,
        [shift.id, employee.id]
      );
      bookingCount++;

      console.log(`[Test] ${employee.first_name} ${employee.last_name} → ${shift.dayName} ${shift.type} shift (${new Date(shift.start_time).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} - ${new Date(shift.end_time).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })})`);
    }

    await client.query('COMMIT');
    console.log(`\n[Test] ✓ Created ${bookingCount} completed shift bookings for last week`);
    console.log('\n=== TEST INSTRUCTIONS ===');
    console.log('1. Start the app: node src/app.js');
    console.log('2. Login as: mgr001 / 123 (Store A manager)');
    console.log('3. Go to "Timesheet" menu');
    console.log('4. Click "✎ Edit Timesheet"');
    console.log('5. Test editing shift times:');
    console.log('   - Change end time from 17:30 to 16:00 (employee left early)');
    console.log('   - Watch hours update in real-time as you type');
    console.log('   - Click ✓ to save (no page reload!)');
    console.log('   - See green flash confirmation');
    console.log('6. Test marking no-show:');
    console.log('   - Click "🗑 Del" button');
    console.log('   - Confirm the dialog');
    console.log('   - Shift gets crossed out (0 hours)');
    console.log('7. Test keyboard shortcut:');
    console.log('   - Edit a time field');
    console.log('   - Press Ctrl+S (or Cmd+S) to save quickly');
    console.log('\nExpected behavior:');
    console.log('- Hours calculate instantly as you type');
    console.log('- Saves without page refresh');
    console.log('- Green flash on success');
    console.log('- Wages calculated from actual times (not scheduled)');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Test] Error:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

createTestTimesheetData().catch(() => process.exit(1));
