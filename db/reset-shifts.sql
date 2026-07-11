-- Reset all shift, roster, and timesheet data
-- Keeps users, stores, and assignments intact
-- USE WITH CAUTION - This deletes all shift history!

BEGIN;

-- Delete in order due to foreign key constraints

-- 1. Delete timesheet entries first
DELETE FROM timesheet_entries;
COMMENT ON COLUMN timesheet_entries.timesheet_id IS 'References timesheets table - all entries cleared';

-- 2. Delete timesheets
DELETE FROM timesheets;
COMMENT ON TABLE timesheets IS 'All timesheets cleared';

-- 3. Delete weekly submissions (shift booking locks)
DELETE FROM weekly_submissions;
COMMENT ON TABLE weekly_submissions IS 'All weekly submission records cleared';

-- 4. Delete shift bookings
DELETE FROM shift_bookings;
COMMENT ON TABLE shift_bookings IS 'All shift bookings cleared';

-- 5. Delete shifts
DELETE FROM shifts;
COMMENT ON TABLE shifts IS 'All shifts cleared';

-- 6. Delete notification logs related to shifts
DELETE FROM notification_logs WHERE notification_type = 'shift_booking_reminder';
COMMENT ON TABLE notification_logs IS 'Shift reminder notifications cleared';

-- Reset sequences if needed (PostgreSQL auto-increments)
-- Not needed for UUID-based tables

COMMIT;

-- Verify cleanup
SELECT 'Shifts remaining:' as check_type, COUNT(*) as count FROM shifts
UNION ALL
SELECT 'Shift bookings remaining:', COUNT(*) FROM shift_bookings
UNION ALL
SELECT 'Timesheets remaining:', COUNT(*) FROM timesheets
UNION ALL
SELECT 'Timesheet entries remaining:', COUNT(*) FROM timesheet_entries
UNION ALL
SELECT 'Weekly submissions remaining:', COUNT(*) FROM weekly_submissions
UNION ALL
SELECT 'Users remaining:', COUNT(*) FROM users
UNION ALL
SELECT 'Stores remaining:', COUNT(*) FROM stores;

-- Success message
SELECT 
  '✅ All shift data cleared successfully!' as status,
  'Users and stores preserved' as note;
