alter table asset_types add column if not exists is_storage boolean not null default false;

create table portable_storage_rentals (
  id               uuid primary key default gen_random_uuid(),
  asset_id         uuid unique not null references assets(id) on delete cascade,
  customer_id      uuid references customers(id) on delete set null,
  tenant_name      text,
  tenant_phone     text,
  monthly_rate     numeric,
  billing_day      int check (billing_day between 1 and 31),
  payment_frequency text check (payment_frequency in ('monthly', 'weekly', 'one_time', 'other')),
  move_in_date     date,
  notes            text,
  created_at       timestamptz default now()
);

create table portable_storage_payments (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references assets(id) on delete cascade,
  period_label text not null,
  paid_at      timestamptz default now(),
  amount       numeric,
  unique (asset_id, period_label)
);

alter table portable_storage_rentals enable row level security;
alter table portable_storage_payments enable row level security;

create policy "authenticated full access" on portable_storage_rentals
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on portable_storage_payments
  for all to authenticated using (true) with check (true);
