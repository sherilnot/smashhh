-- Received item invoices (shop managers report actual quantities received from warehouse)

CREATE TABLE IF NOT EXISTS received_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  checklist_id UUID REFERENCES store_checklists(id) ON DELETE SET NULL,
  submitted_by UUID NOT NULL REFERENCES users(id),
  invoice_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submitted_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_store_invoice_date UNIQUE (store_id, invoice_date)
);

CREATE INDEX IF NOT EXISTS idx_ri_store ON received_invoices(store_id);
CREATE INDEX IF NOT EXISTS idx_ri_status ON received_invoices(status);
CREATE INDEX IF NOT EXISTS idx_ri_date ON received_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_ri_checklist ON received_invoices(checklist_id);

CREATE TABLE IF NOT EXISTS received_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES received_invoices(id) ON DELETE CASCADE,
  product_name VARCHAR(200) NOT NULL,
  quantity_ordered VARCHAR(50),
  quantity_received VARCHAR(50) NOT NULL,
  item_notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rii_invoice ON received_invoice_items(invoice_id);
