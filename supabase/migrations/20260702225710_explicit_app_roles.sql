-- Explicit app roles:
--   superuser: programmer/admin access. Reserved for d@d.d.
--   owner: normal company-owner operations with read-only storage occupancy.
--   driver: field operations and customer access.

create schema if not exists app_private;

create or replace function app_private.has_app_role(required_role text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = required_role, false)
      or coalesce((auth.jwt() -> 'app_metadata' -> 'roles') ? required_role, false)
$$;

create or replace function app_private.current_user_is_superuser()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.has_app_role('superuser')
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'd@d.d'
$$;

create or replace function app_private.current_user_is_owner()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.current_user_is_superuser()
      or app_private.has_app_role('owner')
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'tim@timberfell.ca'
      -- Legacy role compatibility: old "admin" users become owner-level unless
      -- they are the protected superuser email above.
      or app_private.has_app_role('admin')
$$;

create or replace function app_private.current_user_is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.current_user_is_owner()
$$;

create or replace function app_private.current_user_is_billing_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.current_user_is_superuser()
$$;

create or replace function app_private.current_user_is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.current_user_is_superuser()
      or app_private.has_app_role('owner')
      or app_private.has_app_role('driver')
      or lower(coalesce(auth.jwt() ->> 'email', '')) in ('tim@timberfell.ca', 'beau@timberfell.ca')
      or app_private.has_app_role('staff')
      or app_private.has_app_role('admin')
$$;

create or replace function app_private.current_user_can_manage_storage()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.current_user_is_superuser()
$$;

create or replace function app_private.current_user_can_view_storage()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.current_user_is_owner()
$$;

create or replace function app_private.current_user_can_manage_revenue()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.current_user_is_superuser()
$$;

create or replace function app_private.current_user_can_manage_users()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.current_user_is_superuser()
$$;

revoke all on function app_private.has_app_role(text) from public, anon, authenticated;
revoke all on function app_private.current_user_is_superuser() from public, anon, authenticated;
revoke all on function app_private.current_user_is_owner() from public, anon, authenticated;
revoke all on function app_private.current_user_is_admin() from public, anon, authenticated;
revoke all on function app_private.current_user_is_billing_admin() from public, anon, authenticated;
revoke all on function app_private.current_user_is_staff() from public, anon, authenticated;
revoke all on function app_private.current_user_can_manage_storage() from public, anon, authenticated;
revoke all on function app_private.current_user_can_view_storage() from public, anon, authenticated;
revoke all on function app_private.current_user_can_manage_revenue() from public, anon, authenticated;
revoke all on function app_private.current_user_can_manage_users() from public, anon, authenticated;

grant execute on function app_private.has_app_role(text) to authenticated, service_role;
grant execute on function app_private.current_user_is_superuser() to authenticated, service_role;
grant execute on function app_private.current_user_is_owner() to authenticated, service_role;
grant execute on function app_private.current_user_is_admin() to authenticated, service_role;
grant execute on function app_private.current_user_is_billing_admin() to authenticated, service_role;
grant execute on function app_private.current_user_is_staff() to authenticated, service_role;
grant execute on function app_private.current_user_can_manage_storage() to authenticated, service_role;
grant execute on function app_private.current_user_can_view_storage() to authenticated, service_role;
grant execute on function app_private.current_user_can_manage_revenue() to authenticated, service_role;
grant execute on function app_private.current_user_can_manage_users() to authenticated, service_role;

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'superuser')
where lower(email) = 'd@d.d';

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'owner')
where lower(email) = 'tim@timberfell.ca';

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'driver')
where lower(email) = 'beau@timberfell.ca';

-- Storage occupancy is readable by owners, but storage mutation and billing
-- surfaces remain superuser-only.
drop policy if exists "staff can read storage units" on public.storage_units;
drop policy if exists "billing admins can manage storage units" on public.storage_units;
drop policy if exists "staff can read storage tenancies" on public.storage_tenancies;
drop policy if exists "billing admins can manage storage tenancies" on public.storage_tenancies;
drop policy if exists "staff can read storage payments" on public.storage_payments;
drop policy if exists "billing admins can manage storage payments" on public.storage_payments;
drop policy if exists "staff can read portable rentals" on public.portable_storage_rentals;
drop policy if exists "billing admins can manage portable rentals" on public.portable_storage_rentals;
drop policy if exists "staff can read portable payments" on public.portable_storage_payments;
drop policy if exists "billing admins can manage portable payments" on public.portable_storage_payments;
drop policy if exists "staff can read customer credits" on public.customer_credits;
drop policy if exists "billing admins can manage customer credits" on public.customer_credits;
drop policy if exists "billing admins can manage billing settings" on public.billing_settings;
drop policy if exists "billing admins can manage sms settings" on public.sms_settings;
drop policy if exists "billing admins can manage sms reminder log" on public.sms_reminder_log;

create policy "superusers can manage storage units"
on public.storage_units for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

create policy "owners can read storage units"
on public.storage_units for select
to authenticated
using ((select app_private.current_user_can_view_storage()));

