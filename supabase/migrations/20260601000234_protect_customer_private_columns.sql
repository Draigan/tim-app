-- Keep Stripe identifiers and customer PINs out of browser-readable customer
-- records. The UI only needs to know whether a saved card exists.

alter table public.customers
  add column if not exists has_payment_method boolean not null default false;

update public.customers
set has_payment_method = stripe_payment_method_id is not null
where has_payment_method is distinct from (stripe_payment_method_id is not null);

alter table public.customers
  alter column pin set default lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');

update public.customers
set pin = lpad((floor(random() * 9000) + 1000)::int::text, 4, '0')
where pin is null;

revoke select on table public.customers from authenticated;
grant select (
  id,
  name,
  phone,
  email,
  address,
  notes,
  created_at,
  archived_at,
  has_payment_method
) on table public.customers to authenticated;

revoke insert, update on table public.customers from authenticated;
grant insert (
  name,
  phone,
  email,
  address,
  notes
) on table public.customers to authenticated;
grant update (
  name,
  phone,
  email,
  address,
  notes,
  archived_at
) on table public.customers to authenticated;

grant all privileges on table public.customers to service_role;
