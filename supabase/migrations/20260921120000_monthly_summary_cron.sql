-- Month-ahead summary on the 1st, for the owner and the superuser. It runs
-- through the weekly-summary function with `period: month`, so it shares that
-- function's Vault secret `weekly_summary_cron_secret`.
--
-- 14:00 UTC, the same hour as the Sunday week-ahead.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule('monthly-summary') where exists (
  select 1 from cron.job where jobname = 'monthly-summary'
);

select cron.schedule(
  'monthly-summary',
  '0 14 1 * *',
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
    body    := '{"period":"month"}'::jsonb
  );
  $$
);
