-- ─────────────────────────────────────────────────────────────────────────────
-- Portable storage: bind each payment to the rental that earned it, and keep
-- rental history instead of deleting it.
--
-- Root cause this fixes: portable_storage_payments were keyed only to asset_id,
-- and vacating a pod hard-deleted its portable_storage_rentals row. A pod's
-- payment history therefore carried over to whoever rented it next, and the
-- delete also nulled storage_booking_sessions.portable_rental_id (FK is
-- "on delete set null") and cascade-deleted that renter's storage_late_fees.
--
-- This migration only ADDS columns and a nullable attribution link. No payment
-- amount, paid_at, or row is modified or deleted. Payments that cannot be
-- attributed with certainty are left NULL (unattributed) rather than credited
-- to the wrong renter.
--
-- Safe to run in a single transaction — if anything fails it rolls back.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. Rentals get a soft close, matching storage_tenancies ──────────────────
alter table public.portable_storage_rentals
  add column if not exists end_date date;

comment on column public.portable_storage_rentals.end_date
  is 'Move-out date. NULL means this is the pod''s current renter. Ended rentals are kept as history so their payments stay attributed to them.';

-- One *active* rental per pod; ended rentals accumulate behind it.
alter table public.portable_storage_rentals
  drop constraint if exists portable_storage_rentals_asset_id_key;

create unique index if not exists portable_storage_rentals_active_asset_idx
  on public.portable_storage_rentals (asset_id)
  where end_date is null;

create index if not exists portable_storage_rentals_end_date_idx
  on public.portable_storage_rentals (end_date);

-- ── 2. Payments point at a rental, not just a pod ────────────────────────────
alter table public.portable_storage_payments
  add column if not exists rental_id uuid
  references public.portable_storage_rentals(id) on delete set null;

comment on column public.portable_storage_payments.rental_id
  is 'The rental this payment belongs to. NULL means unattributed: the payment predates rental history being kept, and the renter who made it is not recorded. Never assume a NULL row belongs to the pod''s current renter.';

create index if not exists portable_storage_payments_rental_id_idx
  on public.portable_storage_payments (rental_id);

-- ── 3. Conservative backfill ─────────────────────────────────────────────────
-- Claim a payment for the current rental only when BOTH hold:
--   a) its period is on or after that renter's move-in month, and
--   b) the money actually arrived on or after the rental was created.
--
-- (b) matters: a previous renter can prepay a month and move out before it
-- starts. On pod p8, "Eddy mto site" prepaid 2026-08 on 2026-07-13 and left on
-- 2026-07-22; Jason Truax moved in 2026-08-28. The period test alone would hand
-- Eddy's prepayment to Jason. Anything failing either test stays NULL for human
-- review.
update public.portable_storage_payments psp
set rental_id = psr.id
from public.portable_storage_rentals psr
where psp.asset_id = psr.asset_id
  and psr.end_date is null
  and psp.rental_id is null
  and psr.move_in_date is not null
  and psp.period_label ~ '^\d{4}-\d{2}$'
  and psp.period_label >= to_char(psr.move_in_date, 'YYYY-MM')
  and psp.paid_at >= psr.created_at;

-- ── 4. Uniqueness moves from the pod to the rental ───────────────────────────
-- Keeping (asset_id, period_label) would stop a new renter from paying for a
-- month a previous renter already paid on that same pod.
alter table public.portable_storage_payments
  drop constraint if exists portable_storage_payments_asset_id_period_label_key;

alter table public.portable_storage_payments
  add constraint portable_storage_payments_rental_id_period_label_key
  unique (rental_id, period_label);

-- ── 5. Active-rental view, mirroring active_storage_tenancies ────────────────
create or replace view public.active_portable_storage_rentals as
  select * from public.portable_storage_rentals where end_date is null;

alter view public.active_portable_storage_rentals set (security_invoker = true);

grant select on public.active_portable_storage_rentals to authenticated;
grant all privileges on public.active_portable_storage_rentals to service_role;

commit;
