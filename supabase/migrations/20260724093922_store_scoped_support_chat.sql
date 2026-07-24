-- Store-scoped customer support chat.
-- Customer conversations are one room per member and store. Product inquiries
-- are messages in that room with an attached product snapshot.

alter table public.support_conversations
  add column if not exists store_id uuid;

alter table public.support_messages
  add column if not exists product_id uuid,
  add column if not exists product_title_snapshot text,
  add column if not exists product_image_url_snapshot text;

alter table public.support_conversations
  drop constraint if exists support_conversations_store_id_fkey;
alter table public.support_conversations
  add constraint support_conversations_store_id_fkey
  foreign key (store_id) references public.stores(id) on delete restrict;

alter table public.support_messages
  drop constraint if exists support_messages_product_id_fkey;
alter table public.support_messages
  add constraint support_messages_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;

alter table public.support_messages
  drop constraint if exists support_messages_product_title_snapshot_check;
alter table public.support_messages
  add constraint support_messages_product_title_snapshot_check
  check (
    product_title_snapshot is null
    or char_length(btrim(product_title_snapshot)) between 1 and 160
  );

alter table public.support_messages
  drop constraint if exists support_messages_product_image_snapshot_check;
alter table public.support_messages
  add constraint support_messages_product_image_snapshot_check
  check (
    product_image_url_snapshot is null
    or char_length(btrim(product_image_url_snapshot)) between 1 and 4096
  );

-- The legacy assignment trigger validates the pre-store conversation model
-- and can reject the data conversion below (including stores whose operator
-- placement is being configured separately). The store-aware replacement is
-- installed after the conversion in this same transaction.
drop trigger if exists support_conversations_validate_assignment
  on public.support_conversations;

update public.support_conversations as conversations
set store_id = products.store_id
from public.products as products
where conversations.product_id = products.id
  and conversations.store_id is null;

update public.support_conversations as conversations
set store_id = stores.id
from public.stores as stores
where conversations.conversation_type = 'general'
  and conversations.store_id is null
  and stores.operator_id = conversations.assigned_staff_id
  and stores.is_active;

update public.support_conversations as conversations
set store_id = fallback_store.id
from lateral (
  select stores.id
  from public.stores as stores
  where stores.is_active
  order by stores.created_at, stores.id
  limit 1
) as fallback_store
where conversations.conversation_type in ('general', 'product')
  and conversations.store_id is null;

update public.support_messages as messages
set
  product_id = conversations.product_id,
  product_title_snapshot = conversations.product_title_snapshot,
  product_image_url_snapshot = conversations.product_image_url_snapshot
from public.support_conversations as conversations
where messages.conversation_id = conversations.id
  and conversations.conversation_type = 'product'
  and messages.product_id is null;

-- Merge legacy product-specific conversations into one store room.
drop table if exists support_room_merge;
create temporary table support_room_merge as
select
  conversations.id as source_id,
  first_value(conversations.id) over (
    partition by conversations.member_id, conversations.store_id
    order by
      (conversations.conversation_type = 'general') desc,
      conversations.created_at,
      conversations.id
  ) as target_id
from public.support_conversations as conversations
where conversations.conversation_type in ('general', 'product')
  and conversations.store_id is not null;

update public.support_messages as messages
set conversation_id = room_merge.target_id
from support_room_merge as room_merge
where messages.conversation_id = room_merge.source_id
  and room_merge.source_id <> room_merge.target_id;

insert into public.support_reads (conversation_id, user_id, last_read_at)
select
  room_merge.target_id,
  reads.user_id,
  max(reads.last_read_at)
from public.support_reads as reads
join support_room_merge as room_merge
  on room_merge.source_id = reads.conversation_id
group by room_merge.target_id, reads.user_id
on conflict (conversation_id, user_id) do update
set last_read_at = greatest(
  public.support_reads.last_read_at,
  excluded.last_read_at
);

delete from public.support_reads as reads
using support_room_merge as room_merge
where reads.conversation_id = room_merge.source_id
  and room_merge.source_id <> room_merge.target_id;

delete from public.support_conversations as conversations
using support_room_merge as room_merge
where conversations.id = room_merge.source_id
  and room_merge.source_id <> room_merge.target_id;

update public.support_conversations as conversations
set
  conversation_type = 'general',
  assigned_staff_id = case
    when public.support_access_role(stores.operator_id) = 'operator'
      and exists (
        select 1
        from public.store_memberships as memberships
        where memberships.store_id = stores.id
          and memberships.user_id = stores.operator_id
          and memberships.membership_role = 'operator'
          and memberships.status = 'active'
      )
    then stores.operator_id
    else conversations.assigned_staff_id
  end,
  product_id = null,
  subject = left(stores.name || ' 상담', 160),
  product_title_snapshot = null,
  product_image_url_snapshot = null,
  updated_at = clock_timestamp()
