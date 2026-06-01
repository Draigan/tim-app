-- Tighten broad authenticated RLS policies into app-role based policies.
-- App roles must live in auth.users.raw_app_meta_data, surfaced as JWT app_metadata.

create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

create or replace function app_private.has_app_role(required_role text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = required_role, false)
      or coalesce((auth.jwt() -> 'app_metadata' -> 'roles') ? required_role, false)
$$;

create or replace function app_private.current_user_is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.has_app_role('admin')
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'tim@timberfell.ca'
$$;

create or replace function app_private.current_user_is_billing_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.current_user_is_admin()
      or app_private.has_app_role('billing')
      or app_private.has_app_role('billing_admin')
$$;

create or replace function app_private.current_user_is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.role() = 'authenticated'
$$;

revoke all on function app_private.has_app_role(text) from public, anon, authenticated;
revoke all on function app_private.current_user_is_admin() from public, anon, authenticated;
revoke all on function app_private.current_user_is_billing_admin() from public, anon, authenticated;
revoke all on function app_private.current_user_is_staff() from public, anon, authenticated;

grant execute on function app_private.has_app_role(text) to authenticated, service_role;
grant execute on function app_private.current_user_is_admin() to authenticated, service_role;
grant execute on function app_private.current_user_is_billing_admin() to authenticated, service_role;
grant execute on function app_private.current_user_is_staff() to authenticated, service_role;

-- The anon role does not need direct Data API table access for this internal app.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;

-- Keep only Data API privileges authenticated clients need; RLS decides rows/actions.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on table
  public.asset_types,
  public.assets,
  public.calendar_events,
  public.deployments,
  public.feedback,
  public.messages,
  public.push_subscriptions,
  public.reservations,
  public.customers,
  public.storage_units,
  public.storage_payments,
  public.portable_storage_rentals,
  public.portable_storage_payments,
  public.sms_settings,
  public.sms_reminder_log,
  public.billing_settings,
  public.storage_tenancies,
  public.customer_credits
to authenticated;

-- Staff can manage customer contact records, but Stripe identifiers stay server-only.
revoke insert, update on table public.customers from authenticated;
grant insert (name, phone, email, address, notes, pin) on table public.customers to authenticated;
grant update (name, phone, email, address, notes, archived_at, pin) on table public.customers to authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- Make view access run through the caller's RLS policies.
alter view if exists public.active_storage_tenancies set (security_invoker = true);
alter view if exists public.active_deployments set (security_invoker = true);
alter view if exists public.yard_assets set (security_invoker = true);

-- The event trigger can still call this function; API roles should not execute it.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'asset_types',
        'assets',
        'calendar_events',
        'deployments',
        'feedback',
        'messages',
        'push_subscriptions',
        'reservations',
        'customers',
        'storage_units',
        'storage_payments',
        'portable_storage_rentals',
        'portable_storage_payments',
        'sms_settings',
        'sms_reminder_log',
        'billing_settings',
        'storage_tenancies',
        'customer_credits'
      ])
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end $$;

alter table public.asset_types enable row level security;
alter table public.assets enable row level security;
alter table public.calendar_events enable row level security;
alter table public.deployments enable row level security;
alter table public.feedback enable row level security;
alter table public.messages enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reservations enable row level security;
alter table public.customers enable row level security;
alter table public.storage_units enable row level security;
alter table public.storage_payments enable row level security;
alter table public.portable_storage_rentals enable row level security;
alter table public.portable_storage_payments enable row level security;
alter table public.sms_settings enable row level security;
alter table public.sms_reminder_log enable row level security;
alter table public.billing_settings enable row level security;
alter table public.storage_tenancies enable row level security;
alter table public.customer_credits enable row level security;

-- Inventory/catalog: staff can view; admins manage definitions and assets.
create policy "staff can read asset types"
on public.asset_types for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "admins can manage asset types"
on public.asset_types for all
to authenticated
using ((select app_private.current_user_is_admin()))
with check ((select app_private.current_user_is_admin()));

create policy "staff can read assets"
on public.assets for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "admins can manage assets"
on public.assets for all
to authenticated
using ((select app_private.current_user_is_admin()))
with check ((select app_private.current_user_is_admin()));

-- Field operations: staff need to deploy and pick up assets.
create policy "staff can manage deployments"
on public.deployments for all
to authenticated
using ((select app_private.current_user_is_staff()))
with check ((select app_private.current_user_is_staff()));

-- Reservations and calendar are admin-managed, but reservations are readable for scheduling context.
create policy "staff can read reservations"
on public.reservations for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "admins can manage reservations"
on public.reservations for all
to authenticated
using ((select app_private.current_user_is_admin()))
with check ((select app_private.current_user_is_admin()));

create policy "admins can manage calendar events"
on public.calendar_events for all
to authenticated
using ((select app_private.current_user_is_admin()))
with check ((select app_private.current_user_is_admin()));

-- Customer contacts are internal shared records. Sensitive Stripe columns are blocked by grants above.
create policy "staff can read customers"
on public.customers for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "staff can create customers"
on public.customers for insert
to authenticated
with check ((select app_private.current_user_is_staff()));

create policy "staff can update customers"
on public.customers for update
to authenticated
using ((select app_private.current_user_is_staff()))
with check ((select app_private.current_user_is_staff()));

create policy "admins can delete customers"
on public.customers for delete
to authenticated
using ((select app_private.current_user_is_admin()));

-- Storage billing surfaces: staff can see status; admin/billing roles mutate money-related rows.
create policy "staff can read storage units"
on public.storage_units for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "billing admins can manage storage units"
on public.storage_units for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));

create policy "staff can read storage tenancies"
on public.storage_tenancies for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "billing admins can manage storage tenancies"
on public.storage_tenancies for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));

create policy "staff can read storage payments"
on public.storage_payments for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "billing admins can manage storage payments"
on public.storage_payments for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));

create policy "staff can read portable rentals"
on public.portable_storage_rentals for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "billing admins can manage portable rentals"
on public.portable_storage_rentals for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));

create policy "staff can read portable payments"
on public.portable_storage_payments for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "billing admins can manage portable payments"
on public.portable_storage_payments for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));

create policy "staff can read customer credits"
on public.customer_credits for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "billing admins can manage customer credits"
on public.customer_credits for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));

create policy "billing admins can manage billing settings"
on public.billing_settings for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));

create policy "billing admins can manage sms settings"
on public.sms_settings for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));

create policy "billing admins can manage sms reminder log"
on public.sms_reminder_log for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));

-- Feedback is write-only for staff, visible/manageable by admins.
create policy "staff can send feedback"
on public.feedback for insert
to authenticated
with check ((select app_private.current_user_is_staff()));

create policy "admins can manage feedback"
on public.feedback for all
to authenticated
using ((select app_private.current_user_is_admin()))
with check ((select app_private.current_user_is_admin()));

-- Chat and push notification records stay user-scoped where appropriate.
create policy "staff can read messages"
on public.messages for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "users can insert own messages"
on public.messages for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "users manage own push subscriptions"
on public.push_subscriptions for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
