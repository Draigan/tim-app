-- Keep Stripe billing manual for now. Manual charges still call the Edge Function
-- from the app; this only disables the daily unattended billing run.
select cron.unschedule('stripe-billing-run')
where exists (
  select 1
  from cron.job
  where jobname = 'stripe-billing-run'
);
