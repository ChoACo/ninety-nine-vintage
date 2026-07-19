-- Keep empty support rows out of the operator inbox, create product inquiries
-- atomically, and let the hidden owner answer only inquiries for products that
-- the owner registered. The owner is deliberately not promoted to a general
-- support operator by this migration.

alter table public.support_conversations
  add column if not exists product_title_snapshot text,
  add column if not exists product_image_url_snapshot text;

alter table public.support_conversations
  drop constraint if exists support_conversations_product_title_snapshot_check;
alter table public.support_conversations
  add constraint support_conversations_product_title_snapshot_check
  check (
    product_title_snapshot is null
    or char_length(btrim(product_title_snapshot)) between 1 and 160
  );

alter table public.support_conversations
  drop constraint if exists support_conversations_product_image_snapshot_check;
alter table public.support_conversations
  add constraint support_conversations_product_image_snapshot_check
  check (
    product_image_url_snapshot is null
    or char_length(btrim(product_image_url_snapshot)) between 1 and 4096
  );

create index if not exists support_conversations_nonempty_operator_inbox_idx
  on public.support_conversations
    (assigned_staff_id, status, last_message_at desc)
  where last_message_at is not null;

create or replace function public.is_product_support_assignee(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_support_operator(p_user_id)
    or (
      p_user_id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
      and public.support_access_role(p_user_id) = 'owner'
      and public.has_kakao_identity(p_user_id)
    ),
    false
  );
$$;

revoke all on function public.is_product_support_assignee(uuid) from public;

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

  if new.created_by = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
    and v_creator_role = 'owner'
    and public.is_product_support_assignee(new.created_by)
  then
    -- The hidden owner is the public-facing operator only for products that the
    -- same account registered. This does not place the owner in the operator
    -- directory or in the general-support load balancer.
    v_operator_id := new.created_by;
  elsif v_creator_role = 'operator' and public.is_support_operator(new.created_by) then
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
    v_operator_id := new.inquiry_operator_id;
  else
    v_operator_id := public.choose_support_operator(new.id);
  end if;

  if v_operator_id is null then
    new.inquiry_operator_id := null;
    return new;
  end if;

  new.inquiry_operator_id := v_operator_id;
  return new;
end;
$$;

