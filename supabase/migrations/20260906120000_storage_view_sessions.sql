-- Times how long a watched account (currently the owner, tim@timberfell.ca)
-- spends inside the Storage section. The visitor's own browser writes the row;
-- only the superuser can read the log back.

create table public.storage_view_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  path text not null check (path ~ '^/[A-Za-z0-9/_?&=.#%-]*$'),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  -- Duration already reported to the superuser, so a resumed visit only
  -- notifies again once meaningfully more time has been spent.
  notified_seconds integer not null default 0 check (notified_seconds >= 0),
  created_at timestamptz not null default now()
);

create index storage_view_sessions_started_at_idx
  on public.storage_view_sessions(started_at desc);

create index storage_view_sessions_user_idx
  on public.storage_view_sessions(user_id, started_at desc);

alter table public.storage_view_sessions enable row level security;

grant select, insert, update on table public.storage_view_sessions to authenticated;
grant all privileges on table public.storage_view_sessions to service_role;

create policy "superuser reads storage view sessions"
on public.storage_view_sessions for select
to authenticated
using ((select app_private.current_user_is_superuser()));

create policy "users record own storage view sessions"
on public.storage_view_sessions for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and lower(user_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

create policy "users update own storage view sessions"
on public.storage_view_sessions for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
