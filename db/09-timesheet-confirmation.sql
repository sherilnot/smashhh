-- Add confirmation status to timesheets
-- submitted = draft (can be edited and resubmitted)
-- confirmed = final (locked, sent to receiving manager)

ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS timesheets_status_check;
ALTER TABLE timesheets ADD CONSTRAINT timesheets_status_check
  CHECK (status IN ('submitted', 'confirmed', 'reviewed'));

-- Add default hourly wage for receiving manager wage calculation
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_hourly_wage NUMERIC(10, 2) DEFAULT 23.00;
UPDATE users SET default_hourly_wage = 23.00 WHERE default_hourly_wage IS NULL;

-- Add wage override table for receiving manager
CREATE TABLE IF NOT EXISTS timesheet_wage_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id),
  hourly_wage NUMERIC(10, 2) NOT NULL,
  set_by UUID NOT NULL REFERENCES users(id),
  set_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_timesheet_employee_wage UNIQUE(timesheet_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_wage_overrides_timesheet ON timesheet_wage_overrides(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_wage_overrides_employee ON timesheet_wage_overrides(employee_id);
