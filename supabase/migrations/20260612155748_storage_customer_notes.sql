create table public.storage_customer_notes (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create table public.storage_customer_check_fields (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.storage_customer_check_values (
  customer_id uuid not null references public.customers(id) on delete cascade,
  field_id uuid not null references public.storage_customer_check_fields(id) on delete cascade,
  checked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (customer_id, field_id)
);

alter table public.storage_customer_notes enable row level security;
alter table public.storage_customer_check_fields enable row level security;
alter table public.storage_customer_check_values enable row level security;

grant select, insert, update, delete on table public.storage_customer_notes to authenticated;
grant select, insert, update, delete on table public.storage_customer_check_fields to authenticated;
grant select, insert, update, delete on table public.storage_customer_check_values to authenticated;

create policy "staff can manage storage customer notes"
on public.storage_customer_notes for all
to authenticated
using ((select app_private.current_user_is_staff()))
with check ((select app_private.current_user_is_staff()));

create policy "staff can manage storage customer check fields"
on public.storage_customer_check_fields for all
to authenticated
using ((select app_private.current_user_is_staff()))
with check ((select app_private.current_user_is_staff()));

create policy "staff can manage storage customer check values"
on public.storage_customer_check_values for all
to authenticated
using ((select app_private.current_user_is_staff()))
with check ((select app_private.current_user_is_staff()));

create index storage_customer_check_fields_active_idx
  on public.storage_customer_check_fields(sort_order, created_at)
  where archived_at is null;

create index storage_customer_check_values_field_id_idx
  on public.storage_customer_check_values(field_id);
