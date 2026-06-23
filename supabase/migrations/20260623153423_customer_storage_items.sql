alter table public.storage_tenancies
  alter column unit_id drop not null,
  add column if not exists storage_kind text not null default 'fixed_unit',
  add column if not exists item_type text,
  add column if not exists custom_item_type text,
  add column if not exists item_label text;

do $$
begin
  alter table public.storage_tenancies
    add constraint storage_tenancies_storage_kind_check
    check (storage_kind in ('fixed_unit', 'customer_item'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.storage_tenancies
    add constraint storage_tenancies_item_type_check
    check (item_type is null or item_type in ('boat', 'trailer', 'rv', 'custom'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.storage_tenancies
    add constraint storage_tenancies_storage_kind_shape_check
    check (
      (storage_kind = 'fixed_unit' and unit_id is not null)
      or
      (
        storage_kind = 'customer_item'
        and unit_id is null
        and item_type is not null
        and (item_type <> 'custom' or nullif(btrim(custom_item_type), '') is not null)
        and nullif(btrim(item_label), '') is not null
      )
    );
exception
  when duplicate_object then null;
end $$;

create index if not exists storage_tenancies_customer_item_idx
  on public.storage_tenancies(storage_kind, end_date, customer_id);

alter table public.sms_reminder_log
  drop constraint if exists sms_reminder_log_unit_type_check;

alter table public.sms_reminder_log
  add constraint sms_reminder_log_unit_type_check
  check (unit_type in ('fixed', 'portable', 'customer_item'));
