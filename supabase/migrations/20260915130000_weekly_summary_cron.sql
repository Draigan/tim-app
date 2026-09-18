-- Sunday week-ahead summary for the owner and the superuser.
-- The Vault secret `weekly_summary_cron_secret` must match the Edge Function
-- secret `WEEKLY_SUMMARY_CRON_SECRET`.
--
-- 14:00 UTC on Sunday, matching the hour the other two jobs already run at.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule('weekly-summary') where exists (
  select 1 from cron.job where jobname = 'weekly-summary'
);

select cron.schedule(
  'weekly-summary',
  '0 14 * * 0',
  $$
  select net.http_post(
    url     := 'https://pvpzpkvgdyjujtelwbbs.supabase.co/functions/v1/weekly-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-weekly-summary-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'weekly_summary_cron_secret'
        limit 1
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
