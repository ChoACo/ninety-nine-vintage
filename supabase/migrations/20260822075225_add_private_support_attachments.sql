begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.support_message_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  message_id uuid not null references public.support_messages(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete restrict,
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  unique (message_id, id),
  check (object_path = conversation_id::text || '/' || message_id::text || '/' || id::text ||
    case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end)
);

create index support_message_attachments_conversation_idx
  on public.support_message_attachments (conversation_id, created_at, id);
create index support_message_attachments_message_idx
  on public.support_message_attachments (message_id, created_at, id);

alter table public.support_message_attachments enable row level security;
alter table public.support_message_attachments force row level security;

create policy "Support participants read attachment metadata"
on public.support_message_attachments
for select
to authenticated
using ((select public.can_access_support_conversation(conversation_id)));

revoke all on table public.support_message_attachments from public, anon, authenticated;
grant select on table public.support_message_attachments to authenticated;

-- Objects are never client-readable or client-writable. Route handlers verify
-- the support conversation first and issue short-lived signed URLs.
drop policy if exists "Support attachment objects are private" on storage.objects;
create policy "Support attachment objects are private"
on storage.objects
for select
to authenticated
using (false);

comment on table public.support_message_attachments is
  'Private image metadata bound to one authorized support message. Objects are served only by signed URLs.';

commit;
