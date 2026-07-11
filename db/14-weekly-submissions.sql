-- Add weekly submissions tracking table
-- Ensures employees can only submit shift preferences once per booking window

CREATE TABLE IF NOT EXISTS weekly_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  roster_week_start DATE NOT NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, roster_week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_submissions_employee ON weekly_submissions(employee_id);
CREATE INDEX IF NOT EXISTS idx_weekly_submissions_week ON weekly_submissions(roster_week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_submissions_submitted_at ON weekly_submissions(submitted_at);

COMMENT ON TABLE weekly_submissions IS 'Tracks when employees submit their weekly shift preferences';
COMMENT ON COLUMN weekly_submissions.roster_week_start IS 'Monday of the week being booked (YYYY-MM-DD)';
COMMENT ON COLUMN weekly_submissions.submitted_at IS 'When the submission was made (during Wed-Sat booking window)';
