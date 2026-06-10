CREATE TABLE IF NOT EXISTS admin_revenue_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_type TEXT NOT NULL CHECK (unit_type IN ('fixed', 'portable')),
  unit_id UUID REFERENCES storage_units(id),
  asset_id UUID REFERENCES assets(id),
  amount_received DECIMAL(10, 2) NOT NULL,
  note TEXT,
  received_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_revenue_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_admin_revenue_receipts"
ON admin_revenue_receipts FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
