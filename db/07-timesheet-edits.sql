-- Add no_show flag and adjusted_hours to shift_bookings for manager edits
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS no_show BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS adjusted_hours NUMERIC(10, 2);
