create table public.storage_late_fees (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid references public.storage_tenancies(id) on delete cascade,
  portable_rental_id uuid references public.portable_storage_rentals(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete cascade,
  period_label text not null check (period_label ~ '^\d{4}-\d{2}$'),
  rate numeric not null default 0.20 check (rate >= 0),
  amount numeric not null check (amount >= 0),
  status text not null default 'open' check (status in ('open', 'paid', 'waived')),
  applied_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (tenancy_id is not null and portable_rental_id is null and asset_id is null)
    or
    (tenancy_id is null and portable_rental_id is not null and asset_id is not null)
  )
);

alter table public.storage_late_fees
  add constraint storage_late_fees_tenancy_period_key
  unique (tenancy_id, period_label);

alter table public.storage_late_fees
  add constraint storage_late_fees_portable_period_key
  unique (portable_rental_id, period_label);

create index storage_late_fees_status_idx
  on public.storage_late_fees(status);

create index storage_late_fees_asset_id_idx
  on public.storage_late_fees(asset_id)
  where asset_id is not null;

create or replace function public.set_storage_late_fees_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger storage_late_fees_set_updated_at
before update on public.storage_late_fees
for each row
execute function public.set_storage_late_fees_updated_at();

alter table public.storage_late_fees enable row level security;

grant select, insert, update, delete on table public.storage_late_fees to authenticated;
grant all privileges on table public.storage_late_fees to service_role;

create policy "staff can read storage late fees"
on public.storage_late_fees for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "billing admins can manage storage late fees"
on public.storage_late_fees for all
to authenticated
using ((select app_private.current_user_is_billing_admin()))
with check ((select app_private.current_user_is_billing_admin()));
