-- Route every support thread to exactly one grade-1 operator.
-- This migration depends on 20260718030000, but keeps legacy app_metadata
-- claims as a compatibility fallback while existing sessions are refreshed.

alter table public.products
  add column if not exists inquiry_operator_id uuid
    references public.profiles (id) on delete set null;

alter table public.support_conversations
  add column if not exists conversation_type text not null default 'general',
  add column if not exists product_id uuid
    references public.products (id) on delete set null,
  add column if not exists subject text;

alter table public.support_conversations
  drop constraint if exists support_conversations_member_id_key;

alter table public.support_conversations
  drop constraint if exists support_conversations_conversation_type_check;
alter table public.support_conversations
  add constraint support_conversations_conversation_type_check
  check (conversation_type in ('general', 'product', 'internal'));

alter table public.support_conversations
  drop constraint if exists support_conversations_subject_length_check;
alter table public.support_conversations
  add constraint support_conversations_subject_length_check
  check (subject is null or char_length(btrim(subject)) between 1 and 160);

create unique index if not exists support_conversations_general_member_uidx
  on public.support_conversations (member_id)
  where conversation_type = 'general';

create unique index if not exists support_conversations_product_member_uidx
  on public.support_conversations (member_id, product_id)
  where conversation_type = 'product' and product_id is not null;

create unique index if not exists support_conversations_internal_member_uidx
  on public.support_conversations (member_id)
  where conversation_type = 'internal';

create index if not exists support_conversations_operator_inbox_idx
  on public.support_conversations
    (assigned_staff_id, status, last_message_at desc nulls last);

create index if not exists products_inquiry_operator_idx
  on public.products (inquiry_operator_id);

create or replace function public.support_access_role(
  p_user_id uuid default auth.uid()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if p_user_id is null then
    return null;
  end if;

  -- current_access_role() is authoritative for the signed-in user. The direct
  -- table lookup also lets assignment triggers validate another participant.
  if p_user_id = auth.uid() then
    v_role := public.current_access_role();
  end if;

  if v_role is null then
    select roles.role_code
    into v_role
    from public.account_access_roles as roles
    where roles.user_id = p_user_id;
  end if;

  if v_role is null then
    select case users.raw_app_meta_data ->> 'role'
      when 'admin' then 'owner'
      when 'owner' then 'owner'
      when 'operator' then 'operator'
      when 'employee' then 'employee'
      when 'band_member' then 'band_member'
      when 'member' then 'member'
      else case
        when (users.raw_app_meta_data ->> 'provider') = 'kakao'
          or (users.raw_app_meta_data -> 'providers') ? 'kakao'
        then 'member'
        else null
      end
    end
    into v_role
    from auth.users as users
    where users.id = p_user_id;
  end if;

  return v_role;
end;
$$;

revoke all on function public.support_access_role(uuid) from public;

create or replace function public.has_kakao_identity(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from auth.identities as identities
      where identities.user_id = p_user_id
        and identities.provider = 'kakao'
    ),
    false
  );
$$;

revoke all on function public.has_kakao_identity(uuid) from public;

create or replace function public.is_support_operator(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.account_access_roles as roles
      where roles.user_id = p_user_id
        and roles.role_code = 'operator'
    )
    and public.has_kakao_identity(p_user_id),
    false
  );
$$;

revoke all on function public.is_support_operator(uuid) from public;

