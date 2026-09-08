-- Storage view sessions are written through one security-definer function
-- instead of direct table DML.
--
-- Direct writes cannot work here: an UPDATE's WHERE clause has to read the row
-- first, and reading is superuser-only by design, so the visitor's own updates
-- matched zero rows. Routing writes through this function keeps the visitor
-- with no select, insert or update rights on the table at all.

drop policy if exists "users record own storage view sessions" on public.storage_view_sessions;
drop policy if exists "users update own storage view sessions" on public.storage_view_sessions;

revoke all on table public.storage_view_sessions from anon, authenticated;
-- Row access still gated by the superuser-only select policy.
grant select on table public.storage_view_sessions to authenticated;

create or replace function public.record_storage_view(
  p_session_id uuid,
  p_path text,
  p_duration_seconds integer,
  p_ended boolean,
  p_notified_seconds integer default 0,
  p_reopen boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_duration integer := greatest(coalesce(p_duration_seconds, 0), 0);
  v_notified integer := greatest(coalesce(p_notified_seconds, 0), 0);
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_path !~ '^/[A-Za-z0-9/_?&=.#%-]*$' then
    raise exception 'invalid path' using errcode = '22023';
  end if;

  insert into public.storage_view_sessions
    (id, user_id, user_email, path, duration_seconds, notified_seconds, ended_at)
  values
    (p_session_id, v_user_id, v_email, p_path, v_duration, v_notified,
     case when p_ended then now() else null end)
  on conflict (id) do update set
    last_seen_at = now(),
    -- Never let a late or replayed call walk a recorded visit backwards.
    duration_seconds = greatest(public.storage_view_sessions.duration_seconds, excluded.duration_seconds),
    notified_seconds = greatest(public.storage_view_sessions.notified_seconds, excluded.notified_seconds),
    -- Only an explicit end closes a visit and only an explicit resume reopens
    -- one, so a heartbeat landing late can never revive a finished visit.
    ended_at = case
      when p_ended then now()
      when p_reopen then null
      else public.storage_view_sessions.ended_at
    end
  -- A caller can only ever touch their own session row.
  where public.storage_view_sessions.user_id = v_user_id;
end;
$$;

revoke all on function public.record_storage_view(uuid, text, integer, boolean, integer, boolean) from public, anon;
grant execute on function public.record_storage_view(uuid, text, integer, boolean, integer, boolean) to authenticated;
