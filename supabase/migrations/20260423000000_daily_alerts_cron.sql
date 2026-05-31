-- Enable pg_cron and pg_net (may already be on; safe to re-run)
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Remove existing schedule if re-running this migration
select cron.unschedule('daily-alerts') where exists (
  select 1 from cron.job where jobname = 'daily-alerts'
);

-- Run daily at 14:00 UTC (10 AM ET / 7 AM PT)
select cron.schedule(
  'daily-alerts',
  '0 14 * * *',
  $$
  select net.http_post(
    url     := 'https://pvpzpkvgdyjujtelwbbs.supabase.co/functions/v1/daily-alerts',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