create policy "superusers can manage storage tenancies"
on public.storage_tenancies for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

create policy "owners can read storage tenancies"
on public.storage_tenancies for select
to authenticated
using ((select app_private.current_user_can_view_storage()));

create policy "superusers can manage storage payments"
on public.storage_payments for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

create policy "superusers can manage portable rentals"
on public.portable_storage_rentals for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

create policy "owners can read portable rentals"
on public.portable_storage_rentals for select
to authenticated
using ((select app_private.current_user_can_view_storage()));

create policy "superusers can manage portable payments"
on public.portable_storage_payments for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

create policy "superusers can manage customer credits"
on public.customer_credits for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

create policy "superusers can manage billing settings"
on public.billing_settings for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

create policy "superusers can manage sms settings"
on public.sms_settings for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

create policy "superusers can manage sms reminder log"
on public.sms_reminder_log for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

-- Tables created after the original role-tightening migration.
drop policy if exists "authenticated full access" on public.storage_unit_positions;
create policy "superusers can manage storage unit positions"
on public.storage_unit_positions for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

drop policy if exists "staff can manage storage customer notes" on public.storage_customer_notes;
drop policy if exists "staff can manage storage customer check fields" on public.storage_customer_check_fields;
drop policy if exists "staff can manage storage customer check values" on public.storage_customer_check_values;

create policy "superusers can manage storage customer notes"
on public.storage_customer_notes for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

create policy "superusers can manage storage customer check fields"
on public.storage_customer_check_fields for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

create policy "superusers can manage storage customer check values"
on public.storage_customer_check_values for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

drop policy if exists "staff can read storage late fees" on public.storage_late_fees;
drop policy if exists "billing admins can manage storage late fees" on public.storage_late_fees;
create policy "superusers can manage storage late fees"
on public.storage_late_fees for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

drop policy if exists "staff can read storage portal payment sessions" on public.storage_portal_payment_sessions;
drop policy if exists "billing admins can manage storage portal payment sessions" on public.storage_portal_payment_sessions;
create policy "superusers can manage storage portal payment sessions"
on public.storage_portal_payment_sessions for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

drop policy if exists "staff can read storage booking sessions" on public.storage_booking_sessions;
drop policy if exists "billing admins can manage storage booking sessions" on public.storage_booking_sessions;
create policy "superusers can manage storage booking sessions"
on public.storage_booking_sessions for all
to authenticated
using ((select app_private.current_user_can_manage_storage()))
with check ((select app_private.current_user_can_manage_storage()));

-- Admin revenue/payment tables: no more authenticated-wide access.
grant select, insert, update, delete on table public.admin_revenue_receipts to authenticated;
grant select, insert, update, delete on table public.admin_payment_received to authenticated;
grant select, insert, update, delete on table public.admin_payment_hidden to authenticated;
grant select, insert, update, delete on table public.admin_manual_payments to authenticated;

drop policy if exists "authenticated_all_admin_revenue_receipts" on public.admin_revenue_receipts;
drop policy if exists "authenticated_all_admin_payment_received" on public.admin_payment_received;
drop policy if exists "authenticated_all_admin_payment_hidden" on public.admin_payment_hidden;
drop policy if exists "authenticated_all_admin_manual_payments" on public.admin_manual_payments;

create policy "superusers can manage admin revenue receipts"
on public.admin_revenue_receipts for all
to authenticated
using ((select app_private.current_user_can_manage_revenue()))
with check ((select app_private.current_user_can_manage_revenue()));

create policy "superusers can manage admin payment received"
on public.admin_payment_received for all
to authenticated
using ((select app_private.current_user_can_manage_revenue()))
with check ((select app_private.current_user_can_manage_revenue()));

create policy "superusers can manage admin payment hidden"
on public.admin_payment_hidden for all
to authenticated
using ((select app_private.current_user_can_manage_revenue()))
with check ((select app_private.current_user_can_manage_revenue()));

create policy "superusers can manage admin manual payments"
on public.admin_manual_payments for all
to authenticated
using ((select app_private.current_user_can_manage_revenue()))
with check ((select app_private.current_user_can_manage_revenue()));

-- Notifications: drivers should not read operational/admin inbox rows directly.
-- Billing/storage notifications are superuser-only.
drop policy if exists "staff can read app notifications" on public.app_notifications;
drop policy if exists "users can insert own notification reads" on public.app_notification_reads;

create policy "role scoped app notifications"
on public.app_notifications for select
to authenticated
using (
  (audience = 'admin' and (select app_private.current_user_is_owner()))
  or (audience = 'billing' and (select app_private.current_user_is_billing_admin()))
  or (audience = 'staff' and (select app_private.current_user_is_owner()))
);

create policy "users can insert own notification reads"
on public.app_notification_reads for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_notifications n
    where n.id = notification_id
      and (
        (n.audience = 'admin' and (select app_private.current_user_is_owner()))
        or (n.audience = 'billing' and (select app_private.current_user_is_billing_admin()))
        or (n.audience = 'staff' and (select app_private.current_user_is_owner()))
      )
  )
);
