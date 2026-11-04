-- Shop expenses: store managers record money spent on the shop (e.g. a broken
-- pipe, a plumber, cleaning supplies) with an optional receipt photo. Payroll
-- sees the monthly cost per shop.

CREATE TABLE IF NOT EXISTS shop_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  category VARCHAR(20) NOT NULL DEFAULT 'other'
    CHECK (category IN ('repairs', 'equipment', 'cleaning', 'supplies', 'utilities', 'other')),
  description TEXT NOT NULL,
  -- The day the money was spent; monthly totals group by this, not by when it was entered
  spent_on DATE NOT NULL DEFAULT CURRENT_DATE,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_se_store_spent ON shop_expenses(store_id, spent_on);
CREATE INDEX IF NOT EXISTS idx_se_spent ON shop_expenses(spent_on);

CREATE TABLE IF NOT EXISTS shop_expense_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES shop_expenses(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sei_expense ON shop_expense_images(expense_id);
