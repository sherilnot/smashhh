-- Store supply checklists (daily ordering checklists managers fill and send to warehouse)

CREATE TABLE IF NOT EXISTS store_checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_name VARCHAR(200) NOT NULL,
  default_quantity VARCHAR(50) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sct_store ON store_checklist_templates(store_id);

CREATE TABLE IF NOT EXISTS store_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES users(id),
  check_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'reviewed')),
  submitted_at TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_store_checklist_date UNIQUE (store_id, check_date)
);

CREATE INDEX IF NOT EXISTS idx_sc_store ON store_checklists(store_id);
CREATE INDEX IF NOT EXISTS idx_sc_status ON store_checklists(status);
CREATE INDEX IF NOT EXISTS idx_sc_date ON store_checklists(check_date);

CREATE TABLE IF NOT EXISTS store_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES store_checklists(id) ON DELETE CASCADE,
  product_name VARCHAR(200) NOT NULL,
  quantity_needed VARCHAR(50) NOT NULL,
  quantity_to_bring VARCHAR(50),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sci_checklist ON store_checklist_items(checklist_id);
