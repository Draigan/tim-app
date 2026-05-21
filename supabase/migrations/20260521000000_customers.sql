-- Customers table
create table customers (
  id         uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name  text,
  phone      text,
  email      text,
  notes      text,
  created_at timestamptz default now()
);

alter table customers enable row level security;
create policy "authenticated full access" on customers
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- Link deployments to customers (nullable — old records stay as-is)
alter table deployments
  add column customer_id uuid references customers(id) on delete set null;
