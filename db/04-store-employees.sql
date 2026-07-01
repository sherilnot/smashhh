-- Store-exclusive employee assignments
-- Each employee belongs to exactly one store

CREATE TABLE IF NOT EXISTS store_employee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_employee_store UNIQUE (employee_id)
);

CREATE INDEX IF NOT EXISTS idx_sea_store ON store_employee_assignments(store_id);
CREATE INDEX IF NOT EXISTS idx_sea_employee ON store_employee_assignments(employee_id);
