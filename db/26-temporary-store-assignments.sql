-- Migration: Temporary Store Assignments
-- Allows store managers to temporarily assign employees from other stores to specific shifts
-- The assignment is tied to a shift booking and overrides the store exclusivity check

-- Create table to track temporary store assignments
CREATE TABLE IF NOT EXISTS temporary_store_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_booking_id UUID NOT NULL UNIQUE REFERENCES shift_bookings(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  to_store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  assigned_by_manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  -- Ensure from_store and to_store are different
  CONSTRAINT different_stores CHECK (from_store_id != to_store_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_temp_assignments_booking ON temporary_store_assignments(shift_booking_id);
CREATE INDEX IF NOT EXISTS idx_temp_assignments_employee ON temporary_store_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_temp_assignments_to_store ON temporary_store_assignments(to_store_id);
CREATE INDEX IF NOT EXISTS idx_temp_assignments_from_store ON temporary_store_assignments(from_store_id);

-- Add a column to timesheet_entries to track the actual store where work was performed
-- This ensures timesheets correctly reflect temporary assignments
ALTER TABLE timesheet_entries ADD COLUMN IF NOT EXISTS worked_at_store_id UUID REFERENCES stores(id);

CREATE INDEX IF NOT EXISTS idx_te_worked_store ON timesheet_entries(worked_at_store_id);

-- Add a flag to shift_bookings to indicate if it's a temporary assignment
-- This makes it easier to identify and filter temporary assignments
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS is_temporary_assignment BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sb_temp_assignment ON shift_bookings(is_temporary_assignment) WHERE is_temporary_assignment = true;
