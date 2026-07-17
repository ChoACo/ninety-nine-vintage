-- Close authorization and concurrency gaps found during the production audit.

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'member'
    or (
      (auth.jwt() -> 'app_metadata' ->> 'role') is null
      and (
        (auth.jwt() -> 'app_metadata' ->> 'provider') = 'kakao'
        or (auth.jwt() -> 'app_metadata' -> 'providers') ? 'kakao'
      )
    ),
    false
  );
$$;

revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

-- Keep the operator namespace closed to the three IDs requested for this
-- service, even for privileged maintenance scripts.
alter table public.operator_accounts
  drop constraint if exists operator_accounts_reserved_username_check;
alter table public.operator_accounts
  add constraint operator_accounts_reserved_username_check
  check (username in ('operator01', 'operator02', 'operator03'));

create or replace function public.validate_operator_account_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.auth_user_id is not null and not exists (
    select 1
    from auth.users as users
    where users.id = new.auth_user_id
      and users.raw_app_meta_data ->> 'role' = 'operator'
      and users.raw_app_meta_data ->> 'operator_id' = new.username
  ) then
    raise exception using
      errcode = '23514',
      message = '운영자 슬롯과 Auth 사용자의 역할 및 아이디가 일치해야 합니다.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_operator_account_user() from public;

-- An operator claim is valid only when it is linked to one of the three
-- reserved operator slots. Existing administrators remain unchanged.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'operator'
      and exists (
        select 1
        from public.operator_accounts as operators
        where operators.auth_user_id = auth.uid()
          and operators.username =
            (auth.jwt() -> 'app_metadata' ->> 'operator_id')
      )
    ),
    false
  );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

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
        (
          conversations.member_id = auth.uid()
          and public.is_member()
        )
        or public.is_staff()
      )
  );
$$;

revoke all on function public.can_access_support_conversation(uuid) from public;
grant execute on function public.can_access_support_conversation(uuid)
  to authenticated;

drop policy if exists "Members read their conversation and staff read all"
  on public.support_conversations;
create policy "Members read their conversation and staff read all"
on public.support_conversations
for select
to authenticated
using (
  (
    member_id = (select auth.uid())
    and (select public.is_member())
  )
  or (select public.is_staff())
);

drop policy if exists "Conversation participants append messages"
  on public.support_messages;
create policy "Conversation participants append messages"
on public.support_messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and (select public.can_access_support_conversation(conversation_id))
  and exists (
    select 1
    from public.support_conversations as conversations
    where conversations.id = conversation_id
      and conversations.status = 'open'
  )
);

drop policy if exists "Members read their bids" on public.auction_bids;
create policy "Members read their bids"
on public.auction_bids
for select
to authenticated
using (
  bidder_id = (select auth.uid())
  and (select public.is_member())
);

create or replace function public.get_or_create_support_conversation()
returns setof public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_member() then
    raise exception using
      errcode = '42501',
      message = '카카오 회원 로그인 후 운영팀에 문의할 수 있습니다.';
  end if;

  if not exists (
    select 1 from public.profiles as profiles where profiles.id = v_user_id
  ) then
    raise exception using
      errcode = '23503',
      message = '회원 프로필을 찾을 수 없습니다. 다시 로그인해 주세요.';
  end if;

  insert into public.support_conversations (member_id)
  values (v_user_id)
  on conflict (member_id) do nothing;

  return query
  select conversations.*
  from public.support_conversations as conversations
  where conversations.member_id = v_user_id;
end;
$$;

revoke all on function public.get_or_create_support_conversation() from public;
grant execute on function public.get_or_create_support_conversation()
  to authenticated;

create or replace function public.reopen_my_support_conversation()
returns setof public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_member() then
    raise exception using
      errcode = '42501',
      message = '카카오 회원 로그인 후 상담을 다시 열 수 있습니다.';
  end if;

  return query
  update public.support_conversations as conversations
  set status = 'open'
  where conversations.member_id = v_user_id
  returning conversations.*;
end;
$$;

revoke all on function public.reopen_my_support_conversation() from public;
grant execute on function public.reopen_my_support_conversation()
  to authenticated;

create or replace function public.mark_support_conversation_read(
  p_conversation_id uuid
)
returns setof public.support_reads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
    or not public.can_access_support_conversation(p_conversation_id)
  then
    raise exception using
      errcode = '42501',
      message = '이 상담의 읽음 상태를 변경할 권한이 없습니다.';
  end if;

  insert into public.support_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_user_id, clock_timestamp())
  on conflict (conversation_id, user_id) do update
  set last_read_at = excluded.last_read_at;

  return query
  select reads.*
  from public.support_reads as reads
  where reads.conversation_id = p_conversation_id
    and reads.user_id = v_user_id;
end;
$$;

revoke all on function public.mark_support_conversation_read(uuid) from public;
grant execute on function public.mark_support_conversation_read(uuid)
  to authenticated;

revoke insert, update on public.support_reads from authenticated;
revoke update (last_read_at) on public.support_reads from authenticated;

-- Bid rows are an immutable ledger. A product with bids cannot be physically
-- deleted; it must be closed instead.
alter table public.auction_bids
  drop constraint if exists auction_bids_product_id_fkey;
alter table public.auction_bids
  add constraint auction_bids_product_id_fkey
  foreign key (product_id)
  references public.products (id)
  on delete restrict;

