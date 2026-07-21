-- Scope operator-triggered second-chance processing to the selected product.
-- The scheduled processor remains global; this private mirror preserves its
-- state transitions while preventing a staff retry from processing unrelated
-- purchase offers or products.

create or replace function app_private.process_auction_purchase_offer_for_product(
  p_product_id uuid,
  p_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer_id uuid;
  v_product public.products%rowtype;
  v_offer public.auction_purchase_offers%rowtype;
  v_next_bid public.auction_bids%rowtype;
  v_sanction_id uuid;
  v_participant_count integer;
  v_bid_history jsonb;
  v_top_amount bigint;
  v_processed integer := 0;
  v_second_chance_hours integer;
begin
  if p_product_id is null then
    raise exception using
      errcode = '22023',
      message = '세컨드 찬스를 처리할 경매를 선택해 주세요.';
  end if;
  if p_at is null then
    raise exception using errcode = '22023', message = '결제 만료 기준 시각이 필요합니다.';
  end if;

  if not exists (
    select 1 from public.payment_runtime_settings as settings
    where settings.singleton and settings.active_mode = 'manual_transfer'
  ) then
    return 0;
  end if;

  select settings.second_chance_hours
  into v_second_chance_hours
  from public.auction_revenue_defense_settings as settings
  where settings.singleton;

  -- Only auctions closed after policy activation are seeded. Existing orders
  -- are never retroactively expired or penalised by this migration.
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
  )
  select
    products.id,
    1,
    'original',
    winner.id,
    winner.bidder_id,
    winner.bidder_display_name,
    winner.amount,
    'payment_due',
    products.closes_at,
    case
      when public.is_payment_deadline_exempt(winner.bidder_id)
        or public.is_owner_hidden_test_member(winner.bidder_id)
      then null
      else app_private.original_manual_payment_due_at(products.closes_at, p_at)
    end
  from public.products as products
  join public.auction_bids as winner
    on winner.id = products.final_bid_id
   and winner.product_id = products.id
  cross join public.auction_revenue_defense_settings as policy
  where products.id = p_product_id
    and products.status = 'closed'
    and products.closes_at >= policy.policy_effective_at
    and policy.singleton
    and not public.is_owner_hidden_test_member(winner.bidder_id)
    and not exists (
      select 1 from public.auction_purchase_offers as offers
      where offers.product_id = products.id
    )
  on conflict (product_id, offer_round) do nothing;

  -- Reconcile operator-confirmed transfers before evaluating deadlines.
  update public.auction_purchase_offers as offers
  set
    status = 'settled',
    settled_at = (
      select max(manual_orders.confirmed_at)
      from public.manual_transfer_orders as manual_orders
      where manual_orders.purchase_offer_id = offers.id
        and manual_orders.status = 'confirmed'
    )
  where offers.product_id = p_product_id
    and offers.status in ('payment_due', 'accepted')
    and exists (
      select 1
      from public.manual_transfer_orders as manual_orders
      where manual_orders.purchase_offer_id = offers.id
        and manual_orders.status = 'confirmed'
    );

  -- An unaccepted second chance is optional. Expiry carries no warning.
  for v_offer_id in
    select offers.id
    from public.auction_purchase_offers as offers
    where offers.product_id = p_product_id
      and offers.status = 'offered'
      and offers.response_due_at <= p_at
    order by offers.response_due_at, offers.id
  loop
    select products.* into v_product
    from public.products as products
    join public.auction_purchase_offers as offers
      on offers.product_id = products.id
    where offers.id = v_offer_id
    for update of products;

    select offers.* into v_offer
    from public.auction_purchase_offers as offers
    where offers.id = v_offer_id
    for update;

    if v_offer.status = 'offered' and v_offer.response_due_at <= p_at then
      update public.auction_purchase_offers
      set status = 'expired_offer'
      where id = v_offer.id;
      v_processed := v_processed + 1;
    end if;
  end loop;

  for v_offer_id in
    select offers.id
    from public.auction_purchase_offers as offers
    where offers.product_id = p_product_id
      and offers.status in ('payment_due', 'accepted')
      and offers.payment_due_at is not null
      and offers.payment_due_at <= p_at
    order by offers.payment_due_at, offers.id
  loop
    select products.* into v_product
    from public.products as products
    join public.auction_purchase_offers as offers
      on offers.product_id = products.id
    where offers.id = v_offer_id
    for update of products;

    select offers.* into v_offer
    from public.auction_purchase_offers as offers
    where offers.id = v_offer_id
    for update;

    if v_offer.status not in ('payment_due', 'accepted')
      or v_offer.payment_due_at is null
      or v_offer.payment_due_at > p_at
    then
      continue;
    end if;

    if app_private.is_product_payment_settled(
      v_offer.product_id,
      v_offer.bidder_id
    ) then
      update public.auction_purchase_offers
      set status = 'settled', settled_at = p_at
      where id = v_offer.id;
      continue;
    end if;

    -- A member promoted to the legacy band tier after winning receives the
    -- same no-deadline protection as a member who already had it at close.
    if public.is_payment_deadline_exempt(v_offer.bidder_id)
      or public.is_owner_hidden_test_member(v_offer.bidder_id)
    then
      update public.auction_purchase_offers
      set payment_due_at = null
      where id = v_offer.id;
      update public.manual_transfer_orders as manual_orders
      set due_at = null
      where manual_orders.purchase_offer_id = v_offer.id
        and manual_orders.status = 'awaiting_manual_transfer';
      continue;
    end if;

    v_sanction_id := app_private.apply_system_late_payment_warning(
      v_offer.id,
      v_offer.bidder_id,
      p_at
    );

    update public.manual_transfer_orders as manual_orders
    set
      status = 'cancelled_unpaid',
      cancelled_at = p_at,
      cancellation_reason = '입금 기한 초과'
    where manual_orders.purchase_offer_id = v_offer.id
      and manual_orders.status = 'awaiting_manual_transfer';

    update public.auction_purchase_offers
    set status = 'expired_unpaid'
    where id = v_offer.id
      and status in ('payment_due', 'accepted');

    insert into public.cancelled_auction_bids (
      original_bid_id,
      product_id,
      bidder_id,
      bidder_display_name,
      amount,
      original_created_at,
      was_final,
      sanction_id,
      cancelled_at,
      cancellation_reason
    )
    select
      bids.id,
      bids.product_id,
      bids.bidder_id,
      bids.bidder_display_name,
      bids.amount,
      bids.created_at,
      bids.is_final,
      v_sanction_id,
      p_at,
      'unpaid_winner_expired'
    from public.auction_bids as bids
    where bids.product_id = v_offer.product_id
      and bids.bidder_id = v_offer.bidder_id
    on conflict (original_bid_id) do nothing;

    -- products.final_bid_id has a restrictive FK to the bid ledger. Clear the
    -- canonical winner before preserving the defaulted rows in the archive.
    update public.products as products
    set
      bid_locked_at = null,
      final_bid_id = null,
      final_bid_amount = null
    where products.id = v_offer.product_id;

    delete from public.auction_bids as bids
    where bids.product_id = v_offer.product_id
      and bids.bidder_id = v_offer.bidder_id;

    select count(distinct bids.bidder_id)::integer
    into v_participant_count
    from public.auction_bids as bids
    where bids.product_id = v_offer.product_id
      and bids.bidder_id is not null;

    -- Keep cancelled bids in the public, append-only presentation so the
    -- winner transition cannot look like an operator erased a higher bid.
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', history.bid_id::text,
          'bidAt', history.bid_at,
          'bidderName', history.bidder_name,
          'amount', history.amount,
          'outcome', history.outcome
        ) order by history.bid_at desc, history.bid_id desc
      ),
      '[]'::jsonb
    ) into v_bid_history
    from (
      select
        bids.id as bid_id,
        bids.created_at as bid_at,
        bids.bidder_display_name as bidder_name,
        bids.amount,
        'active'::text as outcome
      from public.auction_bids as bids
      where bids.product_id = v_offer.product_id
      union all
      select
        cancelled.original_bid_id,
        cancelled.original_created_at,
        cancelled.bidder_display_name,
        cancelled.amount,
        case
          when cancelled.cancellation_reason = 'unpaid_winner_expired'
          then 'unpaid_cancelled'
          else 'cancelled'
        end
      from public.cancelled_auction_bids as cancelled
      where cancelled.product_id = v_offer.product_id
    ) as history;

    select bids.amount into v_top_amount
    from public.auction_bids as bids
    where bids.product_id = v_offer.product_id
    order by bids.amount desc, bids.created_at, bids.id
    limit 1;

    update public.auction_bids as bids
    set is_final = false
    where bids.product_id = v_offer.product_id and bids.is_final;

    update public.products as products
    set
      current_price = coalesce(v_top_amount, products.starting_price),
      participant_count = coalesce(v_participant_count, 0),
      bid_history = v_bid_history,
      bid_locked_at = null,
      final_bid_id = null,
      final_bid_amount = null
    where products.id = v_offer.product_id;

    -- Only the original winner can produce the requested second-chance round.
    -- A second-chance decline/expiry never penalises or silently binds a third
    -- bidder.
    if v_offer.offer_kind = 'original' then
      v_next_bid := null;
      select bids.* into v_next_bid
      from public.auction_bids as bids
      where bids.product_id = v_offer.product_id
        and bids.bidder_id is not null
        and coalesce(public.access_role_for_user(bids.bidder_id), '')
          in ('member', 'band_member')
        and not public.is_owner_hidden_test_member(bids.bidder_id)
        and exists (
          select 1
          from public.member_accounts as accounts
          where accounts.member_id = bids.bidder_id
            and accounts.account_status = 'active'
        )
        and not exists (
          select 1
          from public.member_bid_sanctions as sanctions
          where sanctions.member_id = bids.bidder_id
            and sanctions.starts_at <= p_at
            and sanctions.ends_at > p_at
        )
      order by bids.amount desc, bids.created_at, bids.id
      limit 1;

      if v_next_bid.id is not null then
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
          response_due_at,
          payment_due_at,
          previous_offer_id
        ) values (
          v_offer.product_id,
          2,
          'second_chance',
          v_next_bid.id,
          v_next_bid.bidder_id,
          v_next_bid.bidder_display_name,
          v_next_bid.amount,
          'offered',
          p_at,
          p_at + make_interval(hours => v_second_chance_hours),
          case
            when public.is_payment_deadline_exempt(v_next_bid.bidder_id)
            then null
            else p_at + make_interval(hours => v_second_chance_hours)
          end,
          v_offer.id
        ) on conflict (product_id, offer_round) do nothing;
      end if;
    end if;

    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

