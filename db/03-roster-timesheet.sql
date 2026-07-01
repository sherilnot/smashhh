-- Roster & Timesheet Management Migration (idempotent)

-- 1. Update users role CHECK to include 'receiving_manager'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('employee', 'store_manager', 'warehouse_manager', 'receiving_manager'));

-- 2. Create timesheets table
CREATE TABLE IF NOT EXISTS timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  total_hours NUMERIC(10, 2) NOT NULL,
  employee_count INTEGER NOT NULL,
  submitted_by UUID NOT NULL REFERENCES users(id),
  received_by UUID NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed')),
  CONSTRAINT unique_store_week UNIQUE (store_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_timesheets_store ON timesheets(store_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_week ON timesheets(week_start);
CREATE INDEX IF NOT EXISTS idx_timesheets_submitted_by ON timesheets(submitted_by);
CREATE INDEX IF NOT EXISTS idx_timesheets_received_by ON timesheets(received_by);
CREATE INDEX IF NOT EXISTS idx_timesheets_submitted_at ON timesheets(submitted_at);

-- 3. Create timesheet_entries table
CREATE TABLE IF NOT EXISTS timesheet_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id),
  shift_date DATE NOT NULL,
  shift_start TIMESTAMP NOT NULL,
  shift_end TIMESTAMP NOT NULL,
  hours_worked NUMERIC(10, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_te_timesheet ON timesheet_entries(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_te_employee ON timesheet_entries(employee_id);

-- 4. Add transmitted_at and transmitted_by to checklist_items
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS transmitted_at TIMESTAMP;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS transmitted_by UUID REFERENCES users(id);
