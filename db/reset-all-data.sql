-- ============================================================================
-- RESET ALL ROSTER, TIMESHEET, AND SHIFT DATA
-- ============================================================================
-- This script removes all booking, timesheet, and shift data to start fresh
-- Run this carefully in your development environment
-- ============================================================================

BEGIN;

-- 1. Delete all weekly submissions (employees' booking confirmations)
DELETE FROM weekly_submissions;
COMMIT;

BEGIN;
-- 2. Delete all timesheet wage overrides
DELETE FROM timesheet_wage_overrides;
COMMIT;

BEGIN;
-- 3. Delete all timesheet entries
DELETE FROM timesheet_entries;
COMMIT;

BEGIN;
-- 4. Delete all timesheets
DELETE FROM timesheets;
COMMIT;

BEGIN;
-- 5. Delete all shift bookings
DELETE FROM shift_bookings;
COMMIT;

BEGIN;
-- 6. Delete all shifts
DELETE FROM shifts;
COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these to confirm deletion:

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

-- ============================================================================
-- Expected Result: All counts should be 0
-- ============================================================================