revoke all on function
app_private.process_auction_purchase_offer_for_product(uuid, timestamptz)
from public, anon, authenticated, service_role;

create or replace function public.operator_process_second_chance(
  p_product_id uuid
)
returns table (
  product_id uuid,
  processed_count integer,
  offer_id uuid,
  offer_status text,
  bidder_display_name text,
  offered_amount bigint,
  response_due_at timestamptz,
  server_time timestamptz
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
  v_second public.auction_purchase_offers%rowtype;
  v_processed integer := 0;
begin
  if p_product_id is null then
    raise exception using
      errcode = '22023',
      message = '세컨드 찬스를 처리할 경매를 선택해 주세요.';
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
      message = '마감된 경매만 세컨드 찬스를 처리할 수 있습니다.';
  end if;

  select offers.*
  into v_second
  from public.auction_purchase_offers as offers
  where offers.product_id = p_product_id
    and offers.offer_kind = 'second_chance'
  order by offers.offer_round desc
  limit 1;

  if found then
    return query select
      p_product_id,
      0,
      v_second.id,
      v_second.status,
      v_second.bidder_display_name_snapshot,
      v_second.offered_amount,
      v_second.response_due_at,
      v_now;
    return;
  end if;

  select offers.*
  into v_original
  from public.auction_purchase_offers as offers
  where offers.product_id = p_product_id
    and offers.offer_kind = 'original'
  order by offers.offer_round
  limit 1;

  if found then
    if v_original.status = 'settled' then
      raise exception using
        errcode = 'P0001',
        message = '이미 결제가 완료된 낙찰입니다.';
    end if;
    if v_original.status in ('payment_due', 'accepted')
      and (
        v_original.payment_due_at is null
        or v_original.payment_due_at > v_now
      )
    then
      raise exception using
        errcode = 'P0001',
        message = '원 낙찰자의 결제 기한이 아직 지나지 않았습니다.';
    end if;
    if v_original.status not in (
      'payment_due', 'accepted', 'expired_unpaid'
    ) then
      raise exception using
        errcode = 'P0001',
        message = '현재 세컨드 찬스를 생성할 수 없는 낙찰 상태입니다.';
    end if;
  elsif v_product.final_bid_id is null then
    raise exception using
      errcode = 'P0001',
      message = '차순위 처리할 낙찰 원장이 없습니다.';
  end if;

  -- This is the same idempotent, deadline-gated processor already executed by
  -- pg_cron. The operator cannot supply a client timestamp or advance a live
  -- payment deadline; the target check above only exposes an explicit retry.
  v_processed := app_private.process_auction_purchase_offer_for_product(
    p_product_id,
    v_now
  );

  select offers.*
  into v_second
  from public.auction_purchase_offers as offers
  where offers.product_id = p_product_id
    and offers.offer_kind = 'second_chance'
  order by offers.offer_round desc
  limit 1;

  select offers.*
  into v_original
  from public.auction_purchase_offers as offers
  where offers.product_id = p_product_id
    and offers.offer_kind = 'original'
  order by offers.offer_round
  limit 1;

  if v_second.id is null
    and (
      v_original.id is null
      or v_original.status <> 'expired_unpaid'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = '결제 기한이 지난 원 낙찰을 확인할 수 없습니다.';
  end if;

  perform app_private.write_security_activity(
    v_actor,
    v_second.bidder_id,
    'auction',
    'auction.second_chance.processed',
    'process',
    'operator_process_second_chance',
    'product',
    p_product_id::text,
    'notice',
    null,
    null,
    jsonb_build_object(
      'product_id', p_product_id,
      'processor_count', v_processed,
      'second_chance_offer_id', v_second.id,
      'result', case
        when v_second.id is null then 'no_successor'
        else v_second.status
      end
    ),
    v_now
  );

  return query select
    p_product_id,
    v_processed,
    v_second.id,
    case
      when v_second.id is null then 'no_successor'
      else v_second.status
    end,
    v_second.bidder_display_name_snapshot,
    v_second.offered_amount,
    v_second.response_due_at,
    v_now;
end;
$$;

revoke all on function public.operator_process_second_chance(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.operator_process_second_chance(uuid)
to authenticated;

comment on function public.operator_process_second_chance(uuid) is
  'Owner/operator assigned-store, product-scoped retry of the DB-clock, deadline-gated second-chance processor';
