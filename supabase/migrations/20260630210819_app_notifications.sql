create table public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  audience text not null default 'staff' check (audience in ('staff', 'billing', 'admin')),
  type text not null default 'general',
  severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'error')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  body text,
  url text check (url is null or url ~ '^/[A-Za-z0-9/_?&=.#%-]*$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table public.app_notification_reads (
  notification_id uuid not null references public.app_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index app_notifications_created_at_idx
  on public.app_notifications(created_at desc);

create index app_notifications_type_idx
  on public.app_notifications(type);

create index app_notification_reads_user_read_at_idx
  on public.app_notification_reads(user_id, read_at desc);

alter table public.app_notifications enable row level security;
alter table public.app_notification_reads enable row level security;

grant select on table public.app_notifications to authenticated;
grant all privileges on table public.app_notifications to service_role;

grant select, insert, update, delete on table public.app_notification_reads to authenticated;
grant all privileges on table public.app_notification_reads to service_role;

create policy "staff can read app notifications"
on public.app_notifications for select
to authenticated
using (
  (audience = 'admin' and (select app_private.current_user_is_admin()))
  or (audience = 'billing' and (select app_private.current_user_is_billing_admin()))
  or (audience = 'staff' and (select app_private.current_user_is_staff()))
);

create policy "users can read own notification reads"
on public.app_notification_reads for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can insert own notification reads"
on public.app_notification_reads for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_notifications n
    where n.id = notification_id
      and (
        (n.audience = 'admin' and (select app_private.current_user_is_admin()))
        or (n.audience = 'billing' and (select app_private.current_user_is_billing_admin()))
        or (n.audience = 'staff' and (select app_private.current_user_is_staff()))
      )
  )
);

create policy "users can update own notification reads"
on public.app_notification_reads for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users can delete own notification reads"
on public.app_notification_reads for delete
to authenticated
using ((select auth.uid()) = user_id);
