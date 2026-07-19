-- Close the remaining owner-test and auction-ledger escape hatches without
-- broadening any browser role. Payment preparation remains service-role-only;
-- the only non-Kakao exception is the owner's active, registered test member.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

-- RLS expressions run with the querying role and therefore need EXECUTE on
-- every function they invoke. Keep this predicate outside PostgREST's exposed
-- public schema so granting it for policy evaluation does not create a UUID
-- probing RPC.
create or replace function app_private.is_owner_hidden_test_member_for_policy(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.owner_hidden_test_members as test_members
    where test_members.test_user_id = p_user_id
  );
$$;

revoke all on function app_private.is_owner_hidden_test_member_for_policy(uuid)
from public, anon, authenticated, service_role;
grant execute on function app_private.is_owner_hidden_test_member_for_policy(uuid)
to authenticated;

drop policy if exists "Operators read non-owner profiles" on public.profiles;
create policy "Operators read non-owner profiles"
on public.profiles
for select
to authenticated
using (
  (select public.is_operator())
  and public.access_role_for_user(id) is not null
  and public.access_role_for_user(id) <> 'owner'
  and not app_private.is_owner_hidden_test_member_for_policy(id)
);

drop policy if exists "Members read their shipping requests and staff read all"
on public.shipping_requests;
create policy "Members read their shipping requests and staff read all"
on public.shipping_requests
for select
to authenticated
using (
  (member_id = (select auth.uid()) and (select public.is_member()))
  or (
    (select public.is_staff())
    and (
      (select public.is_owner())
      or not app_private.is_owner_hidden_test_member_for_policy(member_id)
    )
  )
);

drop policy if exists "Members read their shipping items and staff read all"
on public.shipping_request_items;
create policy "Members read their shipping items and staff read all"
on public.shipping_request_items
for select
to authenticated
using (
  exists (
    select 1
    from public.shipping_requests as requests
    where requests.id = request_id
      and (
        (requests.member_id = (select auth.uid()) and (select public.is_member()))
        or (
          (select public.is_staff())
          and (
            (select public.is_owner())
            or not app_private.is_owner_hidden_test_member_for_policy(requests.member_id)
          )
        )
      )
  )
);

drop policy if exists "Employees read pending shipping requests"
on public.shipping_requests;
create policy "Employees read pending shipping requests"
on public.shipping_requests
for select
to authenticated
using (
  (select public.is_employee())
  and status = 'requested'
  and not app_private.is_owner_hidden_test_member_for_policy(member_id)
);

drop policy if exists "Employees read pending shipping items"
on public.shipping_request_items;
create policy "Employees read pending shipping items"
on public.shipping_request_items
for select
to authenticated
using (
  (select public.is_employee())
  and exists (
    select 1
    from public.shipping_requests as requests
    where requests.id = request_id
      and requests.status = 'requested'
      and not app_private.is_owner_hidden_test_member_for_policy(requests.member_id)
  )
);

drop policy if exists "Members read their payment orders and operators read all"
on public.payment_orders;
create policy "Members read their payment orders and operators read all"
on public.payment_orders
for select
to authenticated
using (
  (buyer_id = (select auth.uid()) and (select public.is_member()))
  or (
    (select public.can_manage_members())
    and (
      (select public.is_owner())
      or not app_private.is_owner_hidden_test_member_for_policy(buyer_id)
    )
  )
);

drop policy if exists "Members read their payment attempts and operators read all"
on public.payment_attempts;
create policy "Members read their payment attempts and operators read all"
on public.payment_attempts
for select
to authenticated
using (
  exists (
    select 1
    from public.payment_orders as orders
    where orders.id = order_id
      and (
        (orders.buyer_id = (select auth.uid()) and (select public.is_member()))
        or (
          (select public.can_manage_members())
          and (
            (select public.is_owner())
            or not app_private.is_owner_hidden_test_member_for_policy(orders.buyer_id)
          )
        )
      )
  )
);