from public.stores as stores
where conversations.store_id = stores.id
  and conversations.conversation_type in ('general', 'product');

update public.support_conversations as conversations
set
  last_message_at = (
    select messages.created_at
    from public.support_messages as messages
    where messages.conversation_id = conversations.id
    order by messages.created_at desc, messages.id desc
    limit 1
  ),
  last_message_preview = (
    select left(messages.body, 160)
    from public.support_messages as messages
    where messages.conversation_id = conversations.id
    order by messages.created_at desc, messages.id desc
    limit 1
  ),
  last_sender_id = (
    select messages.sender_id
    from public.support_messages as messages
    where messages.conversation_id = conversations.id
    order by messages.created_at desc, messages.id desc
    limit 1
  )
where conversations.conversation_type = 'general'
  and exists (
    select 1
    from public.support_messages as messages
    where messages.conversation_id = conversations.id
  );

drop table if exists support_room_merge;

drop index if exists public.support_conversations_general_member_uidx;
drop index if exists public.support_conversations_product_member_uidx;

create unique index if not exists support_conversations_member_store_uidx
  on public.support_conversations (member_id, store_id)
  where conversation_type = 'general' and store_id is not null;

create index if not exists support_conversations_store_inbox_idx
  on public.support_conversations
    (store_id, assigned_staff_id, status, last_message_at desc nulls last)
  where conversation_type = 'general';

create index if not exists support_messages_product_idx
  on public.support_messages (product_id, created_at desc)
  where product_id is not null;

alter table public.support_conversations
  drop constraint if exists support_conversations_store_scope_check;
alter table public.support_conversations
  add constraint support_conversations_store_scope_check
  check (
    (
      conversation_type in ('general', 'product')
      and store_id is not null
    )
    or (
      conversation_type = 'internal'
      and store_id is null
    )
  );

