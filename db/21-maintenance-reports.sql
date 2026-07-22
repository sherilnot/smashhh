-- Maintenance reports (store managers send text + photos to operations)
CREATE TABLE IF NOT EXISTS maintenance_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed')),
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mr_store ON maintenance_reports(store_id);
CREATE INDEX IF NOT EXISTS idx_mr_status ON maintenance_reports(status);

CREATE TABLE IF NOT EXISTS maintenance_report_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES maintenance_reports(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  file_size INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mri_report ON maintenance_report_images(report_id);