alter table public.products
  drop constraint if exists products_bid_amount_ceiling_check;
alter table public.products
  add constraint products_bid_amount_ceiling_check
  check (
    starting_price <= 1000000000
    and current_price <= 1000000000
    and bid_increment <= 100000000
    and (final_bid_amount is null or final_bid_amount <= 1000000000)
  );

alter table public.auction_bids
  drop constraint if exists auction_bids_amount_ceiling_check;
alter table public.auction_bids
  add constraint auction_bids_amount_ceiling_check
  check (amount <= 1000000000);

create or replace function public.place_bid(
  p_product_id uuid,
  p_amount bigint
)
returns table (
  bid_id uuid,
  product_id uuid,
  bidder_id uuid,
  bidder_display_name text,
  amount bigint,
  created_at timestamptz,
  is_final boolean,
  current_price bigint,
  participant_count integer,
  bid_locked_at timestamptz,
  final_bid_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_kst_time time;
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_product public.products%rowtype;
  v_bid_id uuid := gen_random_uuid();
  v_has_any_bid boolean;
  v_user_has_bid boolean;
  v_is_final boolean := false;
  v_minimum_amount bigint;
  v_participant_count integer;
  v_maximum_amount constant bigint := 1000000000;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using
      errcode = '42501',
      message = '카카오 회원 로그인 후 입찰할 수 있습니다.';
  end if;

  select profiles.display_name
  into v_display_name
  from public.profiles as profiles
  where profiles.id = v_user_id;

  if v_display_name is null then
    raise exception using
      errcode = '23503',
      message = '회원 프로필을 찾을 수 없습니다. 다시 로그인해 주세요.';
  end if;

  select products.*
  into v_product
  from public.products as products
  where products.id = p_product_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '입찰 상품을 찾을 수 없습니다.';
  end if;

  -- Use the server clock only after obtaining the row lock. A request that
  -- waited across 20:56 or 21:00 must be judged at the post-lock time.
  v_now := clock_timestamp();
  v_kst_time := (v_now at time zone 'Asia/Seoul')::time;

  if v_product.status <> 'active' or v_product.publish_at > v_now then
    raise exception using
      errcode = 'P0001',
      message = '현재 공개 중인 상품만 입찰할 수 있습니다.';
  end if;

  if v_product.bid_locked_at is not null then
    raise exception using
      errcode = 'P0001',
      message = '확정 입찰이 완료된 상품입니다.';
  end if;

  if v_now >= v_product.closes_at or v_kst_time >= time '21:00:00' then
    raise exception using
      errcode = 'P0001',
      message = '오늘 오후 9시 경매가 마감되었습니다.';
  end if;

  select exists (
    select 1
    from public.auction_bids as bids
    where bids.product_id = p_product_id
  )
  into v_has_any_bid;

  select exists (
    select 1
    from public.auction_bids as bids
    where bids.product_id = p_product_id
      and bids.bidder_id = v_user_id
  )
  into v_user_has_bid;

  if v_kst_time >= time '20:56:00' then
    if not v_has_any_bid then
      v_is_final := true;
    elsif not v_user_has_bid then
      raise exception using
        errcode = 'P0001',
        message = '오후 8시 56분부터는 기존 참여자만 입찰할 수 있습니다.';
    end if;
  end if;

  if p_amount is null or p_amount > v_maximum_amount then
    raise exception using
      errcode = '22003',
      message = '입찰 금액은 10억원 이하여야 합니다.';
  end if;

  if v_has_any_bid
    and v_product.current_price > v_maximum_amount - v_product.bid_increment
  then
    raise exception using
      errcode = '22003',
      message = '이 상품은 최대 입찰 금액에 도달했습니다.';
  end if;

  v_minimum_amount := case
    when v_has_any_bid then v_product.current_price + v_product.bid_increment
    else v_product.starting_price
  end;

  if p_amount < v_minimum_amount then
    raise exception using
      errcode = '22003',
      message = format('현재 최소 입찰가는 %s원입니다.', v_minimum_amount);
  end if;

  insert into public.auction_bids (
    id,
    product_id,
    bidder_id,
    bidder_display_name,
    amount,
    is_final,
    created_at
  )
  values (
    v_bid_id,
    p_product_id,
    v_user_id,
    v_display_name,
    p_amount,
    v_is_final,
    v_now
  );

  v_participant_count := v_product.participant_count
    + case when v_user_has_bid then 0 else 1 end;

  update public.products
  set
    current_price = p_amount,
    participant_count = v_participant_count,
    bid_history = jsonb_build_array(
      jsonb_build_object(
        'id', v_bid_id::text,
        'bidAt', v_now,
        'bidderName', v_display_name,
        'amount', p_amount
      )
    ) || coalesce(v_product.bid_history, '[]'::jsonb),
    bid_locked_at = case when v_is_final then v_now else null end,
    final_bid_id = case when v_is_final then v_bid_id else null end,
    final_bid_amount = case when v_is_final then p_amount else null end
  where id = p_product_id;

  return query
  select
    v_bid_id,
    p_product_id,
    v_user_id,
    v_display_name,
    p_amount,
    v_now,
    v_is_final,
    p_amount,
    v_participant_count,
    case when v_is_final then v_now else null end,
    case when v_is_final then v_bid_id else null end;
end;
$$;

revoke all on function public.place_bid(uuid, bigint) from public;
grant execute on function public.place_bid(uuid, bigint) to authenticated;
