require('dotenv').config();
const http = require('http');

/**
 * Automated API test for timesheet AJAX endpoints
 * Tests the /manager/timesheet/edit-ajax endpoint
 */

async function testTimesheetAPI() {
  console.log('\n=== Testing Timesheet AJAX API ===\n');

  // Step 1: Login as manager
  console.log('1. Logging in as mgr001...');
  const loginResult = await makeRequest('POST', '/login', 'user_id=mgr001&password=123');
  
  if (!loginResult.cookie) {
    console.error('❌ Login failed - no session cookie received');
    return;
  }
  console.log('✓ Login successful');
  const sessionCookie = loginResult.cookie;

  // Step 2: Get a completed booking ID
  const { pool } = require('../src/config/database');
  const bookingRes = await pool.query(`
    SELECT sb.id, u.first_name, u.last_name, s.start_time, s.end_time
    FROM shift_bookings sb
    JOIN shifts s ON s.id = sb.shift_id
    JOIN users u ON u.id = sb.employee_id
    JOIN store_manager_assignments sma ON sma.store_id = s.store_id
    WHERE sma.manager_id = (SELECT id FROM users WHERE user_id = 'mgr001')
      AND sb.booking_status = 'completed'
    LIMIT 1
  `);

  if (bookingRes.rows.length === 0) {
    console.error('❌ No completed bookings found. Run test-timesheet.js first.');
    await pool.end();
    return;
  }

  const booking = bookingRes.rows[0];
  console.log(`\n2. Testing with booking: ${booking.first_name} ${booking.last_name}`);
  console.log(`   Scheduled: ${new Date(booking.start_time).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} - ${new Date(booking.end_time).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`);

  // Step 3: Test AJAX edit (change end time to 16:00)
  console.log('\n3. Testing AJAX time edit (changing end time to 16:00)...');
  const editPayload = `bookingId=${booking.id}&action=adjust_times&startTime=11:00&endTime=16:00`;
  const editResult = await makeRequest('POST', '/manager/timesheet/edit-ajax', editPayload, sessionCookie);
  
  if (editResult.body && editResult.body.success) {
    console.log(`✓ AJAX edit successful! New hours: ${editResult.body.newHours}h`);
  } else {
    console.error(`❌ AJAX edit failed:`, editResult.body);
  }

  // Step 4: Verify the change was saved
  console.log('\n4. Verifying change was saved to database...');
  const verifyRes = await pool.query(
    `SELECT actual_clock_in, actual_clock_out FROM shift_bookings WHERE id = $1`,
    [booking.id]
  );
  
  if (verifyRes.rows[0].actual_clock_in && verifyRes.rows[0].actual_clock_out) {
    const clockIn = new Date(verifyRes.rows[0].actual_clock_in);
    const clockOut = new Date(verifyRes.rows[0].actual_clock_out);
    console.log(`✓ Actual times saved:`);
    console.log(`   Clock in: ${clockIn.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`);
    console.log(`   Clock out: ${clockOut.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`);
    
    const hours = (clockOut - clockIn) / (1000 * 60 * 60);
    console.log(`   Hours: ${hours.toFixed(2)}h`);
    
    if (Math.abs(hours - 5.0) < 0.01) {
      console.log('✓ Hours calculated correctly (11:00 - 16:00 = 5 hours)');
    } else {
      console.error(`❌ Hours incorrect. Expected 5.00h, got ${hours.toFixed(2)}h`);
    }
  } else {
    console.error('❌ Actual clock times not saved');
  }

  await pool.end();
  
  console.log('\n=== Test Complete ===\n');
  console.log('Now test manually in browser:');
  console.log('1. Open http://localhost:3000');
  console.log('2. Login: mgr001 / 123');
  console.log('3. Go to Timesheet → Edit Timesheet');
  console.log('4. Change a time and watch:');
  console.log('   - Hours update in real-time as you type');
  console.log('   - Click ✓ saves without page reload');
  console.log('   - Green flash confirms success');
  console.log('   - Press Ctrl+S for quick save\n');
}

function makeRequest(method, path, body = '', cookie = '') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    if (cookie) {
      options.headers['Cookie'] = cookie;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const sessionCookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0] : null;
        try {
          const json = JSON.parse(data);
          resolve({ body: json, cookie: sessionCookie });
        } catch {
          resolve({ body: data, cookie: sessionCookie });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

testTimesheetAPI().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