create or replace function public.support_employee_operator(p_employee_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select roles.reports_to_operator_id
  from public.account_access_roles as roles
  where roles.user_id = p_employee_id
    and roles.role_code = 'employee'
    and public.has_kakao_identity(p_employee_id)
    and public.is_support_operator(roles.reports_to_operator_id)
  limit 1;
$$;

revoke all on function public.support_employee_operator(uuid) from public;

create or replace function public.choose_support_operator(p_routing_key uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select roles.user_id
  from public.account_access_roles as roles
  where roles.role_code = 'operator'
    and public.is_support_operator(roles.user_id)
  order by
    (
      select count(*)
      from public.support_conversations as conversations
      where conversations.assigned_staff_id = roles.user_id
        and conversations.status = 'open'
    ),
    md5(coalesce(p_routing_key::text, '') || roles.user_id::text),
    roles.user_id
  limit 1;
$$;

revoke all on function public.choose_support_operator(uuid) from public;

create or replace function public.resolve_product_inquiry_operator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_role text;
  v_operator_id uuid;
begin
  v_creator_role := public.support_access_role(new.created_by);

  if v_creator_role = 'operator' and public.is_support_operator(new.created_by) then
    v_operator_id := new.created_by;
  elsif v_creator_role = 'employee' then
    v_operator_id := public.support_employee_operator(new.created_by);
    if v_operator_id is null and public.is_support_operator(new.inquiry_operator_id) then
      v_operator_id := new.inquiry_operator_id;
    elsif v_operator_id is null then
      v_operator_id := public.choose_support_operator(new.id);
    end if;
  elsif v_creator_role = 'owner' then
    if public.is_support_operator(new.inquiry_operator_id) then
      v_operator_id := new.inquiry_operator_id;
    else
      v_operator_id := public.choose_support_operator(new.id);
    end if;
  elsif public.is_support_operator(new.inquiry_operator_id) then
    -- Supports older rows whose creator was deleted, while still preventing an
    -- owner or employee from becoming the public contact.
    v_operator_id := new.inquiry_operator_id;
  else
    v_operator_id := public.choose_support_operator(new.id);
  end if;

  if v_operator_id is null then
    -- A freshly migrated service can temporarily have only the hidden owner.
    -- Product registration must keep working, while inquiry creation remains
    -- unavailable until a Kakao operator is promoted and the recovery RPC runs.
    new.inquiry_operator_id := null;
    return new;
  end if;

  new.inquiry_operator_id := v_operator_id;
  return new;
end;
$$;

revoke all on function public.resolve_product_inquiry_operator() from public;

-- Existing products and legacy general conversations are routed before the
-- stricter assignment trigger and RLS policies take effect.
drop trigger if exists products_resolve_inquiry_operator on public.products;

update public.products as products
set inquiry_operator_id = case
  when public.is_support_operator(products.created_by) then products.created_by
  when public.support_access_role(products.created_by) = 'employee'
    then public.support_employee_operator(products.created_by)
  when public.is_support_operator(products.inquiry_operator_id)
    then products.inquiry_operator_id
  else public.choose_support_operator(products.id)
end
where products.inquiry_operator_id is null
   or not public.is_support_operator(products.inquiry_operator_id);

update public.support_conversations as conversations
set
  assigned_staff_id = public.choose_support_operator(conversations.member_id),
  conversation_type = 'general',
  subject = coalesce(conversations.subject, '일반 상담')
where conversations.assigned_staff_id is null
   or not public.is_support_operator(conversations.assigned_staff_id);

drop trigger if exists products_resolve_inquiry_operator on public.products;
create trigger products_resolve_inquiry_operator
before insert or update of created_by, inquiry_operator_id
on public.products
for each row execute function public.resolve_product_inquiry_operator();

create or replace function public.assign_unrouted_products_to_operator()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_owner() and not public.is_support_operator(auth.uid()) then
    raise exception using
      errcode = '42501',
      message = '상품 문의 담당자를 배정할 권한이 없습니다.';
  end if;

  if public.choose_support_operator(auth.uid()) is null then
    raise exception using
      errcode = 'P0002',
      message = '연결 가능한 카카오 운영자가 없습니다.';
  end if;

  update public.products as products
  set inquiry_operator_id = case
    when public.is_support_operator(products.created_by)
      then products.created_by
    when public.support_access_role(products.created_by) = 'employee'
      then coalesce(
        public.support_employee_operator(products.created_by),
        public.choose_support_operator(products.id)
      )
    else public.choose_support_operator(products.id)
  end
  where products.inquiry_operator_id is null
     or not public.is_support_operator(products.inquiry_operator_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.assign_unrouted_products_to_operator() from public;
grant execute on function public.assign_unrouted_products_to_operator()
  to authenticated;

create or replace function public.assign_unrouted_support_conversations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_owner() and not public.is_support_operator(auth.uid()) then
    raise exception using
      errcode = '42501',
      message = '상담 담당자를 배정할 권한이 없습니다.';
  end if;

  with routes as (
    select
      conversations.id,
      case conversations.conversation_type
        when 'internal' then public.support_employee_operator(conversations.member_id)
        when 'product' then products.inquiry_operator_id
        else public.choose_support_operator(conversations.member_id)
      end as operator_id
    from public.support_conversations as conversations
    left join public.products as products
      on products.id = conversations.product_id
    where (
      conversations.assigned_staff_id is null
      or not public.is_support_operator(conversations.assigned_staff_id)
    )
      and (
        (
          conversations.conversation_type in ('general', 'product')
          and public.support_access_role(conversations.member_id)
            in ('member', 'band_member')
          and public.has_kakao_identity(conversations.member_id)
        )
        or (
          conversations.conversation_type = 'internal'
          and public.support_access_role(conversations.member_id) = 'employee'
          and public.has_kakao_identity(conversations.member_id)
        )
      )
  )
  update public.support_conversations as conversations
  set assigned_staff_id = routes.operator_id
  from routes
  where conversations.id = routes.id
    and public.is_support_operator(routes.operator_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.assign_unrouted_support_conversations() from public;
grant execute on function public.assign_unrouted_support_conversations()
  to authenticated;

create or replace function public.validate_support_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant_role text;
  v_product_operator_id uuid;
begin
  if new.assigned_staff_id is null
    or not public.is_support_operator(new.assigned_staff_id)
  then
    raise exception using
      errcode = '23514',
      message = '상담은 연결된 운영자에게만 배정할 수 있습니다.';
  end if;

  v_participant_role := public.support_access_role(new.member_id);

  if new.conversation_type = 'internal' then
    if v_participant_role <> 'employee'
      or not public.has_kakao_identity(new.member_id)
      or public.support_employee_operator(new.member_id) is distinct from new.assigned_staff_id
    then
      raise exception using
        errcode = '23514',
        message = '직원 내부 대화는 지정된 담당 운영자와만 연결할 수 있습니다.';
    end if;
    if new.product_id is not null then
      raise exception using errcode = '23514', message = '내부 대화에는 상품을 연결할 수 없습니다.';
    end if;
  elsif new.conversation_type in ('general', 'product') then
    if v_participant_role not in ('member', 'band_member')
      or not public.has_kakao_identity(new.member_id)
    then
      raise exception using
        errcode = '23514',
        message = '회원 상담에는 일반 회원만 참여할 수 있습니다.';
    end if;

    if new.conversation_type = 'general' and new.product_id is not null then
      raise exception using errcode = '23514', message = '일반 상담에는 상품을 연결할 수 없습니다.';
    end if;

    if new.conversation_type = 'product' then
      select products.inquiry_operator_id
      into v_product_operator_id
      from public.products as products
      where products.id = new.product_id;

      if v_product_operator_id is null
        or v_product_operator_id is distinct from new.assigned_staff_id
      then
        raise exception using
          errcode = '23514',
          message = '상품 문의는 해당 상품의 담당 운영자에게만 연결할 수 있습니다.';
      end if;
    end if;
  else
    raise exception using errcode = '23514', message = '지원 대화 유형이 올바르지 않습니다.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_support_assignment() from public;

drop trigger if exists support_conversations_validate_assignment
  on public.support_conversations;
create trigger support_conversations_validate_assignment
before insert or update of member_id, assigned_staff_id, conversation_type, product_id
on public.support_conversations
for each row execute function public.validate_support_assignment();

create or replace function public.can_access_support_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations as conversations
    where conversations.id = p_conversation_id
      and (
        public.is_owner()
        or (
          public.support_access_role(auth.uid()) = 'operator'
          and public.is_support_operator(auth.uid())
          and conversations.assigned_staff_id = auth.uid()
        )
        or (
          public.support_access_role(auth.uid()) in ('member', 'band_member')
          and public.has_kakao_identity(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type in ('general', 'product')
          and public.is_support_operator(conversations.assigned_staff_id)
        )
        or (
          public.support_access_role(auth.uid()) = 'employee'
          and public.has_kakao_identity(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type = 'internal'
          and conversations.assigned_staff_id = public.support_employee_operator(auth.uid())
        )
      )
  );
$$;

revoke all on function public.can_access_support_conversation(uuid) from public;
grant execute on function public.can_access_support_conversation(uuid)
  to authenticated;

create or replace function public.can_send_support_message(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations as conversations
    where conversations.id = p_conversation_id
      and conversations.status = 'open'
      and (
        (
          public.support_access_role(auth.uid()) = 'operator'
          and public.is_support_operator(auth.uid())
          and conversations.assigned_staff_id = auth.uid()
        )
        or (
          public.support_access_role(auth.uid()) in ('member', 'band_member')
          and public.has_kakao_identity(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type in ('general', 'product')
          and public.is_support_operator(conversations.assigned_staff_id)
        )
        or (
          public.support_access_role(auth.uid()) = 'employee'
          and public.has_kakao_identity(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type = 'internal'
          and conversations.assigned_staff_id = public.support_employee_operator(auth.uid())
        )
      )
  );
$$;

revoke all on function public.can_send_support_message(uuid) from public;
grant execute on function public.can_send_support_message(uuid)
  to authenticated;

create or replace function public.can_manage_support_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations as conversations
    where conversations.id = p_conversation_id
      and conversations.assigned_staff_id = auth.uid()
      and public.is_support_operator(auth.uid())
  );
$$;

revoke all on function public.can_manage_support_conversation(uuid) from public;
grant execute on function public.can_manage_support_conversation(uuid)
  to authenticated;

create or replace function public.get_or_create_support_conversation()
returns setof public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_operator_id uuid;
begin
  if v_user_id is null
    or public.support_access_role(v_user_id) not in ('member', 'band_member')
    or not public.has_kakao_identity(v_user_id)
  then
    raise exception using
      errcode = '42501',
      message = '회원 로그인 후 운영팀에 문의할 수 있습니다.';
  end if;

  v_operator_id := public.choose_support_operator(v_user_id);
  if v_operator_id is null then
    raise exception using errcode = 'P0002', message = '연결 가능한 운영자가 없습니다.';
  end if;

  return query
  insert into public.support_conversations (
    member_id,
    assigned_staff_id,
    conversation_type,
    subject
  )
  values (v_user_id, v_operator_id, 'general', '일반 상담')
  on conflict (member_id) where conversation_type = 'general'
  do update set
    assigned_staff_id = case
      when public.is_support_operator(public.support_conversations.assigned_staff_id)
        then public.support_conversations.assigned_staff_id
      else excluded.assigned_staff_id
    end
  returning public.support_conversations.*;
end;
$$;

revoke all on function public.get_or_create_support_conversation() from public;
grant execute on function public.get_or_create_support_conversation()
  to authenticated;

create or replace function public.get_or_create_product_inquiry_conversation(
  p_product_id uuid
)
returns setof public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_operator_id uuid;
  v_subject text;
begin
  if v_user_id is null
    or public.support_access_role(v_user_id) not in ('member', 'band_member')
    or not public.has_kakao_identity(v_user_id)
  then
    raise exception using
      errcode = '42501',
      message = '회원 로그인 후 상품을 문의할 수 있습니다.';
  end if;

  select
    products.inquiry_operator_id,
    left(btrim(products.title), 160)
  into v_operator_id, v_subject
  from public.products as products
  where products.id = p_product_id
    and products.status = 'active'
    and products.publish_at <= clock_timestamp()
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '문의할 수 있는 상품을 찾지 못했습니다.';
  end if;

  if v_operator_id is null or not public.is_support_operator(v_operator_id) then
    v_operator_id := public.choose_support_operator(p_product_id);
    if v_operator_id is null then
      raise exception using
        errcode = 'P0002',
        message = '상품 담당 운영자를 찾을 수 없습니다.';
    end if;

    update public.products as products
    set inquiry_operator_id = v_operator_id
    where products.id = p_product_id;
  end if;

  return query
  insert into public.support_conversations (
    member_id,
    assigned_staff_id,
    conversation_type,
    product_id,
    subject,
    status
  )
  values (
    v_user_id,
    v_operator_id,
    'product',
    p_product_id,
    coalesce(nullif(v_subject, ''), '상품 문의'),
    'open'
  )
  on conflict (member_id, product_id)
    where conversation_type = 'product' and product_id is not null
  do update set
    assigned_staff_id = excluded.assigned_staff_id,
    subject = excluded.subject,
    status = 'open'
  returning public.support_conversations.*;
end;
$$;

revoke all on function public.get_or_create_product_inquiry_conversation(uuid)
  from public;
grant execute on function public.get_or_create_product_inquiry_conversation(uuid)
  to authenticated;

create or replace function public.get_or_create_employee_support_conversation()
returns setof public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_operator_id uuid;
begin
  if v_user_id is null
    or public.support_access_role(v_user_id) <> 'employee'
    or not public.has_kakao_identity(v_user_id)
  then
    raise exception using
      errcode = '42501',
      message = '직원 계정만 내부 운영 대화를 열 수 있습니다.';
  end if;

  v_operator_id := public.support_employee_operator(v_user_id);
  if v_operator_id is null then
    raise exception using
      errcode = 'P0002',
      message = '지정된 담당 운영자가 없습니다.';
  end if;

  return query
  insert into public.support_conversations (
    member_id,
    assigned_staff_id,
    conversation_type,
    subject
  )
  values (v_user_id, v_operator_id, 'internal', '내부 운영 대화')
  on conflict (member_id) where conversation_type = 'internal'
  do update set assigned_staff_id = excluded.assigned_staff_id
  returning public.support_conversations.*;
end;
$$;

revoke all on function public.get_or_create_employee_support_conversation()
  from public;
grant execute on function public.get_or_create_employee_support_conversation()
  to authenticated;

create or replace function public.reopen_support_conversation(
  p_conversation_id uuid
)
returns setof public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.can_access_support_conversation(p_conversation_id)
    or public.is_owner()
  then
    raise exception using
      errcode = '42501',
      message = '이 대화를 다시 열 권한이 없습니다.';
  end if;

  return query
  update public.support_conversations as conversations
  set status = 'open'
  where conversations.id = p_conversation_id
  returning conversations.*;
end;
$$;

revoke all on function public.reopen_support_conversation(uuid) from public;
grant execute on function public.reopen_support_conversation(uuid)
  to authenticated;

create or replace function public.reopen_my_support_conversation()
returns setof public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  select conversations.id
  into v_conversation_id
  from public.support_conversations as conversations
  where conversations.member_id = auth.uid()
    and conversations.conversation_type = 'general';

  if v_conversation_id is null then
    return query select * from public.get_or_create_support_conversation();
    return;
  end if;

  return query select * from public.reopen_support_conversation(v_conversation_id);
end;
$$;

revoke all on function public.reopen_my_support_conversation() from public;
grant execute on function public.reopen_my_support_conversation()
  to authenticated;

create or replace function public.list_support_operators()
returns table (
  operator_id uuid,
  display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using
      errcode = '42501',
      message = '운영자 상담함 감사 권한이 없습니다.';
  end if;

  return query
  select
    roles.user_id,
    profiles.display_name
  from public.account_access_roles as roles
  join public.profiles as profiles
    on profiles.id = roles.user_id
  where roles.role_code = 'operator'
    and public.is_support_operator(roles.user_id)
  order by profiles.display_name, roles.user_id;
end;
$$;

revoke all on function public.list_support_operators() from public;
grant execute on function public.list_support_operators() to authenticated;

-- Replace broad staff policies. Operators can only see and mutate their own
-- assigned rows; the owner is read-only and employees only see internal rows.
drop policy if exists "Members read their conversation and staff read all"
  on public.support_conversations;
drop policy if exists "Staff manage support conversations"
  on public.support_conversations;
drop policy if exists "Conversation participants read messages"
  on public.support_messages;
drop policy if exists "Conversation participants append messages"
  on public.support_messages;
drop policy if exists "Users read their receipts and staff read all"
  on public.support_reads;
drop policy if exists "Users create their own receipts"
  on public.support_reads;
drop policy if exists "Users update their own receipts"
  on public.support_reads;

create policy "Participants read routed support conversations"
on public.support_conversations
for select
to authenticated
using ((select public.can_access_support_conversation(id)));

create policy "Operators update their routed support conversations"
on public.support_conversations
for update
to authenticated
using (
  (select public.can_manage_support_conversation(id))
)
with check (
  (select public.can_manage_support_conversation(id))
);

create policy "Participants read routed support messages"
on public.support_messages
for select
to authenticated
using ((select public.can_access_support_conversation(conversation_id)));

create policy "Participants append routed support messages"
on public.support_messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and (select public.can_send_support_message(conversation_id))
);

create policy "Participants read their support receipts"
on public.support_reads
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select public.can_access_support_conversation(conversation_id))
);

revoke update (assigned_staff_id) on public.support_conversations
  from authenticated;
grant update (status) on public.support_conversations to authenticated;

revoke insert, update on public.support_reads from authenticated;
revoke update (last_read_at) on public.support_reads from authenticated;

create or replace function public.route_backlog_after_operator_promotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role_code = 'operator'
    and (tg_op = 'INSERT' or old.role_code is distinct from new.role_code)
  then
    perform public.assign_unrouted_products_to_operator();
    perform public.assign_unrouted_support_conversations();
  end if;
  return new;
end;
$$;

revoke all on function public.route_backlog_after_operator_promotion() from public;

drop trigger if exists account_access_roles_route_operator_backlog
on public.account_access_roles;
create trigger account_access_roles_route_operator_backlog
after insert or update of role_code on public.account_access_roles
for each row execute function public.route_backlog_after_operator_promotion();
