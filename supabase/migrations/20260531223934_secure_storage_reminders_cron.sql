-- Reschedule storage reminder SMS cron with a secret header.
-- The Vault secret `storage_reminders_cron_secret` must match the Edge
-- Function secret `STORAGE_REMINDERS_CRON_SECRET`.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule('storage-reminders') where exists (
  select 1 from cron.job where jobname = 'storage-reminders'
);

select cron.schedule(
  'storage-reminders',
  '0 14 * * *',
  $$
  select net.http_post(
    url     := 'https://pvpzpkvgdyjujtelwbbs.supabase.co/functions/v1/storage-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-storage-reminders-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'storage_reminders_cron_secret'
        limit 1
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
