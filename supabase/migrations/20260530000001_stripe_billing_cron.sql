-- Daily billing run — fires at 14:00 UTC (10 AM ET) same time as daily-alerts
select cron.unschedule('stripe-billing-run') where exists (
  select 1 from cron.job where jobname = 'stripe-billing-run'
);

select cron.schedule(
  'stripe-billing-run',
  '0 14 * * *',
  $$
  select net.http_post(
    url     := 'https://pvpzpkvgdyjujtelwbbs.supabase.co/functions/v1/stripe-billing-run',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