revoke all on function public.resolve_product_inquiry_operator() from public;

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
  if new.assigned_staff_id is null then
    raise exception using
      errcode = '23514',
      message = '상담은 연결된 운영자에게만 배정할 수 있습니다.';
  end if;

  if new.conversation_type = 'product' then
    if not public.is_product_support_assignee(new.assigned_staff_id) then
      raise exception using
        errcode = '23514',
        message = '상품 문의는 연결 가능한 상품 담당자에게만 배정할 수 있습니다.';
    end if;
  elsif not public.is_support_operator(new.assigned_staff_id) then
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
          and case
            when conversations.conversation_type = 'product'
              then public.is_product_support_assignee(conversations.assigned_staff_id)
            else public.is_support_operator(conversations.assigned_staff_id)
          end
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
          auth.uid() = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
          and public.is_owner()
          and conversations.conversation_type = 'product'
          and conversations.assigned_staff_id = auth.uid()
          and public.is_product_support_assignee(auth.uid())
        )
        or (
          public.support_access_role(auth.uid()) in ('member', 'band_member')
          and public.has_kakao_identity(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type in ('general', 'product')
          and case
            when conversations.conversation_type = 'product'
              then public.is_product_support_assignee(conversations.assigned_staff_id)
            else public.is_support_operator(conversations.assigned_staff_id)
          end
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
      and (
        public.is_support_operator(auth.uid())
        or (
          conversations.conversation_type = 'product'
          and auth.uid() = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
          and public.is_owner()
          and public.is_product_support_assignee(auth.uid())
        )
      )
  );
$$;

revoke all on function public.can_manage_support_conversation(uuid) from public;
grant execute on function public.can_manage_support_conversation(uuid)
  to authenticated;

-- Existing and future products registered by the hidden owner are routed back
-- to that same account. UI mode does not affect created_by or this database rule.
update public.products as products
set inquiry_operator_id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
where products.created_by = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
  and products.inquiry_operator_id is distinct from
    '30be08c2-6259-42c6-af26-4ded6362de12'::uuid;

update public.support_conversations as conversations
set
  assigned_staff_id = products.inquiry_operator_id,
  product_title_snapshot = left(btrim(products.title), 160),
  product_image_url_snapshot = left(nullif(btrim((products.image_urls)[1]), ''), 4096)
from public.products as products
where conversations.conversation_type = 'product'
  and conversations.product_id = products.id
  and (
    conversations.assigned_staff_id is distinct from products.inquiry_operator_id
    or conversations.product_title_snapshot is null
    or conversations.product_image_url_snapshot is null
  );

-- An unfinished two-request product inquiry has no user-authored content and is
-- safe to discard. The replacement RPC below creates both rows transactionally.
delete from public.support_conversations as conversations
where conversations.conversation_type = 'product'
  and not exists (
    select 1
    from public.support_messages as messages
    where messages.conversation_id = conversations.id
  );

create or replace function public.start_product_inquiry(
  p_product_id uuid,
  p_body text,
  p_client_nonce uuid
)
returns setof public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_operator_id uuid;
  v_creator_id uuid;
  v_subject text;
  v_image_url text;
  v_body text := btrim(coalesce(p_body, ''));
  v_conversation_id uuid;
  v_message_id uuid;
begin
  if v_user_id is null
    or public.support_access_role(v_user_id) not in ('member', 'band_member')
    or not public.has_kakao_identity(v_user_id)
  then
    raise exception using
      errcode = '42501',
      message = '회원 로그인 후 상품을 문의할 수 있습니다.';
  end if;

  if p_product_id is null then
    raise exception using errcode = '22023', message = '문의할 상품을 선택해 주세요.';
  end if;

  if char_length(v_body) not between 1 and 2000 then
    raise exception using
      errcode = '22023',
      message = '상품 문의는 1자 이상 2,000자 이하로 입력해 주세요.';
  end if;

  if p_client_nonce is null then
    raise exception using errcode = '22023', message = '문의 전송 식별자가 필요합니다.';
  end if;

  select
    products.inquiry_operator_id,
    products.created_by,
    left(btrim(products.title), 160),
    left(nullif(btrim((products.image_urls)[1]), ''), 4096)
  into v_operator_id, v_creator_id, v_subject, v_image_url
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

  if v_creator_id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
    and public.is_product_support_assignee(v_creator_id)
  then
    v_operator_id := v_creator_id;
  elsif v_operator_id is null
    or not public.is_product_support_assignee(v_operator_id)
  then
    v_operator_id := public.choose_support_operator(p_product_id);
  end if;

  if v_operator_id is null then
    raise exception using
      errcode = 'P0002',
      message = '상품 담당 운영자를 찾을 수 없습니다.';
  end if;

  update public.products as products
  set inquiry_operator_id = v_operator_id
  where products.id = p_product_id
    and products.inquiry_operator_id is distinct from v_operator_id;

  insert into public.support_conversations (
    member_id,
    assigned_staff_id,
    conversation_type,
    product_id,
    subject,
    product_title_snapshot,
    product_image_url_snapshot,
    status
  )
  values (
    v_user_id,
    v_operator_id,
    'product',
    p_product_id,
    coalesce(nullif(v_subject, ''), '상품 문의'),
    coalesce(nullif(v_subject, ''), '상품 문의'),
    v_image_url,
    'open'
  )
  on conflict (member_id, product_id)
    where conversation_type = 'product' and product_id is not null
  do update set
    assigned_staff_id = excluded.assigned_staff_id,
    subject = excluded.subject,
    product_title_snapshot = excluded.product_title_snapshot,
    product_image_url_snapshot = excluded.product_image_url_snapshot,
    status = 'open'
  returning id into v_conversation_id;

  insert into public.support_messages (
    conversation_id,
    sender_id,
    body,
    client_nonce
  )
  values (
    v_conversation_id,
    v_user_id,
    v_body,
    p_client_nonce
  )
  on conflict (sender_id, client_nonce) do nothing
  returning id into v_message_id;

  if v_message_id is null and not exists (
    select 1
    from public.support_messages as messages
    where messages.sender_id = v_user_id
      and messages.client_nonce = p_client_nonce
      and messages.conversation_id = v_conversation_id
      and messages.body = v_body
  ) then
    raise exception using
      errcode = '23505',
      message = '이미 다른 문의 전송에 사용된 식별자입니다.';
  end if;

  return query
  select conversations.*
  from public.support_conversations as conversations
  where conversations.id = v_conversation_id;
end;
$$;

revoke all on function public.start_product_inquiry(uuid, text, uuid) from public;
grant execute on function public.start_product_inquiry(uuid, text, uuid)
  to authenticated;

-- The old two-step RPC can leave an empty thread if the message insert fails.
revoke execute on function public.get_or_create_product_inquiry_conversation(uuid)
  from authenticated;
