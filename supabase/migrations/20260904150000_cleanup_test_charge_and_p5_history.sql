-- ─────────────────────────────────────────────────────────────────────────────
-- Two ledger corrections.
--
-- 1. Hide the p13 test-mode charge. It came from a cs_test_ checkout session and
--    does not appear among the 54 live Stripe transactions, so it is not real
--    revenue. Hiding (rather than deleting) keeps the record visible under
--    "Show hidden records" and is reversible with a one-line delete.
--
-- 2. Rebuild Nicole Campbell's closed p5 rental so her three payments stop
--    showing as unattributed. Her row was deleted on move-out under the old
--    behaviour, which stranded the payments on the pod. Identity and the
--    original rental id are recovered from storage_portal_payment_sessions;
--    the 2026-08 payment is confirmed against Stripe pi_3TiIwsHY4BmI2D0o1o0XPQgi
--    (nicolecampbell98765@gmail.com, $226.00, 2026-06-14).
--
--    end_date is an ESTIMATE — the end of her last paid period. She has moved
--    out and the exact date is not recorded anywhere. It is set only so p5 stays
--    vacant and bookable; nothing bills against a closed rental.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. Test charge out of revenue and out of the Xero export ────────────────
insert into public.admin_payment_hidden (payment_type, payment_id)
values ('portable', '12a9bb32-ed71-49a1-b6c9-0e27559fdc42')
on conflict (payment_type, payment_id) do nothing;

-- ── 2. Nicole Campbell's closed p5 rental ───────────────────────────────────
insert into public.portable_storage_rentals
  (id, asset_id, customer_id, tenant_name, tenant_phone, monthly_rate,
   billing_day, payment_frequency, move_in_date, end_date, paid_through_date,
   notes, created_at)
values (
  'a358213b-5015-4d56-9eee-7429fc1af910',
  (select id from public.assets where label = 'p5'),
  '34389512-bae5-4279-876b-bb75b0520d9d',
  'Nicole Campbell',
  '7059340338',
  200, 1, 'monthly',
  '2026-06-02',
  '2026-08-31',
  '2026-08-31',
  'Closed rental reconstructed 2026-09-04. Original row was deleted on move-out under the old behaviour, stranding three payments on p5. end_date is an estimate (end of last paid period).',
  '2026-06-02T18:10:57Z'
)
on conflict (id) do nothing;

update public.portable_storage_payments
set rental_id = 'a358213b-5015-4d56-9eee-7429fc1af910'
where asset_id = (select id from public.assets where label = 'p5')
  and rental_id is null
  and period_label in ('2026-06', '2026-07', '2026-08');

commit;
