-- Admin app needs stripe_customer_id to deep-link to the Stripe dashboard.
-- This app is admin-only so exposing the ID to authenticated users is safe.
grant select (stripe_customer_id) on table public.customers to authenticated;