drop policy if exists "Staff read every bid" on public.auction_bids;
create policy "Staff read every bid"
on public.auction_bids
for select
to authenticated
using (
  (select public.is_staff())
  and (
    (select public.is_owner())
    or not app_private.is_owner_hidden_test_member_for_policy(bidder_id)
  )
);

create or replace function public.prepare_portone_payment(
  p_member_id uuid,
  p_product_id uuid,
  p_payment_id text,
  p_requested_method text,
  p_store_id text
)
returns table (
  payment_id text,
  product_id uuid,
  order_name text,
  expected_amount bigint,
  payment_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_order public.payment_orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_winner_id uuid;
  v_winning_amount bigint;
  v_requires_verified_profile boolean;
  v_is_active_owner_test_member boolean;
begin
  if p_member_id is null or p_product_id is null then
    raise exception using errcode = '22023', message = '결제 회원과 상품 정보가 필요합니다.';
  end if;
  if char_length(coalesce(p_payment_id, '')) not between 6 and 40
    or p_payment_id !~ '^[A-Za-z0-9]+$'
  then
    raise exception using errcode = '22023', message = '결제 고유번호 형식을 확인해 주세요.';
  end if;
  if p_requested_method not in ('CARD', 'EASY_PAY', 'VIRTUAL_ACCOUNT') then
    raise exception using errcode = '22023', message = '지원하지 않는 결제수단입니다.';
  end if;
  if char_length(btrim(coalesce(p_store_id, ''))) not between 1 and 200 then
    raise exception using errcode = '22023', message = '포트원 상점 정보를 확인해 주세요.';
  end if;

  select coalesce(requirements.enforce_verified_profile, false)
  into v_requires_verified_profile
  from public.kakao_profile_requirements as requirements
  where requirements.singleton;
  v_requires_verified_profile := coalesce(v_requires_verified_profile, false);

  select exists (
    select 1
    from public.owner_hidden_test_members as test_members
    where test_members.test_user_id = p_member_id
      and test_members.retired_at is null
  ) into v_is_active_owner_test_member;

  if public.access_role_for_user(p_member_id) not in ('band_member', 'member')
    or (
      not v_is_active_owner_test_member
      and not public.auth_user_has_kakao_identity(p_member_id)
    )
    or not exists (
      select 1
      from public.member_accounts as accounts
      where accounts.member_id = p_member_id
        and accounts.account_status = 'active'
    )
    or (
      not v_is_active_owner_test_member
      and v_requires_verified_profile
      and not exists (
        select 1
        from public.kakao_member_profiles as kakao_profiles
        where kakao_profiles.member_id = p_member_id
          and kakao_profiles.profile_complete
      )
    )
  then
    raise exception using errcode = '42501', message = '결제할 수 있는 카카오 회원 계정이 아닙니다.';
  end if;

  select products.*
  into v_product
  from public.products as products
  where products.id = p_product_id
  for update;

  if not found or v_product.status <> 'closed' then
    raise exception using errcode = 'P0002', message = '결제할 수 있는 마감 상품을 찾지 못했습니다.';
  end if;

  select bids.bidder_id, bids.amount
  into v_winner_id, v_winning_amount
  from public.auction_bids as bids
  where bids.product_id = p_product_id
  order by bids.amount desc, bids.created_at desc, bids.id desc
  limit 1;

  if v_winner_id is null or v_winner_id <> p_member_id then
    raise exception using errcode = '42501', message = '낙찰자만 해당 상품을 결제할 수 있습니다.';
  end if;
  if v_winning_amount is null or v_winning_amount <= 0 then
    raise exception using errcode = '22000', message = '낙찰 금액을 확정할 수 없습니다.';
  end if;

  select orders.*
  into v_order
  from public.payment_orders as orders
  where orders.product_id = p_product_id
  for update;

  if v_order.id is null then
    if exists (
      select 1
      from public.payment_attempts as attempts
      where attempts.payment_id = p_payment_id
    ) then
      raise exception using errcode = '23505', message = '이미 사용된 결제 고유번호입니다.';
    end if;

    insert into public.payment_orders (
      product_id,
      buyer_id,
      order_name,
      expected_amount,
      currency,
      payment_id,
      requested_method,
      store_id
    )
    values (
      p_product_id,
      p_member_id,
      v_product.title,
      v_winning_amount,
      'KRW',
      p_payment_id,
      p_requested_method,
      btrim(p_store_id)
    )
    returning * into v_order;

    insert into public.payment_attempts (
      payment_id,
      order_id,
      requested_method,
      store_id,
      expected_amount,
      currency
    )
    values (
      p_payment_id,
      v_order.id,
      p_requested_method,
      btrim(p_store_id),
      v_winning_amount,
      'KRW'
    );
  else
    if v_order.buyer_id is null or v_order.buyer_id <> p_member_id then
      raise exception using errcode = '42501', message = '해당 주문의 결제 권한이 없습니다.';
    end if;
    if v_order.expected_amount <> v_winning_amount then
      raise exception using errcode = '22000', message = '저장된 주문 금액과 낙찰 금액이 일치하지 않습니다.';
    end if;

    if v_order.payment_id = p_payment_id then
      select attempts.*
      into v_attempt
      from public.payment_attempts as attempts
      where attempts.payment_id = p_payment_id
        and attempts.order_id = v_order.id;

      if v_attempt.payment_id is null
        or v_attempt.requested_method <> p_requested_method
        or v_attempt.store_id <> btrim(p_store_id)
        or v_order.store_id <> btrim(p_store_id)
      then
        raise exception using errcode = '22000', message = '결제 재시도 정보가 기존 주문과 일치하지 않습니다.';
      end if;
    else
      -- A new ID is allowed only after an authoritative FAILED state.
      if v_order.portone_status is distinct from 'FAILED'
      then
        raise exception using errcode = '55000', message = '이미 진행 중이거나 종료된 결제가 있습니다.';
      end if;
      if exists (
        select 1
        from public.payment_attempts as attempts
        where attempts.payment_id = p_payment_id
      ) then
        raise exception using errcode = '23505', message = '이미 사용된 결제 고유번호입니다.';
      end if;

      insert into public.payment_attempts (
        payment_id,
        order_id,
        requested_method,
        store_id,
        expected_amount,
        currency
      )
      values (
        p_payment_id,
        v_order.id,
        p_requested_method,
        btrim(p_store_id),
        v_order.expected_amount,
        v_order.currency
      );

      update public.payment_orders as orders
      set
        payment_id = p_payment_id,
        requested_method = p_requested_method,
        store_id = btrim(p_store_id),
        payment_method = null,
        vbank_num = null,
        vbank_bank = null,
        vbank_due = null,
        payment_status = '대기중',
        portone_status = null,
        portone_status_changed_at = null,
        paid_at = null
      where orders.id = v_order.id
      returning * into v_order;
    end if;
  end if;

  return query
  select
    v_order.payment_id,
    v_order.product_id,
    v_order.order_name,
    v_order.expected_amount,
    v_order.payment_status;
end;
$$;

revoke all on function public.prepare_portone_payment(uuid, uuid, text, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.prepare_portone_payment(uuid, uuid, text, text, text)
to service_role;

-- Manual product editing remains available for descriptive fields and pending
-- queue review, but it can no longer manufacture an unaudited closed auction or
-- alter live auction economics. Those operations must use the audited owner RPCs.
create or replace function public.update_managed_product(
  p_product_id uuid,
  p_title text,
  p_description text,
  p_starting_price bigint,
  p_bid_increment bigint,
  p_status text,
  p_publish_at timestamptz,
  p_expected_updated_at timestamptz
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_has_bids boolean;
  v_kst_date date;
  v_kst_time time;
  v_closes_at timestamptz;
begin
  if not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 160
    or char_length(btrim(coalesce(p_description, ''))) not between 1 and 10000
    or p_starting_price not between 1 and 1000000000
    or p_bid_increment not between 1 and 100000000
    or p_status not in ('pending', 'active')
    or p_publish_at is null
    or p_expected_updated_at is null
  then
    raise exception using errcode = '22023', message = '상품 수정 값을 확인해 주세요.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '상품을 찾을 수 없습니다.';
  end if;
  if v_product.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = '다른 운영자가 먼저 수정했습니다. 목록을 새로고침해 주세요.';
  end if;

  select exists (
    select 1 from public.auction_bids as bids where bids.product_id = p_product_id
  ) into v_has_bids;

  if v_product.status = 'closed' then
    raise exception using
      errcode = 'P0001',
      message = '마감된 상품은 일반 상품 수정으로 변경할 수 없습니다.';
  end if;
  if v_product.status = 'active' and p_status <> 'active' then
    raise exception using
      errcode = 'P0001',
      message = '진행 중인 경매는 대기 상태로 되돌릴 수 없습니다.';
  end if;
  if v_product.status = 'active'
    and p_publish_at <> v_product.publish_at
  then
    raise exception using
      errcode = 'P0001',
      message = '진행 중인 경매의 공개 시각은 변경할 수 없습니다.';
  end if;
  if v_product.status = 'active'
    and p_starting_price <> v_product.starting_price
  then
    raise exception using
      errcode = 'P0001',
      message = '진행 중인 경매 가격은 감사 기록이 남는 전용 가격 조정으로만 변경할 수 있습니다.';
  end if;
  if v_product.status = 'active'
    and p_bid_increment <> v_product.bid_increment
  then
    raise exception using
      errcode = 'P0001',
      message = '진행 중인 경매의 입찰 단위는 변경할 수 없습니다.';
  end if;

  if v_has_bids and (
    p_starting_price <> v_product.starting_price
    or p_bid_increment <> v_product.bid_increment
  ) then
    raise exception using errcode = 'P0001', message = '입찰이 시작된 상품의 가격은 변경할 수 없습니다.';
  end if;
  if v_has_bids and (
    btrim(p_title) <> v_product.title
    or btrim(p_description) <> v_product.description
  ) then
    raise exception using errcode = 'P0001', message = '입찰이 시작된 상품의 제목과 설명은 변경할 수 없습니다.';
  end if;
  if v_has_bids and p_publish_at <> v_product.publish_at then
    raise exception using errcode = 'P0001', message = '입찰이 시작된 상품의 공개 시각은 변경할 수 없습니다.';
  end if;
  if v_has_bids and p_status = 'pending' then
    raise exception using errcode = 'P0001', message = '입찰이 시작된 상품은 공개 대기 상태로 되돌릴 수 없습니다.';
  end if;
  v_kst_date := (p_publish_at at time zone 'Asia/Seoul')::date;
  v_kst_time := (p_publish_at at time zone 'Asia/Seoul')::time;
  v_closes_at := case
    when v_product.status = 'active' then v_product.closes_at
    else (
      v_kst_date + case when v_kst_time >= time '21:00:00' then 1 else 0 end
      + time '21:00:00'
    ) at time zone 'Asia/Seoul'
  end;

  update public.products
  set
    title = btrim(p_title),
    description = btrim(p_description),
    starting_price = p_starting_price,
    current_price = case
      when v_product.status = 'active' or v_has_bids
        then v_product.current_price
      else p_starting_price
    end,
    bid_increment = p_bid_increment,
    status = p_status,
    publish_at = p_publish_at,
    closes_at = v_closes_at,
    updated_by = auth.uid()
  where id = p_product_id;

  return query select products.* from public.products as products
  where products.id = p_product_id;
end;
$$;

revoke all on function public.update_managed_product(
  uuid, text, text, bigint, bigint, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.update_managed_product(
  uuid, text, text, bigint, bigint, text, timestamptz, timestamptz
) to authenticated;

-- Match the stronger append-only guarantees used by the other owner audit
-- tables. The trigger is statement-level so TRUNCATE is covered atomically.
alter table public.owner_auction_action_audit force row level security;
revoke all on public.owner_auction_action_audit
from public, anon, authenticated, service_role;
grant select on public.owner_auction_action_audit to authenticated;

drop trigger if exists owner_auction_action_audit_immutable
on public.owner_auction_action_audit;
create trigger owner_auction_action_audit_immutable
before update or delete or truncate on public.owner_auction_action_audit
for each statement execute function public.prevent_owner_auction_audit_mutation();
