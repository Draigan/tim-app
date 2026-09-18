-- Move the daily alerts to first thing in the morning: 11:00 UTC is 7 AM
-- Eastern while daylight time is in effect (it becomes 6 AM once EST returns in
-- November — reschedule to '0 12 * * *' then if 7 AM matters year-round).
--
-- This carries the whole job, so the today's-events reminder, upcoming
-- reservations and overdue pickups all arrive at that hour.
--
-- Unchanged: the Vault secret `daily_alerts_cron_secret` must match the Edge
-- Function secret `DAILY_ALERTS_CRON_SECRET`.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule('daily-alerts') where exists (
  select 1 from cron.job where jobname = 'daily-alerts'
);

select cron.schedule(
  'daily-alerts',
  '0 11 * * *',
  $$
  select net.http_post(
    url     := 'https://pvpzpkvgdyjujtelwbbs.supabase.co/functions/v1/daily-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-daily-alerts-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'daily_alerts_cron_secret'
        limit 1
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
