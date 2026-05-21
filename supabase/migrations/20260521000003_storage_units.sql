create table storage_units (
  id               uuid primary key default gen_random_uuid(),
  unit_number      text not null,
  tenant_name      text,
  tenant_phone     text,
  monthly_rate     numeric,
  billing_day      int check (billing_day between 1 and 31),
  payment_frequency text check (payment_frequency in ('monthly', 'weekly', 'one_time', 'other')),
  move_in_date     date,
  notes            text,
  created_at       timestamptz default now()
);

alter table storage_units enable row level security;
create policy "authenticated full access" on storage_units
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create table storage_payments (
  id           uuid primary key default gen_random_uuid(),
  unit_id      uuid not null references storage_units(id) on delete cascade,
  period_label text not null,
  paid_at      timestamptz default now(),
  amount       numeric,
  unique (unit_id, period_label)
);

alter table storage_payments enable row level security;
create policy "authenticated full access" on storage_payments
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