create or replace function public.is_support_member(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id is not null
    and public.support_access_role(p_user_id) in ('member', 'band_member')
    and exists (
      select 1
      from public.member_accounts as accounts
      where accounts.member_id = p_user_id
        and accounts.account_status = 'active'
    )
    and (
      public.has_kakao_identity(p_user_id)
      or exists (
        select 1
        from auth.users as users
        where users.id = p_user_id
          and coalesce(
            (users.raw_app_meta_data ->> 'local_test_account')::boolean,
            false
          )
      )
    );
$$;

revoke all on function public.is_support_member(uuid) from public;
grant execute on function public.is_support_member(uuid) to authenticated;

create or replace function public.support_store_operator(p_store_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select stores.operator_id
  from public.stores as stores
  where stores.id = p_store_id
    and stores.is_active
    and public.support_access_role(stores.operator_id) = 'operator'
    and exists (
      select 1
      from public.store_memberships as memberships
      where memberships.store_id = stores.id
        and memberships.user_id = stores.operator_id
        and memberships.membership_role = 'operator'
        and memberships.status = 'active'
    )
  limit 1;
$$;

revoke all on function public.support_store_operator(uuid) from public;
grant execute on function public.support_store_operator(uuid) to authenticated;

create or replace function public.validate_support_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_operator_id uuid;
  v_product_store_id uuid;
begin
  if new.assigned_staff_id is null then
    raise exception using
      errcode = '23514',
      message = '상담은 연결된 운영자에게만 배정할 수 있습니다.';
  end if;

  if new.conversation_type = 'internal' then
    if public.support_access_role(new.member_id) <> 'employee'
      or not public.has_kakao_identity(new.member_id)
      or public.support_employee_operator(new.member_id)
        is distinct from new.assigned_staff_id
    then
      raise exception using
        errcode = '23514',
        message = '직원 내부 대화는 지정된 담당 운영자와만 연결할 수 있습니다.';
    end if;
    if new.product_id is not null or new.store_id is not null then
      raise exception using
        errcode = '23514',
        message = '내부 대화에는 상품이나 매장을 연결할 수 없습니다.';
    end if;
    return new;
  end if;

  if new.conversation_type not in ('general', 'product')
    or not public.is_support_member(new.member_id)
  then
    raise exception using
      errcode = '23514',
      message = '회원 상담에는 활성 회원만 참여할 수 있습니다.';
  end if;

  v_store_operator_id := public.support_store_operator(new.store_id);
  if v_store_operator_id is null
    or v_store_operator_id is distinct from new.assigned_staff_id
  then
    raise exception using
      errcode = '23514',
      message = '상담은 선택한 매장의 운영자에게만 연결할 수 있습니다.';
  end if;

  if new.conversation_type = 'general' and new.product_id is not null then
    raise exception using
      errcode = '23514',
      message = '매장 상담방의 상품은 메시지에 연결해 주세요.';
  end if;

  if new.conversation_type = 'product' then
    select products.store_id
    into v_product_store_id
    from public.products as products
    where products.id = new.product_id;

    if v_product_store_id is null
      or v_product_store_id is distinct from new.store_id
    then
      raise exception using
        errcode = '23514',
        message = '상품 문의는 상품이 등록된 매장에만 연결할 수 있습니다.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_support_assignment() from public;

drop trigger if exists support_conversations_validate_assignment
  on public.support_conversations;
create trigger support_conversations_validate_assignment
before insert or update of
  member_id,
  assigned_staff_id,
  conversation_type,
  product_id,
  store_id
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
        or not public.is_owner_hidden_test_member(conversations.member_id)
      )
      and (
        public.is_owner()
        or (
          public.support_access_role(auth.uid()) = 'operator'
          and conversations.assigned_staff_id = auth.uid()
          and public.support_store_operator(conversations.store_id) = auth.uid()
        )
        or (
          public.is_support_member(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type in ('general', 'product')
        )
        or (
          public.support_access_role(auth.uid()) = 'employee'
          and public.has_kakao_identity(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type = 'internal'
          and conversations.assigned_staff_id =
            public.support_employee_operator(auth.uid())
        )
      )
  );
$$;

revoke all on function public.can_access_support_conversation(uuid) from public;
grant execute on function public.can_access_support_conversation(uuid)
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
      and public.support_access_role(auth.uid()) = 'operator'
      and public.support_store_operator(conversations.store_id) = auth.uid()
      and not public.is_owner_hidden_test_member(conversations.member_id)
  );
$$;

revoke all on function public.can_manage_support_conversation(uuid) from public;
grant execute on function public.can_manage_support_conversation(uuid)
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
        public.is_owner()
        or not public.is_owner_hidden_test_member(conversations.member_id)
      )
      and (
        (
          public.support_access_role(auth.uid()) = 'operator'
          and conversations.assigned_staff_id = auth.uid()
          and public.support_store_operator(conversations.store_id) = auth.uid()
        )
        or (
          public.is_support_member(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type in ('general', 'product')
        )
        or (
          public.support_access_role(auth.uid()) = 'employee'
          and public.has_kakao_identity(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type = 'internal'
          and conversations.assigned_staff_id =
            public.support_employee_operator(auth.uid())
        )
      )
  );
$$;

revoke all on function public.can_send_support_message(uuid) from public;
grant execute on function public.can_send_support_message(uuid)
  to authenticated;

drop function if exists public.get_or_create_support_conversation();

create or replace function public.get_or_create_support_conversation(
  p_store_id uuid
)
returns setof public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_operator_id uuid;
  v_store_name text;
begin
  if not public.is_support_member(v_user_id) then
    raise exception using
      errcode = '42501',
      message = '회원 로그인 후 매장에 문의할 수 있습니다.';
  end if;

  select stores.name, public.support_store_operator(stores.id)
  into v_store_name, v_operator_id
  from public.stores as stores
  where stores.id = p_store_id
    and stores.is_active;

  if v_operator_id is null then
    raise exception using
      errcode = 'P0002',
      message = '연결 가능한 매장 운영자가 없습니다.';
  end if;

  return query
  insert into public.support_conversations (
    member_id,
    assigned_staff_id,
    conversation_type,
    store_id,
    subject
  )
  values (
    v_user_id,
    v_operator_id,
    'general',
    p_store_id,
    left(v_store_name || ' 상담', 160)
  )
  on conflict (member_id, store_id)
    where conversation_type = 'general' and store_id is not null
  do update set
    assigned_staff_id = excluded.assigned_staff_id,
    subject = excluded.subject,
    status = 'open'
  returning public.support_conversations.*;
end;
$$;

revoke all on function public.get_or_create_support_conversation(uuid)
  from public;
grant execute on function public.get_or_create_support_conversation(uuid)
  to authenticated;

create or replace function public.get_or_create_operator_store_conversation(
  p_member_id uuid,
  p_store_id uuid
)
returns setof public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := auth.uid();
  v_store_name text;
begin
  if public.support_access_role(v_operator_id) <> 'operator'
    or public.support_store_operator(p_store_id) is distinct from v_operator_id
  then
    raise exception using
      errcode = '42501',
      message = '배정된 매장의 회원에게만 채팅할 수 있습니다.';
  end if;

  if not public.is_support_member(p_member_id) then
    raise exception using
      errcode = 'P0002',
      message = '채팅할 활성 회원을 찾지 못했습니다.';
  end if;

  select stores.name
  into v_store_name
  from public.stores as stores
  where stores.id = p_store_id
    and stores.is_active;

  if v_store_name is null then
    raise exception using
      errcode = 'P0002',
      message = '채팅할 매장을 찾지 못했습니다.';
  end if;

  return query
  insert into public.support_conversations (
    member_id,
    assigned_staff_id,
    conversation_type,
    store_id,
    subject
  )
  values (
    p_member_id,
    v_operator_id,
    'general',
    p_store_id,
    left(v_store_name || ' 상담', 160)
  )
  on conflict (member_id, store_id)
    where conversation_type = 'general' and store_id is not null
  do update set
    assigned_staff_id = excluded.assigned_staff_id,
    subject = excluded.subject,
    status = 'open'
  returning public.support_conversations.*;
end;
$$;

revoke all on function public.get_or_create_operator_store_conversation(
  uuid,
  uuid
) from public;
grant execute on function public.get_or_create_operator_store_conversation(
  uuid,
  uuid
) to authenticated;

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
  v_store_id uuid;
  v_store_name text;
  v_subject text;
  v_image_url text;
  v_body text := btrim(coalesce(p_body, ''));
  v_conversation_id uuid;
  v_message_id uuid;
begin
  if not public.is_support_member(v_user_id) then
    raise exception using
      errcode = '42501',
      message = '회원 로그인 후 상품을 문의할 수 있습니다.';
  end if;

  if p_product_id is null then
    raise exception using
      errcode = '22023',
      message = '문의할 상품을 선택해 주세요.';
  end if;

  if char_length(v_body) not between 1 and 2000 then
    raise exception using
      errcode = '22023',
      message = '상품 문의는 1자 이상 2,000자 이하로 입력해 주세요.';
  end if;

  if p_client_nonce is null then
    raise exception using
      errcode = '22023',
      message = '문의 전송 식별자가 필요합니다.';
  end if;

  select
    products.store_id,
    stores.name,
    public.support_store_operator(products.store_id),
    left(btrim(products.title), 160),
    left(nullif(btrim((products.image_urls)[1]), ''), 4096)
  into
    v_store_id,
    v_store_name,
    v_operator_id,
    v_subject,
    v_image_url
  from public.products as products
  join public.stores as stores
    on stores.id = products.store_id
   and stores.is_active
  where products.id = p_product_id
    and products.status = 'active'
    and products.publish_at <= clock_timestamp()
  for update of products;

  if v_store_id is null then
    raise exception using
      errcode = 'P0002',
      message = '문의할 수 있는 상품을 찾지 못했습니다.';
  end if;

  if v_operator_id is null then
    raise exception using
      errcode = 'P0002',
      message = '상품 매장의 운영자를 찾을 수 없습니다.';
  end if;

  update public.products as products
  set inquiry_operator_id = v_operator_id
  where products.id = p_product_id
    and products.inquiry_operator_id is distinct from v_operator_id;

  insert into public.support_conversations (
    member_id,
    assigned_staff_id,
    conversation_type,
    store_id,
    subject,
    status
  )
  values (
    v_user_id,
    v_operator_id,
    'general',
    v_store_id,
    left(v_store_name || ' 상담', 160),
    'open'
  )
  on conflict (member_id, store_id)
    where conversation_type = 'general' and store_id is not null
  do update set
    assigned_staff_id = excluded.assigned_staff_id,
    subject = excluded.subject,
    status = 'open'
  returning id into v_conversation_id;

  insert into public.support_messages (
    conversation_id,
    sender_id,
    body,
    client_nonce,
    product_id,
    product_title_snapshot,
    product_image_url_snapshot
  )
  values (
    v_conversation_id,
    v_user_id,
    v_body,
    p_client_nonce,
    p_product_id,
    coalesce(nullif(v_subject, ''), '상품 문의'),
    v_image_url
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
      and messages.product_id = p_product_id
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

revoke all on function public.start_product_inquiry(uuid, text, uuid)
  from public;
grant execute on function public.start_product_inquiry(uuid, text, uuid)
  to authenticated;

grant select on table public.support_conversations to authenticated;
grant select, insert on table public.support_messages to authenticated;
grant select on table public.support_reads to authenticated;
