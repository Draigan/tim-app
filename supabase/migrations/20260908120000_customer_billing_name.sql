-- Who the invoice is made out to, which is not always what we call the customer.
--
-- CRA requires the recipient's name on an invoice of $150 or more before the
-- recipient can claim an input tax credit, and the recipient is the party
-- liable under the rental agreement — frequently a company, while the card on
-- file belongs to a director personally. So customers.name stays the name we
-- know them by internally, and billing_name is the legal name that prints on a
-- tax invoice. Null means "use the name we have".
alter table public.customers add column if not exists billing_name text;

-- Both select and update on customers are revoked wholesale and re-granted per
-- column (20260601000234_protect_customer_private_columns.sql and
-- 20260531215416_tighten_rls_roles.sql), so a column added later is invisible
-- to staff in both directions until it is named here.
grant select (billing_name) on table public.customers to authenticated;
grant update (billing_name) on table public.customers to authenticated;
