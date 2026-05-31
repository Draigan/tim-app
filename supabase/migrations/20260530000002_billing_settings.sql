create table billing_settings (
  id int primary key default 1,
  auto_charge_enabled boolean not null default false,
  constraint single_row check (id = 1)
);

insert into billing_settings (id, auto_charge_enabled) values (1, false);

alter table billing_settings enable row level security;
create policy "authenticated full access" on billing_settings
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
