-- Manager shift confirmation migration (idempotent)

CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_manager_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_store_manager UNIQUE (store_id, manager_id)
);
CREATE INDEX IF NOT EXISTS idx_sma_manager ON store_manager_assignments(manager_id);
CREATE INDEX IF NOT EXISTS idx_sma_store ON store_manager_assignments(store_id);

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_shifts_store ON shifts(store_id);

ALTER TABLE shift_bookings DROP CONSTRAINT IF EXISTS shift_bookings_booking_status_check;
ALTER TABLE shift_bookings ADD CONSTRAINT shift_bookings_booking_status_check
  CHECK (booking_status IN ('pending', 'confirmed', 'rejected', 'completed', 'cancelled', 'no_show'));

ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS decided_by_manager_id UUID REFERENCES users(id);
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP;
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS completed_by_manager_id UUID REFERENCES users(id);
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

DROP INDEX IF EXISTS idx_unique_confirmed_booking;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_booking
  ON shift_bookings(shift_id, employee_id)
  WHERE booking_status IN ('pending', 'confirmed');
