create table if not exists public.admin_manual_payments (
  id uuid primary key default gen_random_uuid(),
  amount decimal(10, 2) not null check (amount > 0),
  note text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.admin_manual_payments enable row level security;

create policy "authenticated_all_admin_manual_payments"
on public.admin_manual_payments for all
to authenticated
using (true)
with check (true);

grant select, insert, update, delete on table public.admin_manual_payments to authenticated;
grant select, insert, update, delete on table public.admin_payment_received to authenticated;
grant select, insert, update, delete on table public.admin_payment_hidden to authenticated;

alter table public.admin_payment_received
  drop constraint if exists admin_payment_received_payment_type_check;

alter table public.admin_payment_received
  add constraint admin_payment_received_payment_type_check
  check (payment_type in ('fixed', 'portable', 'manual'));

alter table public.admin_payment_hidden
  drop constraint if exists admin_payment_hidden_payment_type_check;

alter table public.admin_payment_hidden
  add constraint admin_payment_hidden_payment_type_check
  check (payment_type in ('fixed', 'portable', 'manual'));
