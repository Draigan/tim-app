-- The address that goes with billing_name. A company billed through a
-- director's personal card has a company address too, and the one Stripe holds
-- is the cardholder's — right for verifying the card, wrong for the invoice.
-- Free text, one line per row, matching how customers.address is already
-- stored. Null means "fall back to Stripe, then to the address on file".
alter table public.customers add column if not exists billing_address text;

-- Named in both grants: select and update on customers are each revoked
-- wholesale and re-granted per column (20260601000234 and 20260531215416), so a
-- column added later is invisible to staff in whichever direction is missed.
grant select (billing_address) on table public.customers to authenticated;
grant update (billing_address) on table public.customers to authenticated;
