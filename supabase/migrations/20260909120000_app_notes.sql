-- Free-form staff notes. Shared by the whole crew: everyone with app access
-- reads the same list, and the author is recorded on each note so it is clear
-- who wrote what.
create table public.app_notes (
  id uuid primary key default gen_random_uuid(),
  title text not null default '' check (char_length(title) <= 160),
  body text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  author_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index app_notes_updated_at_idx on public.app_notes(updated_at desc);

alter table public.app_notes enable row level security;

grant select, insert, update, delete on table public.app_notes to authenticated;
grant all privileges on table public.app_notes to service_role;

create policy "staff can read notes"
on public.app_notes for select
to authenticated
using ((select app_private.current_user_is_staff()));

create policy "staff can create notes"
on public.app_notes for insert
to authenticated
with check (
  (select app_private.current_user_is_staff())
  and created_by = (select auth.uid())
);

create policy "staff can update notes"
on public.app_notes for update
to authenticated
using ((select app_private.current_user_is_staff()))
with check ((select app_private.current_user_is_staff()));

create policy "staff can delete notes"
on public.app_notes for delete
to authenticated
using ((select app_private.current_user_is_staff()));
