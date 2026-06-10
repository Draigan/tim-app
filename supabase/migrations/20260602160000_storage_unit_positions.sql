create table storage_unit_positions (
  unit_id  uuid not null references storage_units(id) on delete cascade,
  area     text not null check (area in ('up_top', 'down_below')),
  x        float not null default 0,
  y        float not null default 0,
  rotation int   not null default 0 check (rotation in (0, 90)),
  primary key (unit_id, area)
);

alter table storage_unit_positions enable row level security;
create policy "authenticated full access" on storage_unit_positions
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
