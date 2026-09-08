-- ─────────────────────────────────────────────────────────────────────────────
-- Record delivery/pickup fees that Stripe collected but the ledger never saw.
--
-- stripe-billing-run added the "extra" amount to the Stripe charge but wrote
-- only the rent periods to the ledger, so every fee charged through the app was
-- collected and then vanished from revenue. The code defect is fixed alongside
-- this migration; these two rows are the money already taken under it.
--
-- Both are verified against the live Stripe ledger:
--   Chris Coward  pi_3UArByHY4BmI2D0o1bmtHyFO  $452.00  2026-09-01
--   Emad          pi_3U6x3YHY4BmI2D0o1D29ANbV  $452.00  2026-08-21
--
-- $452.00 charged = $200 rent + $100 delivery + $100 pickup + $52 HST.
-- The ledger recorded only the $200 + $26 rent portion.
--
-- To revert: set both rows back to amount 226, subtotal_amount 200, tax_amount 26.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

update public.portable_storage_payments
set amount          = 452,
    subtotal_amount = 400,
    tax_amount      = 52,
    tax_rate        = 0.13,
    tax_label       = 'HST'
where id in (
  '4247fb86-b203-4222-97c0-f6551f99536c',  -- p2 2026-09, Chris Coward
  'ecedc01b-261f-42a4-9638-fdaf30b30ab8'   -- p7 2026-08, Emad
)
  and amount = 226;  -- refuse to run twice, or against unexpected values

-- Expect "UPDATE 2". Anything else means the rows are not in the state this
-- migration was written against — roll back and re-check before proceeding.

commit;
