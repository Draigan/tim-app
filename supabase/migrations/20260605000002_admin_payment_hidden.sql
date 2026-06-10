CREATE TABLE IF NOT EXISTS admin_payment_hidden (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('fixed', 'portable')),
  payment_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(payment_type, payment_id)
);

ALTER TABLE admin_payment_hidden ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_admin_payment_hidden"
ON admin_payment_hidden FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
