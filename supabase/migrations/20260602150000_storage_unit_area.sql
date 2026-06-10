alter table storage_units
  add column if not exists area text check (area in ('up_top', 'down_below'));
