alter table public.storage_payments
  add column if not exists subtotal_amount numeric,
  add column if not exists tax_amount numeric not null default 0,
  add column if not exists tax_rate numeric not null default 0,
  add column if not exists tax_label text;

alter table public.portable_storage_payments
  add column if not exists subtotal_amount numeric,
  add column if not exists tax_amount numeric not null default 0,
  add column if not exists tax_rate numeric not null default 0,
  add column if not exists tax_label text;

update public.storage_payments
set subtotal_amount = amount
where subtotal_amount is null
  and amount is not null;

update public.portable_storage_payments
set subtotal_amount = amount
where subtotal_amount is null
  and amount is not null;
