-- One-click recovery for closed auctions whose winning bidder did not pay
-- within the settlement deadline. Operators choose, per product:
--   * reauction : relist as an auction queued for the next 10:00 KST drop
--   * fixed     : convert to a buy-now product priced at the winning amount
-- The second-chance offer flow keeps its dedicated endpoint and RPC.

create or replace function public.operator_recover_unpaid_auction(
  p_product_id uuid,
  p_mode text
)
returns table (
  product_id uuid,
  mode text,
  status text,
  publish_at timestamptz,
  closes_at timestamptz,
  price bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_now timestamptz := clock_timestamp();
  v_product public.products%rowtype;
  v_original public.auction_purchase_offers%rowtype;
  v_publish_at timestamptz;
  v_price bigint;
begin
  if p_product_id is null then
    raise exception using
      errcode = '22023',
      message = '복구할 경매 상품을 선택해 주세요.';
  end if;
  if p_mode not in ('reauction', 'fixed') then
    raise exception using
      errcode = '22023',
      message = '재경매 또는 즉시구매 전환 중 하나를 선택해 주세요.';
  end if;

  v_role := public.access_role_for_user(v_actor);
  if v_actor is null or v_role not in ('owner', 'operator') then
    raise exception using
      errcode = '42501',
      message = '소유자 또는 운영자 권한이 필요합니다.';
  end if;

  select products.*
  into v_product
  from public.products as products
  where products.id = p_product_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '경매 상품을 찾을 수 없습니다.';
  end if;
  if not public.can_manage_product_store(v_product.store_id) then
    raise exception using
      errcode = '42501',
      message = '담당 숍의 경매만 복구할 수 있습니다.';
  end if;
  if v_product.sale_type <> 'auction' or v_product.status <> 'closed' then
    raise exception using
      errcode = 'P0001',
      message = '마감된 경매만 복구할 수 있습니다.';
  end if;
  if v_product.sale_completed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = '이미 판매가 완료된 상품입니다.';
  end if;

  if exists (
    select 1
    from public.auction_purchase_offers as offers
    where offers.product_id = p_product_id
      and offers.status in ('payment_due', 'offered', 'accepted')
  ) then
    raise exception using
      errcode = 'P0001',
      message = '결제 기한이 남아 있거나 결제가 진행 중입니다. 기한 만료 후 다시 시도해 주세요.';
  end if;

  select offers.*
  into v_original
  from public.auction_purchase_offers as offers
  where offers.product_id = p_product_id
    and offers.offer_kind = 'original'
  order by offers.offer_round
  limit 1;

  if not found then
    if v_product.final_bid_id is null then
      raise exception using
        errcode = 'P0001',
        message = '낙찰자가 없는 경매는 지난 상품 재등록을 사용해 주세요.';
    end if;
    raise exception using
      errcode = 'P0001',
      message = '낙찰 결제 처리가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.';
  end if;
  if v_original.status = 'settled' then
    raise exception using
      errcode = 'P0001',
      message = '이미 결제가 완료된 낙찰입니다.';
  end if;
  if v_original.status <> 'expired_unpaid' then
    raise exception using
      errcode = 'P0001',
      message = '미결제로 만료된 낙찰만 복구할 수 있습니다.';
  end if;

  if p_mode = 'reauction' then
    -- "다음 날 자동 편성": the shared drop scheduler picks the next 10:00 KST
    -- slot, exactly like the no-bid relist flow.
    v_publish_at := public.next_auction_drop_at(v_now);
    update public.products
    set status = 'active',
        publish_at = v_publish_at,
        closes_at = public.auction_close_at(v_publish_at),
        auction_feed_expires_at = v_publish_at + interval '7 days',
        current_price = starting_price,
        bid_locked_at = null,
        final_bid_id = null,
        final_bid_amount = null,
        past_at = null,
        past_expires_at = null,
        past_action = null,
        updated_by = v_actor
    where products.id = p_product_id;

    perform app_private.write_security_activity(
      v_actor,
      null,
      'auction',
      'auction.unpaid.reauction',
      'process',
      'operator_recover_unpaid_auction',
      'product',
      p_product_id::text,
      'notice',
      null,
      null,
      jsonb_build_object(
        'product_id', p_product_id,
        'mode', 'reauction',
        'publish_at', v_publish_at,
        'closes_at', public.auction_close_at(v_publish_at)
      ),
      v_now
    );

    return query select
      p_product_id,
      'reauction',
      'active',
      v_publish_at,
      public.auction_close_at(v_publish_at),
      v_product.starting_price;
    return;
  end if;

  -- Buy-now conversion prices the item at the expired winning amount so the
  -- seller keeps the realized demand instead of restarting from the floor.
  v_price := coalesce(v_product.final_bid_amount, v_product.current_price);
  if v_price is null or v_price not between 1 and 1000000000 then
    raise exception using
      errcode = '22023',
      message = '즉시구매 가격으로 사용할 낙찰가를 확인해 주세요.';
  end if;

  update public.products
  set sale_type = 'fixed',
      fixed_price = v_price,
      starting_price = v_price,
      current_price = v_price,
      status = 'active',
      publish_at = v_now,
      closes_at = timestamptz '9999-12-31 23:59:59+00',
      auction_feed_expires_at = null,
      bid_locked_at = null,
      final_bid_id = null,
      final_bid_amount = null,
      past_at = null,
      past_expires_at = null,
      past_action = null,
      updated_by = v_actor
  where products.id = p_product_id;

  perform app_private.write_security_activity(
    v_actor,
    null,
    'auction',
    'auction.unpaid.fixed_conversion',
    'process',
    'operator_recover_unpaid_auction',
    'product',
    p_product_id::text,
    'notice',
    null,
    null,
    jsonb_build_object(
      'product_id', p_product_id,
      'mode', 'fixed',
      'fixed_price', v_price
    ),
    v_now
  );

  return query select
    p_product_id,
    'fixed',
    'active',
    v_now,
    timestamptz '9999-12-31 23:59:59+00',
    v_price;
end;
$$;

revoke all on function public.operator_recover_unpaid_auction(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.operator_recover_unpaid_auction(uuid, text)
to authenticated;

comment on function public.operator_recover_unpaid_auction(uuid, text) is
  'Owner/operator one-click recovery of an expired-unpaid auction winner: relist at the next 10:00 KST drop or convert to a buy-now product priced at the winning amount; audited and store-scoped';
