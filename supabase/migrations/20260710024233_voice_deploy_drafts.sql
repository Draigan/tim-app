create table public.voice_deploy_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audio_path text not null,
  audio_mime_type text,
  audio_size integer,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'transcribing', 'transcribed', 'parse_failed', 'failed')),
  transcript text,
  parse_result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index voice_deploy_drafts_user_created_idx
  on public.voice_deploy_drafts(user_id, created_at desc);

alter table public.voice_deploy_drafts enable row level security;

grant select, insert, update, delete on table public.voice_deploy_drafts to authenticated;
grant all privileges on table public.voice_deploy_drafts to service_role;

create policy "users can read own voice deploy drafts"
on public.voice_deploy_drafts for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can create own voice deploy drafts"
on public.voice_deploy_drafts for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "users can update own voice deploy drafts"
on public.voice_deploy_drafts for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users can delete own voice deploy drafts"
on public.voice_deploy_drafts for delete
to authenticated
using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-deploy-audio',
  'voice-deploy-audio',
  false,
  26214400,
  array['audio/webm', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "users can upload own voice deploy audio"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'voice-deploy-audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "users can read own voice deploy audio"
on storage.objects for select
to authenticated
using (
  bucket_id = 'voice-deploy-audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "users can delete own voice deploy audio"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'voice-deploy-audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
