create table public.storage_booking_sessions (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'expired', 'failed')),
  unit_type text not null check (unit_type in ('fixed', 'portable')),
  unit_number text,
  unit_label text not null,
  unit_size text,
  unit_id uuid references public.storage_units(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  tenancy_id uuid references public.storage_tenancies(id) on delete set null,
  portable_rental_id uuid references public.portable_storage_rentals(id) on delete set null,
  first_name text not null,
  last_name text,
  customer_name text not null,
  phone text,
  email text not null,
  service_address text,
  city text,
  province text,
  country text,
  postal_code text,
  start_date date not null,
  billing_day integer not null check (billing_day between 1 and 31),
  monthly_rate numeric not null default 0 check (monthly_rate >= 0),
  rent_amount numeric not null default 0 check (rent_amount >= 0),
  delivery_fee_amount numeric not null default 0 check (delivery_fee_amount >= 0),
  pickup_fee_amount numeric not null default 0 check (pickup_fee_amount >= 0),
  subtotal_amount numeric not null default 0 check (subtotal_amount >= 0),
  tax_amount numeric not null default 0 check (tax_amount >= 0),
  amount numeric not null default 0 check (amount >= 0),
  tax_rate numeric not null default 0 check (tax_rate >= 0),
  tax_label text,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  stripe_payment_method_id text,
  expires_at timestamptz,
  paid_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (unit_type = 'fixed' and unit_id is not null and asset_id is null)
    or
    (unit_type = 'portable' and asset_id is not null and unit_id is null)
  )
);

create unique index storage_booking_sessions_pending_unit_idx
  on public.storage_booking_sessions(unit_id)
  where unit_id is not null and status = 'pending';

create unique index storage_booking_sessions_pending_asset_idx
  on public.storage_booking_sessions(asset_id)
  where asset_id is not null and status = 'pending';

create index storage_booking_sessions_status_idx
  on public.storage_booking_sessions(status);

create index storage_booking_sessions_customer_id_idx
  on public.storage_booking_sessions(customer_id);

create index storage_booking_sessions_created_at_idx
  on public.storage_booking_sessions(created_at desc);

create or replace function public.set_storage_booking_sessions_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger storage_booking_sessions_set_updated_at
before update on public.storage_booking_sessions
for each row
execute function public.set_storage_booking_sessions_updated_at();

alter table public.storage_booking_sessions enable row level security;

grant select, insert, update, delete on table public.storage_booking_sessions to authenticated;
grant all privileges on table public.storage_booking_sessions to service_role;

create policy "staff can read storage booking sessions"
on public.storage_booking_sessions for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "billing admins can manage storage booking sessions"
on public.storage_booking_sessions for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));
