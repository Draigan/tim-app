-- ─────────────────────────────────────────────────────────────────────────────
-- Add e-Transfer as a first-class payment method.
--
-- Customers sometimes send an Interac e-Transfer to Tim's email. That money is
-- received outside Stripe (no card is charged) but it lands in the bank and must
-- reach the accountant, unlike physical cash, which is reconciled outside this
-- app entirely.
--
-- payment_reference holds the sender name or confirmation number that comes with
-- an e-transfer, so a line in the Xero export can be matched to a bank deposit.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.storage_payments
  drop constraint if exists storage_payments_payment_method_check;
alter table public.storage_payments
  add constraint storage_payments_payment_method_check
  check (payment_method in ('stripe', 'cash', 'etransfer'));

alter table public.portable_storage_payments
  drop constraint if exists portable_storage_payments_payment_method_check;
alter table public.portable_storage_payments
  add constraint portable_storage_payments_payment_method_check
  check (payment_method in ('stripe', 'cash', 'etransfer'));

comment on column public.storage_payments.payment_method
  is 'How this payment was received: stripe (card), etransfer (Interac to Tim''s email — banked, goes to the accountant), or cash (reconciled outside this app). Legacy rows are best-effort backfilled.';
comment on column public.portable_storage_payments.payment_method
  is 'How this payment was received: stripe (card), etransfer (Interac to Tim''s email — banked, goes to the accountant), or cash (reconciled outside this app). Legacy rows are best-effort backfilled.';

alter table public.storage_payments
  add column if not exists payment_reference text;
alter table public.portable_storage_payments
  add column if not exists payment_reference text;

comment on column public.storage_payments.payment_reference
  is 'Free text identifying the payment outside this app - for an e-transfer, the sender name or confirmation number, so the accountant can match it to a bank deposit.';
comment on column public.portable_storage_payments.payment_reference
  is 'Free text identifying the payment outside this app - for an e-transfer, the sender name or confirmation number, so the accountant can match it to a bank deposit.';

commit;
