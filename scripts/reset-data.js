#!/usr/bin/env node

/**
 * Reset All Roster, Timesheet, and Shift Data
 * 
 * This script deletes all:
 * - Weekly submissions (employee booking confirmations)
 * - Timesheet wage overrides
 * - Timesheet entries
 * - Timesheets
 * - Shift bookings
 * - Shifts
 * 
 * Usage: npm run db:reset-data
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function resetData() {
  const client = await pool.connect();
  
  try {
    console.log('🗑️  Starting data reset...\n');
    
    // Read and execute the SQL file
    const sqlPath = path.join(__dirname, '..', 'db', 'reset-all-data.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute the reset
    await client.query(sql);
    
    console.log('✅ Data reset completed successfully!\n');
    
    // Show verification results
    console.log('📊 Verification (all counts should be 0):');
    console.log('─────────────────────────────────────────');
    
    const verifyQuery = `
      SELECT 'weekly_submissions' as table_name, COUNT(*) as record_count FROM weekly_submissions
      UNION ALL
      SELECT 'timesheet_wage_overrides', COUNT(*) FROM timesheet_wage_overrides
      UNION ALL
      SELECT 'timesheet_entries', COUNT(*) FROM timesheet_entries
      UNION ALL
      SELECT 'timesheets', COUNT(*) FROM timesheets
      UNION ALL
      SELECT 'shift_bookings', COUNT(*) FROM shift_bookings
      UNION ALL
      SELECT 'shifts', COUNT(*) FROM shifts
      ORDER BY table_name;
    `;
    
    const result = await client.query(verifyQuery);
    
    result.rows.forEach(row => {
      const status = parseInt(row.record_count) === 0 ? '✓' : '✗';
      console.log(`${status} ${row.table_name.padEnd(30)} ${row.record_count} records`);
    });
    
    console.log('─────────────────────────────────────────\n');
    
    const allZero = result.rows.every(row => parseInt(row.record_count) === 0);
    
    if (allZero) {
      console.log('🎉 All data successfully cleared! You can now start fresh.\n');
    } else {
      console.log('⚠️  Warning: Some tables still contain data. Check for foreign key constraints.\n');
    }
    
  } catch (error) {
    console.error('❌ Error resetting data:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the reset
resetData().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
