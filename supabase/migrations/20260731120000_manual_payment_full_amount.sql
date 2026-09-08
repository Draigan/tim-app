-- Some cash entries are money owed back in full, not revenue to split.
-- Reimbursements (Tim says "write down $50 for the tickets you bought") should
-- credit the whole amount instead of the usual 25% admin share.
alter table public.admin_manual_payments
  add column if not exists full_amount boolean not null default false;
