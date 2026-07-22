/**
 * Full Integration Test: Roster → Timesheet → Wages
 * Tests the entire workflow end-to-end against a live database.
 *
 * Run with: node scripts/test-full-workflow.js
 */
require('dotenv').config();
const http = require('http');

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

// Simple HTTP request helper with cookie jar support
function request(method, path, { body, cookies } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {}
    };

    if (cookies) {
      options.headers['Cookie'] = cookies;
    }

    let postData = null;
    if (body && method !== 'GET') {
      postData = new URLSearchParams(body).toString();
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Extract set-cookie headers
        const setCookies = res.headers['set-cookie'] || [];
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          cookies: setCookies
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function extractCookie(setCookies) {
  for (const c of setCookies) {
    if (c.startsWith('session_token=')) {
      return c.split(';')[0];
    }
  }
  return null;
}

async function login(userId, password = '123') {
  const res = await request('POST', '/login', {
    body: { user_id: userId, password }
  });
  const cookie = extractCookie(res.cookies);
  return cookie;
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  FULL WORKFLOW INTEGRATION TEST');
  console.log('  Roster Booking → Manager Approval → Timesheet → Wages');
  console.log('══════════════════════════════════════════════════════════\n');

  // ─── 1. Test Login ────────────────────────────────────────────────────────
  console.log('1️⃣  AUTHENTICATION');
  
  const empCookie = await login('shabas');
  assert(empCookie !== null, 'Employee (shabas) can log in');

  const mgrCookie = await login('manager_seaford');
  assert(mgrCookie !== null, 'Manager (manager_seaford) can log in');

  const opsCookie = await login('operations');
  assert(opsCookie !== null, 'Operations manager can log in');

  const payrollCookie = await login('payroll');
  assert(payrollCookie !== null, 'Payroll/Receiving manager can log in');

  const badLogin = await login('nonexistent', 'wrong');
  assert(badLogin === null, 'Invalid credentials denied');

  // ─── 2. Employee Dashboard ────────────────────────────────────────────────
  console.log('\n2️⃣  EMPLOYEE VIEWS');

  const empDash = await request('GET', '/employee/dashboard', { cookies: empCookie });
  assert(empDash.status === 200, 'Employee dashboard loads (200)');
  assert(empDash.body.includes('Welcome') || empDash.body.includes('dashboard'), 'Dashboard shows welcome content');

  const empShifts = await request('GET', '/employee/shifts', { cookies: empCookie });
  assert(empShifts.status === 200, 'Employee shifts page loads (200)');
  assert(empShifts.body.includes('Mon') || empShifts.body.includes('shift'), 'Shifts page shows booking form');

  const empMyShifts = await request('GET', '/employee/my-shifts', { cookies: empCookie });
  assert(empMyShifts.status === 200, 'Employee my-shifts page loads (200)');

  // ─── 3. Employee Shift Booking ────────────────────────────────────────────
  console.log('\n3️⃣  SHIFT BOOKING');

  // Calculate next week's Monday
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 1 : 8 - day;
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + diffToMonday);
  nextMonday.setHours(0, 0, 0, 0);

  const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const mondayStr = formatDate(nextMonday);
  const tue = new Date(nextMonday); tue.setDate(tue.getDate() + 1);
  const tuesdayStr = formatDate(tue);
  const wed = new Date(nextMonday); wed.setDate(wed.getDate() + 2);
  const wednesdayStr = formatDate(wed);

  // First, clear any existing submission for this employee for next week
  const { pool } = require('../src/config/database');
  const empIdRes = await pool.query(`SELECT id FROM users WHERE user_id = 'shabas'`);
  const empId = empIdRes.rows[0].id;
  await pool.query(
    `DELETE FROM weekly_submissions WHERE employee_id = $1 AND roster_week_start = $2`,
    [empId, mondayStr]
  );
  // Clear any existing bookings for next week
  await pool.query(
    `DELETE FROM shift_bookings WHERE employee_id = $1 AND shift_id IN (
      SELECT id FROM shifts WHERE start_time >= $2 AND start_time < $3
    )`,
    [empId, nextMonday, new Date(nextMonday.getTime() + 7 * 24 * 60 * 60 * 1000)]
  );

  // Book shifts for Mon, Tue, Wed next week
  const bookRes = await request('POST', '/employee/book-weekly-shifts', {
    cookies: empCookie,
    body: {
      [`shift_${mondayStr}`]: '11-1730',
      [`shift_${tuesdayStr}`]: '1730-2100',
      [`shift_${wednesdayStr}`]: '11-2100'
    }
  });
  // Should redirect to my-shifts on success (302)
  assert(bookRes.status === 302, 'Shift booking returns redirect (302)');
  assert(
    bookRes.headers.location && bookRes.headers.location.includes('/employee/my-shifts'),
    'Redirect goes to my-shifts (success)'
  );

  // Verify bookings were created as pending
  const pendingRes = await pool.query(
    `SELECT sb.booking_status, s.start_time 
     FROM shift_bookings sb JOIN shifts s ON s.id = sb.shift_id 
     WHERE sb.employee_id = $1 AND s.start_time >= $2 
     ORDER BY s.start_time`,
    [empId, nextMonday]
  );
  assert(pendingRes.rows.length === 3, `3 bookings created (got ${pendingRes.rows.length})`);
  assert(pendingRes.rows.every(r => r.booking_status === 'pending'), 'All bookings have pending status');

  // Try to submit again — should be blocked
  const dupeRes = await request('POST', '/employee/book-weekly-shifts', {
    cookies: empCookie,
    body: { [`shift_${mondayStr}`]: '11-1730' }
  });
  assert(
    dupeRes.status === 302 && dupeRes.headers.location && dupeRes.headers.location.includes('error'),
    'Duplicate submission is blocked'
  );

  // ─── 4. Manager Approval ─────────────────────────────────────────────────
  console.log('\n4️⃣  MANAGER APPROVAL');

  const mgrPending = await request('GET', '/manager/pending', { cookies: mgrCookie });
  assert(mgrPending.status === 200, 'Manager pending page loads (200)');
  assert(mgrPending.body.includes('Shabas'), 'Pending page shows employee name');

  // Get booking IDs and confirm them
  const bookingIds = pendingRes.rows.length > 0 ? await pool.query(
    `SELECT sb.id FROM shift_bookings sb JOIN shifts s ON s.id = sb.shift_id
     WHERE sb.employee_id = $1 AND sb.booking_status = 'pending' AND s.start_time >= $2`,
    [empId, nextMonday]
  ) : { rows: [] };

  let confirmedCount = 0;
  for (const row of bookingIds.rows) {
    const confirmRes = await request('POST', '/manager/confirm', {
      cookies: mgrCookie,
      body: { bookingId: row.id }
    });
    if (confirmRes.status === 302) confirmedCount++;
  }
  assert(confirmedCount === 3, `Manager confirmed all 3 bookings (confirmed ${confirmedCount})`);

  // Verify status changed to confirmed
  const confirmedCheck = await pool.query(
    `SELECT booking_status FROM shift_bookings WHERE id = ANY($1::uuid[])`,
    [bookingIds.rows.map(r => r.id)]
  );
  assert(
    confirmedCheck.rows.every(r => r.booking_status === 'confirmed'),
    'All bookings now have confirmed status'
  );

  // ─── 5. Manager Roster View ──────────────────────────────────────────────
  console.log('\n5️⃣  ROSTER VIEW');

  const rosterRes = await request('GET', `/manager/roster?date=${mondayStr}`, { cookies: mgrCookie });
  assert(rosterRes.status === 200, 'Manager roster loads (200)');
  assert(rosterRes.body.includes('Shabas'), 'Roster shows confirmed employee');

  // ─── 6. Simulate Shift Completion (for past week) ────────────────────────
  console.log('\n6️⃣  SHIFT COMPLETION & TIMESHEET');

  // Create past completed shifts directly for timesheet testing
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7);
  lastMonday.setHours(0, 0, 0, 0);

  const storeRes = await pool.query(
    `SELECT store_id FROM store_manager_assignments sma 
     JOIN users u ON u.id = sma.manager_id WHERE u.user_id = 'manager_seaford'`
  );
  const storeId = storeRes.rows[0].store_id;

  // Get a few employees from Seaford
  const seafordEmps = await pool.query(
    `SELECT u.id, u.user_id FROM users u 
     JOIN store_employee_assignments sea ON sea.employee_id = u.id
     WHERE sea.store_id = $1 LIMIT 3`,
    [storeId]
  );

  // Clean up any existing past data for this test
  const lastMondayStr = formatDate(lastMonday);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  lastSunday.setHours(23, 59, 59, 999);

  await pool.query(`DELETE FROM timesheets WHERE store_id = $1 AND week_start = $2`, [storeId, lastMondayStr]);

  // Create shifts for last week and complete them
  for (let d = 0; d < 5; d++) {
    const start = new Date(lastMonday);
    start.setDate(lastMonday.getDate() + d);
    start.setHours(11, 0, 0, 0);
    const end = new Date(start);
    end.setHours(17, 30, 0, 0);

    const shiftRes = await pool.query(
      `INSERT INTO shifts (start_time, end_time, store_location, store_id, capacity)
       VALUES ($1, $2, 'Seaford', $3, 5)
       ON CONFLICT (store_id, start_time, end_time) WHERE store_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [start, end, storeId]
    );
    
    let shiftId;
    if (shiftRes.rows.length > 0) {
      shiftId = shiftRes.rows[0].id;
    } else {
      const existing = await pool.query(
        `SELECT id FROM shifts WHERE store_id = $1 AND start_time = $2 AND end_time = $3`,
        [storeId, start, end]
      );
      shiftId = existing.rows[0].id;
    }

    for (const emp of seafordEmps.rows) {
      await pool.query(
        `INSERT INTO shift_bookings (shift_id, employee_id, booking_status)
         VALUES ($1, $2, 'completed')
         ON CONFLICT DO NOTHING`,
        [shiftId, emp.id]
      );
    }
  }

  // Test timesheet generation
  const timesheetRes = await request('GET', `/manager/timesheet?date=${lastMondayStr}`, { cookies: mgrCookie });
  assert(timesheetRes.status === 200, 'Timesheet page loads (200)');
  assert(timesheetRes.body.includes('Shabas') || timesheetRes.body.includes('Ashwin'), 'Timesheet shows employee data');

  // Submit the timesheet
  const lastSundayStr = formatDate(lastSunday);
  const submitTsRes = await request('POST', '/manager/timesheet/submit', {
    cookies: mgrCookie,
    body: { weekStart: lastMondayStr, weekEnd: lastSundayStr }
  });
  assert(submitTsRes.status === 302, 'Timesheet submit returns redirect');
  assert(
    !submitTsRes.headers.location || !submitTsRes.headers.location.includes('error'),
    'Timesheet submitted successfully (no error in redirect)'
  );

  // Confirm the timesheet
  const confirmTsRes = await request('POST', '/manager/timesheet/confirm', {
    cookies: mgrCookie,
    body: { weekStart: lastMondayStr }
  });
  assert(confirmTsRes.status === 302, 'Timesheet confirm returns redirect');
  assert(
    confirmTsRes.headers.location && confirmTsRes.headers.location.includes('success=confirmed'),
    'Timesheet confirmed successfully'
  );

  // Verify timesheet is locked
  const tsCheck = await pool.query(
    `SELECT status FROM timesheets WHERE store_id = $1 AND week_start = $2`,
    [storeId, lastMondayStr]
  );
  assert(tsCheck.rows.length > 0 && tsCheck.rows[0].status === 'confirmed', 'Timesheet status is confirmed (locked)');

  // ─── 7. Wages ────────────────────────────────────────────────────────────
  console.log('\n7️⃣  WAGE CALCULATION');

  // Employee dashboard should show wages for completed shifts
  const empDash2 = await request('GET', '/employee/dashboard', { cookies: empCookie });
  assert(empDash2.status === 200, 'Employee dashboard loads with wage data');
  // Check if wage total is shown (the dollar sign or total amount)
  assert(
    empDash2.body.includes('$') || empDash2.body.includes('wageTotal') || empDash2.body.includes('Total'),
    'Employee dashboard shows wage information'
  );

  // ─── 8. Operation Manager Views ──────────────────────────────────────────
  console.log('\n8️⃣  OPERATION MANAGER VIEWS');

  const opsInvoices = await request('GET', '/operation-manager/invoices', { cookies: opsCookie });
  assert(opsInvoices.status === 200, 'Operation manager invoices page loads');

  const opsTimesheets = await request('GET', '/operation-manager/timesheets', { cookies: opsCookie });
  assert(opsTimesheets.status === 200, 'Operation manager timesheets page loads');
  assert(opsTimesheets.body.includes('Seaford'), 'Timesheets shows store name');

  const opsCash = await request('GET', '/operation-manager/cash', { cookies: opsCookie });
  assert(opsCash.status === 200, 'Operation manager cash page loads');

  const opsMaintenance = await request('GET', '/operation-manager/maintenance', { cookies: opsCookie });
  assert(opsMaintenance.status === 200, 'Operation manager maintenance page loads');

  // ─── 9. Role Guards ──────────────────────────────────────────────────────
  console.log('\n9️⃣  ROLE-BASED ACCESS CONTROL');

  // Employee can't access manager routes
  const empToMgr = await request('GET', '/manager/dashboard', { cookies: empCookie });
  assert(empToMgr.status === 302, 'Employee redirected from manager route');

  // Manager can't access operation-manager routes
  const mgrToOps = await request('GET', '/operation-manager/invoices', { cookies: mgrCookie });
  assert(mgrToOps.status === 302, 'Manager redirected from operation-manager route');

  // Unauthenticated user redirected to login
  const noAuth = await request('GET', '/employee/dashboard', {});
  assert(noAuth.status === 302, 'Unauthenticated user redirected');

  // ─── 10. Auto-Complete Check ─────────────────────────────────────────────
  console.log('\n🔟  AUTO-COMPLETE & MISC');

  // Test auto-complete function directly
  const { autoCompleteShifts } = require('../src/services/shiftService');
  const autoResult = await autoCompleteShifts();
  assert(typeof autoResult.completed === 'number', `Auto-complete ran (completed: ${autoResult.completed})`);

  // Test wage calculation directly
  const { getEmployeeWageEntries, totalWage } = require('../src/services/wageService');
  const wageResult = await getEmployeeWageEntries(empId);
  assert(Array.isArray(wageResult.entries), 'Wage entries returned as array');
  const total = totalWage(wageResult.entries);
  assert(typeof total === 'number' && total >= 0, `Total wage calculated: $${total.toFixed(2)}`);

  // Test weekly submission service
  const { getSubmissionStatus } = require('../src/services/weeklySubmissionService');
  const subStatus = await getSubmissionStatus(empId);
  assert(subStatus.hasSubmitted === true, 'Weekly submission tracked correctly');
  assert(subStatus.canSubmit === false, 'Cannot submit again after already submitted');

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
