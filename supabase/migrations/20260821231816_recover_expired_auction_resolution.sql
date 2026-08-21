-- One-click operator resolution for auctions whose winner did not pay within
-- the settlement window. Mirrors the second-chance guard rails: a DB-clock
-- reconciliation pass runs first, and the action is rejected while any offer
-- can still be accepted or paid.
--
-- 'relist' retires the closed row as immutable history and clones a fresh
-- auction for the next 10:00 KST drop. The offer ledger is unique per product
-- row ((product_id, offer_round)), so a reused row could never seed a new
-- round; the clone gives the relisted auction a clean offer space.
begin;

-- 'convert_fixed' turns the same row into an immediately purchasable
-- fixed-price listing at the auction's reconciled current price.

create or replace function public.operator_resolve_expired_auction(
  p_product_id uuid,
  p_action text
)
returns table (
  product_id uuid,
  new_product_id uuid,
  action text,
  fixed_price bigint,
  current_price bigint,
  publish_at timestamptz,
  closes_at timestamptz
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
  v_new_product_id uuid;
  v_publish_at timestamptz;
  v_closes_at timestamptz;
begin
  if p_product_id is null then
    raise exception using
      errcode = '22023',
      message = '처리할 경매를 선택해 주세요.';
  end if;
  if p_action not in ('relist', 'convert_fixed') then
    raise exception using
      errcode = '22023',
      message = '재경매 또는 즉시구매 전환 작업만 가능합니다.';
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
  where products.id = p_product_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '경매 상품을 찾을 수 없습니다.';
  end if;
  if not public.can_manage_product_store(v_product.store_id) then
    raise exception using
      errcode = '42501',
      message = '담당 숍의 경매만 처리할 수 있습니다.';
  end if;
  if v_product.sale_type <> 'auction' or v_product.status <> 'closed' then
    raise exception using
      errcode = 'P0001',
      message = '마감된 경매만 처리할 수 있습니다.';
  end if;

  -- Same DB-clock, deadline-gated reconciliation used by the operator
  -- second-chance retry so a stale live offer can never be resolved away and a
  -- successor is deterministically offered before this screen lets an operator
  -- relist or convert.
  perform app_private.process_auction_purchase_offer_for_product(
    p_product_id,
    v_now
  );

  -- Re-read the reconciled row: the processor may have cleared final_bid_id and
  -- moved current_price down to the next top bid or the starting price.
  select products.*
  into v_product
  from public.products as products
  where products.id = p_product_id;

  if exists (
    select 1
    from public.auction_purchase_offers as offers
    where offers.product_id = p_product_id
      and offers.status = 'settled'
  ) then
    raise exception using
      errcode = 'P0001',
      message = '이미 결제가 완료된 낙찰입니다.';
  end if;

  if exists (
    select 1
    from public.auction_purchase_offers as offers
    where offers.product_id = p_product_id
      and offers.status in ('payment_due', 'accepted', 'offered')
      and case
        when offers.status = 'offered'
          then coalesce(offers.response_due_at, offers.offered_at) > v_now
        else coalesce(offers.payment_due_at, offers.offered_at) > v_now
      end
  ) then
    raise exception using
      errcode = 'P0001',
      message = '응답 또는 결제 기한이 지나지 않은 낙찰·차순위 건이 있습니다.';
  end if;

  -- Confirm this is an unpaid-winner situation rather than an empty no-bid
  -- close (those are handled by the past-products console).
  select offers.*
  into v_original
  from public.auction_purchase_offers as offers
  where offers.product_id = p_product_id
    and offers.offer_kind = 'original'
  order by offers.offer_round
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = '미결제 낙찰 원장을 확인할 수 없습니다.';
  end if;
  if v_original.status not in ('expired_unpaid', 'payment_due', 'accepted') then
    raise exception using
      errcode = 'P0001',
      message = '현재 처리할 수 없는 낙찰 상태입니다.';
  end if;

  if p_action = 'relist' then
    -- Pass now as the requested drop anchor: the before-insert schedule trigger
    -- recomputes publish_at/closes_at/feed via next_auction_drop_at(v_now), which
    -- is exactly the same v_publish_at computed above. Passing v_publish_at
    -- itself would be treated as "already 10:00 KST" and bumped another day.
    v_publish_at := public.next_auction_drop_at(v_now);
    v_closes_at := public.auction_close_at(v_publish_at);

    insert into public.products (
      title,
      description,
      category,
      category_id,
      brand,
      brand_slug,
      brand_source,
      gender,
      enhanced_title,
      hashtags,
      defect_tags,
      publish_at,
      closes_at,
      status,
      participant_count,
      starting_price,
      current_price,
      bid_increment,
      image_urls,
      thumbnail_urls,
      bid_history,
      bid_locked_at,
      final_bid_id,
      final_bid_amount,
      anti_sniping_base_closes_at,
      anti_sniping_extended_at,
      anti_sniping_extension_count,
      auction_feed_expires_at,
      past_at,
      past_expires_at,
      past_action,
      sale_type,
      fixed_price,
      store_id,
      inquiry_operator_id,
      created_by,
      updated_by,
      storage_class,
      size_label,
      condition_grade,
      measurements,
      inspection_notes,
      sale_completed_at,
      paused_at
    )
    values (
      v_product.title,
      v_product.description,
      v_product.category,
      v_product.category_id,
      v_product.brand,
      v_product.brand_slug,
      v_product.brand_source,
      v_product.gender,
      v_product.enhanced_title,
      v_product.hashtags,
      v_product.defect_tags,
      v_now,
      v_closes_at,
      'active',
      0,
      v_product.starting_price,
      v_product.starting_price,
      v_product.bid_increment,
      v_product.image_urls,
      v_product.thumbnail_urls,
      '[]'::jsonb,
      null,
      null,
      null,
      null,
      null,
      0,
      null,
      null,
      null,
      'auction',
      null,
      v_product.store_id,
      v_product.inquiry_operator_id,
      v_actor,
      v_actor,
      v_product.storage_class,
      v_product.size_label,
      v_product.condition_grade,
      v_product.measurements,
      v_product.inspection_notes,
      null,
      null
    )
    returning id
    into v_new_product_id;

    update public.products as products
    set past_at = v_now,
        past_expires_at = v_now + interval '3 days',
        past_action = 'relisted',
        updated_by = v_actor
    where products.id = p_product_id;

    perform app_private.write_security_activity(
      v_actor,
      null,
      'auction',
      'auction.relisted',
      'process',
      'operator_resolve_expired_auction',
      'product',
      p_product_id::text,
      'notice',
      null,
      null,
      jsonb_build_object(
        'product_id', p_product_id,
        'new_product_id', v_new_product_id,
        'action', p_action,
        'publish_at', v_publish_at,
        'closes_at', v_closes_at
      ),
      v_now
    );

    return query select
      p_product_id,
      v_new_product_id,
      p_action::text,
      null::bigint,
      v_product.starting_price::bigint,
      v_publish_at,
      v_closes_at;
  end if;

  -- convert_fixed
  v_publish_at := v_now;

  update public.products as products
  set sale_type = 'fixed',
      fixed_price = v_product.current_price,
      current_price = v_product.current_price,
      starting_price = v_product.current_price,
      status = 'active',
      publish_at = v_now,
      bid_locked_at = null,
      final_bid_id = null,
      final_bid_amount = null,
      anti_sniping_base_closes_at = null,
      anti_sniping_extended_at = null,
      anti_sniping_extension_count = 0,
      updated_by = v_actor
  where products.id = p_product_id
  returning * into v_product;

  -- normalize_auction_drop_schedule keeps closes_at at the fixed-price sentinel.
  v_closes_at := v_product.closes_at;

  perform app_private.write_security_activity(
    v_actor,
    null,
    'auction',
    'auction.converted_to_fixed',
    'process',
    'operator_resolve_expired_auction',
    'product',
    p_product_id::text,
    'notice',
    null,
    null,
    jsonb_build_object(
      'product_id', p_product_id,
      'action', p_action,
      'fixed_price', v_product.current_price,
      'publish_at', v_publish_at
    ),
    v_now
  );

  return query select
    p_product_id,
    null::uuid,
    p_action::text,
    v_product.current_price::bigint,
    v_product.current_price::bigint,
    v_publish_at,
    v_closes_at;
end;
$$;

revoke all on function public.operator_resolve_expired_auction(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.operator_resolve_expired_auction(uuid, text)
to authenticated;

comment on function public.operator_resolve_expired_auction(uuid, text) is
  'Owner/operator assigned-store resolution of an unpaid-winner auction: relist for the next 10:00 KST drop or convert to a fixed-price listing at the reconciled current price';

-- The offer ledger has no direct table grants (revoke all + force RLS), so the
-- unpaid-auction console reads it through this store-scoped, owner/operator-only
-- view. can_manage_product_store keeps the store filter honest for operators.
create or replace function public.get_operator_unpaid_auction_offers(
  p_store_ids uuid[]
)
returns table (
  product_id uuid,
  offer_id uuid,
  offer_round integer,
  offer_kind text,
  status text,
  bidder_display_name_snapshot text,
  offered_amount bigint,
  offered_at timestamptz,
  response_due_at timestamptz,
  payment_due_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    offers.product_id,
    offers.id,
    offers.offer_round,
    offers.offer_kind,
    offers.status,
    offers.bidder_display_name_snapshot,
    offers.offered_amount,
    offers.offered_at,
    offers.response_due_at,
    offers.payment_due_at
  from public.auction_purchase_offers as offers
  join public.products as products on products.id = offers.product_id
  where products.sale_type = 'auction'
    and products.status = 'closed'
    and products.past_at is null
    and products.store_id = any(p_store_ids)
    and public.can_manage_product_store(products.store_id)
  order by offers.offered_at, offers.id;
$$;

revoke all on function public.get_operator_unpaid_auction_offers(uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.get_operator_unpaid_auction_offers(uuid[])
to authenticated;

comment on function public.get_operator_unpaid_auction_offers(uuid[]) is
  'Store-scoped offer ledger for the operator unpaid-auction console (owner/operator only)';

commit;
