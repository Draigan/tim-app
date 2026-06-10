CREATE TABLE IF NOT EXISTS admin_payment_received (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('fixed', 'portable')),
  payment_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(payment_type, payment_id)
);

ALTER TABLE admin_payment_received ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_admin_payment_received"
ON admin_payment_received FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
