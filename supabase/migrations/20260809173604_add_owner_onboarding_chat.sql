begin;

create table public.onboarding_faq_entries(
  id uuid primary key default gen_random_uuid(), question text not null, answer text not null,
  sort_order integer not null default 0, is_approved boolean not null default false,
  approved_by uuid references public.profiles(id) on delete restrict, approved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check(char_length(question) between 3 and 300 and char_length(answer) between 3 and 3000),
  check((is_approved and approved_by is not null and approved_at is not null) or (not is_approved and approved_by is null and approved_at is null))
);
create table public.onboarding_conversations(
  id uuid primary key default gen_random_uuid(), member_id uuid not null unique references public.profiles(id) on delete restrict,
  status text not null default 'open' check(status in ('open','resolved')),
  last_message_at timestamptz, last_message_preview text,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create table public.onboarding_messages(
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.onboarding_conversations(id) on delete restrict,
  sender_id uuid not null references public.profiles(id) on delete restrict, body text not null check(char_length(btrim(body)) between 1 and 2000),
  client_nonce uuid not null, created_at timestamptz not null default clock_timestamp(), unique(sender_id,client_nonce)
);

alter table public.onboarding_faq_entries enable row level security; alter table public.onboarding_faq_entries force row level security;
alter table public.onboarding_conversations enable row level security; alter table public.onboarding_conversations force row level security;
alter table public.onboarding_messages enable row level security; alter table public.onboarding_messages force row level security;
revoke all on table public.onboarding_faq_entries,public.onboarding_conversations,public.onboarding_messages from public,anon,authenticated,service_role;
grant select on table public.onboarding_faq_entries,public.onboarding_conversations,public.onboarding_messages to authenticated,service_role;
create policy "Users read approved onboarding FAQs" on public.onboarding_faq_entries for select to authenticated using(is_approved or public.is_owner());
create policy "Participants read onboarding conversations" on public.onboarding_conversations for select to authenticated using(member_id=auth.uid() or public.is_owner());
create policy "Participants read onboarding messages" on public.onboarding_messages for select to authenticated using(exists(select 1 from public.onboarding_conversations c where c.id=conversation_id and (c.member_id=auth.uid() or public.is_owner())));
create policy "Service reads onboarding FAQs" on public.onboarding_faq_entries for select to service_role using(true);
create policy "Service reads onboarding conversations" on public.onboarding_conversations for select to service_role using(true);
create policy "Service reads onboarding messages" on public.onboarding_messages for select to service_role using(true);

create or replace function public.send_onboarding_message(p_conversation_id uuid,p_body text,p_client_nonce uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_conversation public.onboarding_conversations%rowtype; v_message public.onboarding_messages%rowtype;
begin
  if v_actor is null or p_client_nonce is null or char_length(btrim(coalesce(p_body,''))) not between 1 and 2000 then
    raise exception using errcode='22023',message='입점 문의 내용을 확인해 주세요.'; end if;
  select * into v_message from public.onboarding_messages where sender_id=v_actor and client_nonce=p_client_nonce;
  if found then return to_jsonb(v_message); end if;
  select * into v_conversation from public.onboarding_conversations where id=p_conversation_id for update;
  if not found or (v_conversation.member_id<>v_actor and not public.is_owner()) then raise exception using errcode='42501',message='입점 문의 권한이 없습니다.'; end if;
  insert into public.onboarding_messages(conversation_id,sender_id,body,client_nonce)
  values(v_conversation.id,v_actor,btrim(p_body),p_client_nonce) returning * into v_message;
  update public.onboarding_conversations set status='open',last_message_at=v_message.created_at,
    last_message_preview=left(v_message.body,160),updated_at=clock_timestamp() where id=v_conversation.id;
  return to_jsonb(v_message);
end; $$;
revoke all on function public.send_onboarding_message(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.send_onboarding_message(uuid,text,uuid) to authenticated;

create or replace function public.start_onboarding_conversation(p_body text,p_client_nonce uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_conversation public.onboarding_conversations%rowtype; v_message jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='로그인이 필요합니다.'; end if;
  if public.is_owner() then raise exception using errcode='42501',message='소유자는 입점 신청자로 상담을 시작할 수 없습니다.'; end if;
  insert into public.onboarding_conversations(member_id) values(v_actor)
  on conflict(member_id) do update set updated_at=clock_timestamp() returning * into v_conversation;
  v_message:=public.send_onboarding_message(v_conversation.id,p_body,p_client_nonce);
  return jsonb_build_object('conversation',to_jsonb(v_conversation),'message',v_message);
end; $$;
revoke all on function public.start_onboarding_conversation(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.start_onboarding_conversation(text,uuid) to authenticated;

commit;
