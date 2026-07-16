-- Management reports: shop managers send a text report with photos to OM001

CREATE TABLE IF NOT EXISTS management_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES users(id),
  report_text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed')),
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_mr_store ON management_reports(store_id);
CREATE INDEX IF NOT EXISTS idx_mr_status ON management_reports(status);
CREATE INDEX IF NOT EXISTS idx_mr_date ON management_reports(submitted_at);

CREATE TABLE IF NOT EXISTS management_report_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES management_reports(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mri_report ON management_report_images(report_id);
