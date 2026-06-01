create table customer_credits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  source_tenancy_id uuid references storage_tenancies(id) on delete set null,
  source_unit_id uuid references storage_units(id) on delete set null,
  amount numeric not null check (amount >= 0),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'refunded', 'applied', 'void')),
  period_labels text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table customer_credits enable row level security;
create policy "authenticated full access" on customer_credits
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create index customer_credits_customer_id_idx on customer_credits(customer_id);
create index customer_credits_status_idx on customer_credits(status);
