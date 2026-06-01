-- Reschedule Stripe billing cron with a secret header.
-- The Vault secret `billing_cron_secret` must match the Edge Function secret
-- `BILLING_CRON_SECRET`.

create extension if not exists supabase_vault with schema vault;

select cron.unschedule('stripe-billing-run') where exists (
  select 1 from cron.job where jobname = 'stripe-billing-run'
);

select cron.schedule(
  'stripe-billing-run',
  '0 14 * * *',
  $$
  select net.http_post(
    url     := 'https://pvpzpkvgdyjujtelwbbs.supabase.co/functions/v1/stripe-billing-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-billing-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'billing_cron_secret'
        limit 1
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
