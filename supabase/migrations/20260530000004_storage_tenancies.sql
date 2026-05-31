-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: introduce storage_tenancies
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is safe to run in a single transaction — if anything fails it rolls back.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. New table ──────────────────────────────────────────────────────────────
create table storage_tenancies (
  id               uuid primary key default gen_random_uuid(),
  unit_id          uuid not null references storage_units(id) on delete cascade,
  customer_id      uuid references customers(id) on delete set null,
  tenant_name      text,
  tenant_phone     text,
  monthly_rate     numeric,
  billing_day      integer check (billing_day >= 1 and billing_day <= 31),
  payment_frequency text,
  move_in_date     date,
  end_date         date,
  notes            text,
  created_at       timestamptz default now()
);

alter table storage_tenancies enable row level security;
create policy "authenticated full access" on storage_tenancies
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create index storage_tenancies_unit_id_idx      on storage_tenancies(unit_id);
create index storage_tenancies_customer_id_idx  on storage_tenancies(customer_id);
create index storage_tenancies_end_date_idx     on storage_tenancies(end_date);

-- ── 2. Convenience view: the one active tenancy per unit ──────────────────────
create view active_storage_tenancies as
  select * from storage_tenancies where end_date is null;

-- ── 3. Migrate existing occupied units → tenancy rows ────────────────────────
insert into storage_tenancies (
  unit_id, customer_id, tenant_name, tenant_phone,
  monthly_rate, billing_day, payment_frequency, move_in_date, notes
)
select
  id, customer_id, tenant_name, tenant_phone,
  monthly_rate, billing_day, payment_frequency, move_in_date, notes
from storage_units
where customer_id is not null or tenant_name is not null;

-- ── 4. For vacant units that still have orphaned payments, create a closed tenancy
--       so those payments have a home and don't get lost.
insert into storage_tenancies (unit_id, end_date)
select distinct sp.unit_id, current_date
from storage_payments sp
where not exists (
  select 1 from storage_tenancies st where st.unit_id = sp.unit_id
);

-- ── 5. Wire storage_payments to tenancies ─────────────────────────────────────
alter table storage_payments
  add column tenancy_id uuid references storage_tenancies(id) on delete set null;

-- Each payment links to the one tenancy for that unit (there is only ever one
-- at this point in the migration).
update storage_payments sp
set tenancy_id = st.id
from storage_tenancies st
where sp.unit_id = st.unit_id;

-- ── 6. Swap the unique constraint from (unit_id, period_label) → (tenancy_id, period_label)
alter table storage_payments
  drop constraint if exists storage_payments_unit_id_period_label_key;

alter table storage_payments
  add constraint storage_payments_tenancy_id_period_label_key
  unique (tenancy_id, period_label);

-- ── 7. Drop the tenant columns that have moved to storage_tenancies ────────────
alter table storage_units
  drop column if exists customer_id,
  drop column if exists tenant_name,
  drop column if exists tenant_phone,
  drop column if exists monthly_rate,
  drop column if exists billing_day,
  drop column if exists payment_frequency,
  drop column if exists move_in_date,
  drop column if exists notes;

commit;
