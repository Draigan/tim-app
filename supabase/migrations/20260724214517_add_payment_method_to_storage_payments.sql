alter table public.storage_payments
  add column if not exists payment_method text;

alter table public.storage_payments
  drop constraint if exists storage_payments_payment_method_check;

alter table public.storage_payments
  add constraint storage_payments_payment_method_check
  check (payment_method in ('stripe', 'cash'));

comment on column public.storage_payments.payment_method
  is 'How this payment was received: stripe for card/online payments, cash for recorded cash payments. Legacy rows are best-effort backfilled.';

update public.storage_payments
set payment_method = case
  when coalesce(tax_amount, 0) > 0 then 'stripe'
  else 'cash'
end
where payment_method is null;

create index if not exists storage_payments_payment_method_idx
  on public.storage_payments(payment_method);

alter table public.portable_storage_payments
  add column if not exists payment_method text;

alter table public.portable_storage_payments
  drop constraint if exists portable_storage_payments_payment_method_check;

alter table public.portable_storage_payments
  add constraint portable_storage_payments_payment_method_check
  check (payment_method in ('stripe', 'cash'));

comment on column public.portable_storage_payments.payment_method
  is 'How this payment was received: stripe for card/online payments, cash for recorded cash payments. Legacy rows are best-effort backfilled.';

update public.portable_storage_payments
set payment_method = case
  when coalesce(tax_amount, 0) > 0 then 'stripe'
  else 'cash'
end
where payment_method is null;

create index if not exists portable_storage_payments_payment_method_idx
  on public.portable_storage_payments(payment_method);
