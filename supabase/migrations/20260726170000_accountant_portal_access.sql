-- Accountant role: read-only access to the Online Payments data used by the
-- accountant portal. The accountant is not staff/owner/superuser, so the
-- existing RLS policies return zero rows for them. Grant SELECT-only access to
-- exactly the tables the portal reads, and nothing else.
--
-- Defense in depth: on the payment tables the accountant only sees tax-collected
-- (online) rows, never cash — matching what the portal is allowed to export.

create or replace function app_private.current_user_is_accountant()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.has_app_role('accountant')
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'neil@timberfell.ca'
$$;

revoke all on function app_private.current_user_is_accountant() from public, anon, authenticated;
grant execute on function app_private.current_user_is_accountant() to authenticated, service_role;

-- Payment tables: tax-collected rows only.
create policy "accountant can read taxed storage payments"
on public.storage_payments for select
to authenticated
using ((select app_private.current_user_is_accountant()) and coalesce(tax_amount, 0) > 0);

create policy "accountant can read taxed portable payments"
on public.portable_storage_payments for select
to authenticated
using ((select app_private.current_user_is_accountant()) and coalesce(tax_amount, 0) > 0);

-- Supporting tables needed to enrich each payment with customer + item details.
create policy "accountant can read storage tenancies"
on public.storage_tenancies for select
to authenticated
using ((select app_private.current_user_is_accountant()));

create policy "accountant can read storage units"
on public.storage_units for select
to authenticated
using ((select app_private.current_user_is_accountant()));

create policy "accountant can read assets"
on public.assets for select
to authenticated
using ((select app_private.current_user_is_accountant()));

create policy "accountant can read portable rentals"
on public.portable_storage_rentals for select
to authenticated
using ((select app_private.current_user_is_accountant()));

create policy "accountant can read customers"
on public.customers for select
to authenticated
using ((select app_private.current_user_is_accountant()));

-- Tag the accountant's auth user with the role (no-op if not yet invited).
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'accountant')
where lower(email) = 'neil@timberfell.ca';
