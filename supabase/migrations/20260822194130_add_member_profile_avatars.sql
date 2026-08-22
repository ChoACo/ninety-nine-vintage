insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'member-avatars',
  'member-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public reads member avatars" on storage.objects;
create policy "Public reads member avatars"
on storage.objects
for select
to public
using (bucket_id = 'member-avatars');

drop policy if exists "Members upload their own avatar" on storage.objects;
create policy "Members upload their own avatar"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'member-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Members update their own avatar" on storage.objects;
create policy "Members update their own avatar"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'member-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'member-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Members delete their own avatar" on storage.objects;
create policy "Members delete their own avatar"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'member-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
