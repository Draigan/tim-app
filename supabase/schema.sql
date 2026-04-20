-- Asset types (user-manageable list)
create table asset_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  icon text default '📦',
  created_at timestamptz default now()
);

insert into asset_types (name, icon) values
  ('Dumpster', '🗑️'),
  ('Portable Storage', '📦'),
  ('Portable Toilet', '🚽'),
  ('Trailer', '🚛');

-- Physical asset inventory
create table assets (
  id uuid primary key default gen_random_uuid(),
  asset_type_id uuid not null references asset_types(id),
  size text,
  label text not null,
  notes text,
  created_at timestamptz default now()
);

-- Job site deployments — one row per placement, history preserved
create table deployments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id),
  address text not null,
  lat float not null,
  lng float not null,
  customer_name text,
  customer_phone text,
  notes text,
  dropped_at timestamptz default now(),
  expires_at date,
  picked_up_at timestamptz,
  created_at timestamptz default now()
);

-- RLS: authenticated users have full access
alter table asset_types enable row level security;
alter table assets enable row level security;
alter table deployments enable row level security;

create policy "authenticated full access" on asset_types
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "authenticated full access" on assets
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "authenticated full access" on deployments
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- Convenience view: assets currently in yard (no active deployment)
create view yard_assets as
  select a.*, t.name as type_name
  from assets a
  join asset_types t on t.id = a.asset_type_id
  where not exists (
    select 1 from deployments d
    where d.asset_id = a.id and d.picked_up_at is null
  );

-- Convenience view: active deployments with asset + type info
create view active_deployments as
  select
    d.*,
    a.label, a.size, a.notes as asset_notes, a.asset_type_id,
    t.name as type_name, t.icon as type_icon
  from deployments d
  join assets a on a.id = d.asset_id
  join asset_types t on t.id = a.asset_type_id
  where d.picked_up_at is null;
