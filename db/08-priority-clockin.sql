-- Priority score on users (higher = more reliable, gets auto-assigned to shifts)
ALTER TABLE users ADD COLUMN IF NOT EXISTS priority_score NUMERIC(6, 2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_priority ON users(priority_score DESC);

-- Actual clock-in/out times on shift_bookings (manager records when employee actually arrived/left)
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS actual_clock_in TIMESTAMP;
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS actual_clock_out TIMESTAMP;

-- Allow manager to directly assign employees to shifts (booking_status = 'confirmed' with assigned_by)
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES users(id);
