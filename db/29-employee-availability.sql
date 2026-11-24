-- Employee availability per day, as submitted on the weekly "Book Shifts" form.
-- Kept separate from shift bookings: it records what the employee said
-- (available with a preferred time, or not available), even after the
-- manager approves, assigns or rejects anything, so the roster page can
-- always show it for reference.

CREATE TABLE IF NOT EXISTS employee_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  available BOOLEAN NOT NULL,
  -- '11-1730' morning, '1730-2100' evening, '11-2100' full day, 'custom'; NULL when not available
  shift_code VARCHAR(20),
  start_time TIME,
  end_time TIME,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (employee_id, day)
);

CREATE INDEX IF NOT EXISTS idx_ea_store_day ON employee_availability(store_id, day);

-- Carry over availability already submitted for this week and later: the
-- shifts people asked for on the weekly form (still pending, or since approved),
-- for weeks they submitted. "No shift" days weren't stored before, so those stay unknown.
INSERT INTO employee_availability (employee_id, store_id, day, available, shift_code, start_time, end_time, submitted_at)
SELECT DISTINCT ON (sb.employee_id, s.start_time::date)
       sb.employee_id, s.store_id, s.start_time::date, true,
       CASE
         WHEN s.start_time::time = '11:00' AND s.end_time::time = '17:30' THEN '11-1730'
         WHEN s.start_time::time = '17:30' AND s.end_time::time = '21:00' THEN '1730-2100'
         WHEN s.start_time::time = '11:00' AND s.end_time::time = '21:00' THEN '11-2100'
         ELSE 'custom'
       END,
       s.start_time::time, s.end_time::time, sb.booked_at
FROM shift_bookings sb
JOIN shifts s ON s.id = sb.shift_id
WHERE sb.booking_status IN ('pending', 'confirmed', 'completed')
  AND s.store_id IS NOT NULL
  AND s.start_time::date >= date_trunc('week', CURRENT_DATE)::date
  AND EXISTS (
    SELECT 1 FROM weekly_submissions ws
    WHERE ws.employee_id = sb.employee_id
      AND ws.roster_week_start = date_trunc('week', s.start_time)::date
  )
ORDER BY sb.employee_id, s.start_time::date, sb.booked_at DESC
ON CONFLICT (employee_id, day) DO NOTHING;
