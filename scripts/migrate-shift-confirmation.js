require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// ==============================================================================
// MANAGER SHIFT CONFIRMATION MIGRATION
// ------------------------------------------------------------------------------
// Idempotent migration: introduces the Store entity and manager ownership,
// gives shifts a (nullable) owning store, and expands the shift_bookings
// lifecycle to support the pending -> confirmed/rejected approval workflow plus
// manager-driven completion. All statements use IF NOT EXISTS / IF EXISTS guards
// so the script can be re-run safely.
// ==============================================================================
const sql = `
-- New table: stores (Requirement 1.1)
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- New table: store_manager_assignments (Requirements 1.2-1.4, 1.8)
CREATE TABLE IF NOT EXISTS store_manager_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_store_manager UNIQUE (store_id, manager_id)
);
CREATE INDEX IF NOT EXISTS idx_sma_manager ON store_manager_assignments(manager_id);
CREATE INDEX IF NOT EXISTS idx_sma_store ON store_manager_assignments(store_id);

-- Altered table: shifts gains a nullable owning store (Requirements 2.1, 2.3)
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_shifts_store ON shifts(store_id);

-- Altered table: shift_bookings lifecycle expansion (Requirements 3.1, 5.2, 6.2, 7.2)
-- Expand allowed statuses to include 'pending' and 'rejected'.
ALTER TABLE shift_bookings DROP CONSTRAINT IF EXISTS shift_bookings_booking_status_check;
ALTER TABLE shift_bookings ADD CONSTRAINT shift_bookings_booking_status_check
  CHECK (booking_status IN ('pending', 'confirmed', 'rejected', 'completed', 'cancelled', 'no_show'));

-- Decision / completion audit columns.
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS decided_by_manager_id UUID REFERENCES users(id);
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP;
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS completed_by_manager_id UUID REFERENCES users(id);
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

-- Occupied capacity now counts pending + confirmed, so prevent duplicate active
-- bookings for the same (shift, employee) across both states (Requirement 3.3).
DROP INDEX IF EXISTS idx_unique_confirmed_booking;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_booking
  ON shift_bookings(shift_id, employee_id)
  WHERE booking_status IN ('pending', 'confirmed');
`;

client.connect()
  .then(() => client.query(sql))
  .then(() => { console.log('✅ Manager shift confirmation migration applied'); client.end(); })
  .catch(err => { console.error('❌ Error:', err.message); client.end(); });
