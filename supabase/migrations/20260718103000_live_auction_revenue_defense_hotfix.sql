-- Production hotfix for the live-auction revenue defence migration.
--
-- 1. PL/pgSQL output columns are variables, so an unqualified
--    ON CONFLICT (product_id, offer_round) target is ambiguous inside
--    begin_manual_transfer. Target the generated unique constraint directly.
-- 2. The second-chance projection reads clock_timestamp(), so it must be
--    VOLATILE rather than STABLE.

create or replace function public.get_my_second_chance_offers()
returns table (
  offer_id uuid,
  product_id uuid,
  product_title text,
  image_urls text[],
  offered_amount bigint,
  offered_at timestamptz,
  expires_at timestamptz,
  status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;

  return query
  select
    offers.id,
    offers.product_id,
    products.title,
    products.image_urls,
    offers.offered_amount,
    offers.offered_at,
    offers.response_due_at,
    offers.status
  from public.auction_purchase_offers as offers
  join public.products as products on products.id = offers.product_id
  where offers.bidder_id = auth.uid()
    and offers.offer_kind = 'second_chance'
    and offers.status = 'offered'
    and offers.response_due_at > clock_timestamp()
  order by offers.response_due_at, offers.id;
end;
$$;

revoke all on function public.get_my_second_chance_offers()
from public, anon;
grant execute on function public.get_my_second_chance_offers()
to authenticated;

create or replace function public.begin_manual_transfer(
  p_product_id uuid
)
returns table (
  order_id uuid,
  product_id uuid,
  order_name text,
  expected_amount bigint,
  status text,
  bank_name text,
  account_number text,
  requested_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz,
  is_payment_settled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_product public.products%rowtype;
  v_order public.manual_transfer_orders%rowtype;
  v_offer public.auction_purchase_offers%rowtype;
  v_winner_id uuid;
  v_winner_name text;
  v_winning_amount bigint;
  v_settings public.payment_runtime_settings%rowtype;
  v_policy_effective_at timestamptz;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;
  if not public.auth_user_has_kakao_identity(v_user_id)
    or not exists (
      select 1
      from public.member_accounts as accounts
      where accounts.member_id = v_user_id
        and accounts.account_status = 'active'
    )
  then
    raise exception using errcode = '42501', message = '결제할 수 있는 활성 카카오 회원이 아닙니다.';
  end if;
  if p_product_id is null then
    raise exception using errcode = '22023', message = '결제할 상품을 선택해 주세요.';
  end if;

  select settings.* into v_settings
  from public.payment_runtime_settings as settings
  where settings.singleton
  for share;
  if v_settings.active_mode <> 'manual_transfer' then
    raise exception using errcode = '55000', message = '현재 계좌이체 결제를 이용할 수 없습니다.';
  end if;
  if v_settings.bank_name is null or v_settings.account_number is null then
    raise exception using errcode = '55000', message = '운영 계좌가 아직 등록되지 않았습니다.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
    and products.status = 'closed'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '결제할 수 있는 마감 상품을 찾지 못했습니다.';
  end if;

  select bids.bidder_id, bids.bidder_display_name, bids.amount
  into v_winner_id, v_winner_name, v_winning_amount
  from public.auction_bids as bids
  where bids.id = v_product.final_bid_id
    and bids.product_id = v_product.id;
  if v_winner_id is null or v_winner_id <> v_user_id then
    raise exception using errcode = '42501', message = '현재 결제 권한을 가진 낙찰자만 계좌번호를 확인할 수 있습니다.';
  end if;
  if v_winning_amount is null
    or v_winning_amount <= 0
    or v_winning_amount is distinct from v_product.final_bid_amount
  then
    raise exception using errcode = '22000', message = '낙찰 금액을 확정할 수 없습니다.';
  end if;

  perform orders.id
  from public.payment_orders as orders
  where orders.product_id = p_product_id
  for update;
  if exists (
    select 1 from public.payment_orders as orders
    where orders.product_id = p_product_id
      and orders.buyer_id = v_user_id
      and orders.payment_status = '결제완료'
      and orders.portone_status = 'PAID'
  ) then
    raise exception using errcode = '55000', message = '이미 결제가 완료된 상품입니다.';
  end if;

  select offers.* into v_offer
  from public.auction_purchase_offers as offers
  where offers.product_id = p_product_id
    and offers.bidder_id = v_user_id
    and offers.status in ('payment_due', 'accepted', 'settled')
  order by offers.offer_round desc
  limit 1
  for update;

  select policy.policy_effective_at into v_policy_effective_at
  from public.auction_revenue_defense_settings as policy
  where policy.singleton;

  if v_offer.id is null and v_product.closes_at >= v_policy_effective_at then
    insert into public.auction_purchase_offers (
      product_id,
      offer_round,
      offer_kind,
      bid_id,
      bidder_id,
      bidder_display_name_snapshot,
      offered_amount,
      status,
      offered_at,
      payment_due_at
    ) values (
      v_product.id,
      1,
      'original',
      v_product.final_bid_id,
      v_user_id,
      v_winner_name,
      v_winning_amount,
      'payment_due',
      v_product.closes_at,
      case
        when public.is_payment_deadline_exempt(v_user_id) then null
        else app_private.original_manual_payment_due_at(v_product.closes_at, v_now)
      end
    )
    on conflict on constraint auction_purchase_offers_product_id_offer_round_key
    do update set updated_at = excluded.updated_at
    returning * into v_offer;
  end if;

  if v_offer.status = 'settled' then
    raise exception using errcode = '55000', message = '이미 입금 확인이 완료된 상품입니다.';
  end if;
  if v_offer.id is not null
    and v_offer.payment_due_at is not null
    and v_offer.payment_due_at <= v_now
  then
    raise exception using errcode = '55000', message = '계좌이체 기한이 지나 결제 권한을 사용할 수 없습니다.';
  end if;

  select manual_orders.* into v_order
  from public.manual_transfer_orders as manual_orders
  where manual_orders.product_id = p_product_id
    and manual_orders.buyer_id = v_user_id
    and manual_orders.status in ('awaiting_manual_transfer', 'confirmed')
  order by manual_orders.requested_at desc, manual_orders.id desc
  limit 1
  for update;

  if v_order.id is null then
    insert into public.manual_transfer_orders (
      product_id,
      buyer_id,
      order_name,
      expected_amount,
      bank_name_snapshot,
      account_number_snapshot,
      purchase_offer_id,
      due_at
    ) values (
      p_product_id,
      v_user_id,
      v_product.title,
      v_winning_amount,
      v_settings.bank_name,
      v_settings.account_number,
      v_offer.id,
      v_offer.payment_due_at
    ) returning * into v_order;
  elsif v_order.expected_amount <> v_winning_amount then
    raise exception using errcode = '22000', message = '저장된 주문 금액과 낙찰 금액이 일치하지 않습니다.';
  elsif v_order.purchase_offer_id is distinct from v_offer.id
    and v_offer.id is not null
  then
    raise exception using errcode = '55000', message = '현재 구매 권한과 결제 원장이 일치하지 않습니다.';
  end if;

  perform app_private.write_security_activity(
    v_user_id,
    v_user_id,
    'payment',
    'payment.manual_transfer.account_revealed',
    'read',
    'begin_manual_transfer',
    'manual_transfer_order',
    v_order.id::text,
    'notice',
    null,
    null,
    jsonb_build_object(
      'product_id', v_order.product_id,
      'amount', v_order.expected_amount,
      'payment_status', v_order.status,
      'purchase_offer_id', v_order.purchase_offer_id,
      'due_at', v_order.due_at
    )
  );

  return query select
    v_order.id,
    v_order.product_id,
    v_order.order_name,
    v_order.expected_amount,
    v_order.status,
    v_order.bank_name_snapshot,
    v_order.account_number_snapshot,
    v_order.requested_at,
    v_order.confirmed_at,
    v_order.updated_at,
    v_order.status = 'confirmed';
end;
$$;

revoke all on function public.begin_manual_transfer(uuid)
from public, anon;
grant execute on function public.begin_manual_transfer(uuid)
to authenticated;
