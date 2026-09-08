alter table public.assets add column if not exists photo_path text;
alter table public.assets add column if not exists photo_uploaded_at timestamptz;
alter table public.assets add column if not exists photo_uploaded_by text;

create or replace function public.set_asset_photo(
  target_asset_id uuid,
  next_photo_path text,
  next_photo_uploaded_at timestamptz,
  next_photo_uploaded_by text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.current_user_is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.assets
  set
    photo_path = next_photo_path,
    photo_uploaded_at = next_photo_uploaded_at,
    photo_uploaded_by = next_photo_uploaded_by
  where id = target_asset_id;

  if not found then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_asset_photo(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.set_asset_photo(uuid, text, timestamptz, text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asset-photos',
  'asset-photos',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff can upload asset photos" on storage.objects;
create policy "staff can upload asset photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'asset-photos'
  and (select app_private.current_user_is_staff())
);

drop policy if exists "staff can read asset photos" on storage.objects;
create policy "staff can read asset photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'asset-photos'
  and (select app_private.current_user_is_staff())
);

drop policy if exists "staff can delete asset photos" on storage.objects;
create policy "staff can delete asset photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'asset-photos'
  and (select app_private.current_user_is_staff())
);
