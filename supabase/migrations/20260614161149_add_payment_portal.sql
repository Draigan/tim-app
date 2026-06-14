alter table public.customers
  add column if not exists payment_pin char(5);

alter table public.customers
  alter column payment_pin set default lpad((floor(random() * 100000))::int::text, 5, '0');

update public.customers
set payment_pin = lpad((floor(random() * 100000))::int::text, 5, '0')
where payment_pin is null;

alter table public.customers
  alter column payment_pin set not null;

alter table public.customers
  add constraint customers_payment_pin_format
  check (payment_pin ~ '^\d{5}$');

grant select (payment_pin) on table public.customers to authenticated;

create table public.storage_portal_payment_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'expired', 'failed')),
  selected_count integer not null check (selected_count between 1 and 24),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  subtotal_amount numeric not null default 0 check (subtotal_amount >= 0),
  tax_amount numeric not null default 0 check (tax_amount >= 0),
  amount numeric not null default 0 check (amount >= 0),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  expires_at timestamptz,
  paid_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index storage_portal_payment_sessions_customer_id_idx
  on public.storage_portal_payment_sessions(customer_id);

create index storage_portal_payment_sessions_status_idx
  on public.storage_portal_payment_sessions(status);

create or replace function public.set_storage_portal_payment_sessions_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger storage_portal_payment_sessions_set_updated_at
before update on public.storage_portal_payment_sessions
for each row
execute function public.set_storage_portal_payment_sessions_updated_at();

alter table public.storage_portal_payment_sessions enable row level security;

grant select, insert, update, delete on table public.storage_portal_payment_sessions to authenticated;
grant all privileges on table public.storage_portal_payment_sessions to service_role;

create policy "staff can read storage portal payment sessions"
on public.storage_portal_payment_sessions for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "billing admins can manage storage portal payment sessions"
on public.storage_portal_payment_sessions for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));
