-- Complete the chat canary boundary: the row written by a rehearsed staff
-- member must carry that staff principal, not the immutable Owner session ID.

drop policy if exists "Participants append routed support messages"
on public.support_messages;

create policy "Participants append routed support messages"
on public.support_messages
for insert
to authenticated
with check (
  sender_id = (select public.current_authorization_principal())
  and (select public.can_send_support_message(conversation_id))
);

create or replace function public.mark_support_conversation_read(p_conversation_id uuid)
returns setof public.support_reads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := public.current_authorization_principal();
begin
  if auth.uid() is null
    or v_user_id is null
    or not public.can_access_support_conversation(p_conversation_id)
  then
    raise exception using errcode = '42501',
      message = '이 상담의 읽음 상태를 변경할 권한이 없습니다.';
  end if;

  insert into public.support_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_user_id, clock_timestamp())
  on conflict (conversation_id, user_id) do update
  set last_read_at = excluded.last_read_at;

  return query
  select reads.* from public.support_reads reads
  where reads.conversation_id = p_conversation_id
    and reads.user_id = v_user_id;
end;
$$;

revoke all on function public.mark_support_conversation_read(uuid) from public;
grant execute on function public.mark_support_conversation_read(uuid) to authenticated;
