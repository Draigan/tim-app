-- SMS reminder settings (single row)
create table sms_settings (
  id                        int primary key default 1 check (id = 1),
  enabled                   boolean not null default true,
  remind_on_due_day         boolean not null default true,
  first_reminder_days_after int     not null default 5,
  repeat_interval_days      int     not null default 7,
  business_name             text    not null default 'Timberfell Storage'
);

insert into sms_settings default values;

alter table sms_settings enable row level security;
create policy "authenticated full access" on sms_settings
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- Log of reminders sent — prevents duplicate sends and provides audit trail
create table sms_reminder_log (
  id           uuid primary key default gen_random_uuid(),
  ref_id       uuid    not null,
  unit_type    text    not null check (unit_type in ('fixed', 'portable')),
  phone        text    not null,
  sent_date    date    not null default current_date,
  days_overdue int,
  message      text,
  created_at   timestamptz default now(),
  unique (ref_id, sent_date)
);

alter table sms_reminder_log enable row level security;
create policy "authenticated full access" on sms_reminder_log
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- Daily cron job — runs at 14:00 UTC (10 AM ET)
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

select cron.unschedule('storage-reminders') where exists (
  select 1 from cron.job where jobname = 'storage-reminders'
);

select cron.schedule(
  'storage-reminders',
  '0 14 * * *',
  $$
  select net.http_post(
    url     := 'https://pvpzpkvgdyjujtelwbbs.supabase.co/functions/v1/storage-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
