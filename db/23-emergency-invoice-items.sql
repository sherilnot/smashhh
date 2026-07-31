-- Add is_emergency flag to received_invoice_items to preserve emergency items during checklist re-sync

ALTER TABLE received_invoice_items
  ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN received_invoice_items.is_emergency IS 'True for items added manually by manager (emergency items). These items are preserved during checklist re-sync.';
