begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- ---------------------------------------------------------------------------
-- Product publication capacity and automatic overflow scheduling.
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists publication_quota_exempt boolean not null default false;

comment on column public.products.publication_quota_exempt is
  'True only for staff-created replacement listings. Exempt rows do not consume daily or monthly publication capacity.';

-- Keep the expanded row type under a new private function name. PostgreSQL
-- cannot CREATE OR REPLACE a function when OUT parameters change, and the
-- existing production helper has one fewer result column.
create or replace function app_private.store_publication_limits_v2(p_store_id uuid)
returns table(
  effective_plan text,
  immediate_daily_limit integer,
  scheduled_daily_limit integer,
  pending_inventory_limit integer,
  monthly_publication_limit integer,
  automation_rolling_limit integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when subscriptions.plan_code = 'pro' and subscriptions.status = 'active'
      then 'pro' else 'standard' end,
    case when subscriptions.plan_code = 'pro' and subscriptions.status = 'active'
      then 60 else 30 end,
    case when subscriptions.plan_code = 'pro' and subscriptions.status = 'active'
      then 80 else 40 end,
    case when subscriptions.plan_code = 'pro' and subscriptions.status = 'active'
      then 320 else 120 end,
    case when subscriptions.plan_code = 'pro' and subscriptions.status = 'active'
      then 1600 else 800 end,
    case when subscriptions.plan_code = 'pro' and subscriptions.status = 'active'
      and subscriptions.automation_enabled then 300 else 0 end
  from (select p_store_id as store_id) input
  left join public.store_service_subscriptions subscriptions
    on subscriptions.store_id = input.store_id;
$$;

revoke all on function app_private.store_publication_limits_v2(uuid)
from public, anon, authenticated, service_role;

create or replace function app_private.next_publication_overflow_slot(p_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (
    (p_at at time zone 'Asia/Seoul')::date + 1 + time '10:00:00'
  ) at time zone 'Asia/Seoul';
$$;

revoke all on function app_private.next_publication_overflow_slot(timestamptz)
from public, anon, authenticated, service_role;

create or replace function app_private.enforce_store_product_publication_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits record;
  v_pending_count integer;
  v_daily_used integer;
  v_monthly_used integer;
  v_date date := timezone('Asia/Seoul', statement_timestamp())::date;
  v_month_start date := date_trunc('month', timezone('Asia/Seoul', statement_timestamp()))::date;
  v_is_new_pending boolean := new.status = 'pending'
    and (tg_op = 'INSERT' or old.status is distinct from 'pending');
  v_is_publication boolean := new.status = 'active'
    and (tg_op = 'INSERT' or old.status is distinct from 'active');
  v_scheduled boolean;
  v_overflow_at timestamptz;
  v_kst_time time := timezone('Asia/Seoul', statement_timestamp())::time;
begin
  if new.store_id is null then
    return new;
  end if;

  select * into v_limits
  from app_private.store_publication_limits_v2(new.store_id);

  if v_is_new_pending and not new.publication_quota_exempt then
    select count(*) into v_pending_count
    from public.products products
    where products.store_id = new.store_id
      and products.status = 'pending'
      and not products.publication_quota_exempt;

    if v_pending_count >= v_limits.pending_inventory_limit then
      raise exception using
        errcode = 'P0001',
        message = format(
          '초안과 예약 대기는 합계 %s개까지 저장할 수 있습니다.',
          v_limits.pending_inventory_limit
        );
    end if;
  end if;

  if not v_is_publication then
    return new;
  end if;

  v_scheduled := new.publish_at is not null
    and new.publish_at > new.created_at + interval '1 minute';

  -- Immediate publication is never allowed during the closing/sync window.
  if not v_scheduled
    and v_kst_time >= time '21:00:00'
    and v_kst_time < time '22:00:00'
  then
    raise exception using
      errcode = 'P0001',
      message = '오후 9시부터 10시까지는 경매 마감 및 동기화 점검 중이라 즉시 공개할 수 없습니다.';
  end if;

  if new.publication_quota_exempt then
    return new;
  end if;

  select coalesce(sum(
    usage.immediate_publish_count + usage.scheduled_publish_count
  ), 0)::integer
  into v_monthly_used
  from public.store_daily_usage usage
  where usage.store_id = new.store_id
    and usage.usage_date >= v_month_start
    and usage.usage_date < (v_month_start + interval '1 month')::date;

  select case when v_scheduled
      then coalesce(usage.scheduled_publish_count, 0)
      else coalesce(usage.immediate_publish_count, 0)
    end
  into v_daily_used
  from public.store_daily_usage usage
  where usage.store_id = new.store_id
    and usage.usage_date = v_date;
  v_daily_used := coalesce(v_daily_used, 0);

  if v_monthly_used >= v_limits.monthly_publication_limit then
    if v_scheduled then
      v_overflow_at := (
        (v_month_start + interval '1 month')::date + time '10:00:00'
      ) at time zone 'Asia/Seoul';
      new.status := 'pending';
      new.publish_at := v_overflow_at;
      if new.sale_type = 'auction' then
        new.closes_at := public.auction_close_at(v_overflow_at);
        new.auction_feed_expires_at := v_overflow_at + interval '3 days';
      end if;
      return new;
    end if;

    raise exception using
      errcode = 'P0001',
      message = format('이번 달 공개 한도 %s건을 모두 사용했습니다.', v_limits.monthly_publication_limit);
  end if;

  if (v_scheduled and v_daily_used >= v_limits.scheduled_daily_limit)
    or (not v_scheduled and v_daily_used >= v_limits.immediate_daily_limit)
  then
    if v_scheduled then
      v_overflow_at := app_private.next_publication_overflow_slot(
        greatest(statement_timestamp(), new.publish_at)
      );
      new.status := 'pending';
      new.publish_at := v_overflow_at;
      if new.sale_type = 'auction' then
        new.closes_at := public.auction_close_at(v_overflow_at);
        new.auction_feed_expires_at := v_overflow_at + interval '3 days';
      end if;
      return new;
    end if;

    raise exception using errcode = 'P0001',
      message = format('오늘 즉시 공개 한도 %s건을 모두 사용했습니다.', v_limits.immediate_daily_limit);
  end if;

  insert into public.store_daily_usage as usage(
    store_id, usage_date, immediate_publish_count,
    scheduled_publish_count, updated_at
  ) values (
    new.store_id, v_date,
    case when v_scheduled then 0 else 1 end,
    case when v_scheduled then 1 else 0 end,
    statement_timestamp()
  )
  on conflict(store_id, usage_date) do update set
    immediate_publish_count = usage.immediate_publish_count
      + case when v_scheduled then 0 else 1 end,
    scheduled_publish_count = usage.scheduled_publish_count
      + case when v_scheduled then 1 else 0 end,
    updated_at = statement_timestamp();

  return new;
end;
$$;

revoke all on function app_private.enforce_store_product_publication_quota()
from public, anon, authenticated, service_role;

create or replace function public.get_store_daily_entitlements(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limits record;
  v_usage public.store_daily_usage%rowtype;
  v_pending integer;
  v_monthly integer;
  v_month_start date := date_trunc('month', timezone('Asia/Seoul', statement_timestamp()))::date;
  v_ai record;
begin
  if auth.uid() is null
    or not (public.is_owner() or public.has_store_permission(p_store_id, 'manage_products'))
  then
    raise exception using errcode = '42501', message = '센터 사용량 조회 권한이 없습니다.';
  end if;

  select * into v_limits from app_private.store_publication_limits_v2(p_store_id);
  select * into v_usage
  from public.store_daily_usage
  where store_id = p_store_id
    and usage_date = timezone('Asia/Seoul', statement_timestamp())::date;
  select count(*) into v_pending
  from public.products
  where store_id = p_store_id
    and status = 'pending'
    and not publication_quota_exempt;
  select coalesce(sum(immediate_publish_count + scheduled_publish_count), 0)::integer
  into v_monthly
  from public.store_daily_usage
  where store_id = p_store_id
    and usage_date >= v_month_start
    and usage_date < (v_month_start + interval '1 month')::date;
  select * into v_ai from app_private.store_plan_limits(p_store_id);

  return jsonb_build_object(
    'storeId', p_store_id,
    'planCode', v_limits.effective_plan,
    'aiDailyLimit', v_ai.ai_daily_limit,
    'aiUsed', coalesce(v_usage.ai_request_count, 0),
    'productDailyLimit', v_limits.pending_inventory_limit,
    'productsCreated', v_pending,
    'immediateDailyLimit', v_limits.immediate_daily_limit,
    'immediatePublished', coalesce(v_usage.immediate_publish_count, 0),
    'scheduledDailyLimit', v_limits.scheduled_daily_limit,
    'scheduledPublished', coalesce(v_usage.scheduled_publish_count, 0),
    'monthlyPublicationLimit', v_limits.monthly_publication_limit,
    'monthlyPublished', v_monthly,
    'pendingInventoryLimit', v_limits.pending_inventory_limit,
    'pendingInventoryUsed', v_pending,
    'automationRollingLimit', v_limits.automation_rolling_limit,
    'automationRollingUsed', coalesce((
      select sum(item_count)
      from public.store_automation_upload_events
      where store_id = p_store_id
        and created_at >= clock_timestamp() - interval '7 days'
    ), 0),
    'bulkImportEnabled', v_limits.effective_plan = 'pro'
  );
end;
$$;

revoke all on function public.get_store_daily_entitlements(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_store_daily_entitlements(uuid) to authenticated;

create or replace function app_private.activate_due_scheduled_products(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_result_status text;
  v_scanned integer := 0;
  v_published integer := 0;
  v_rescheduled integer := 0;
  v_failed integer := 0;
  v_sqlstate text;
  v_error text;
begin
  delete from app_private.scheduled_product_publication_failures failures
  where not exists (
    select 1 from public.products products
    where products.id = failures.product_id
      and products.status = 'pending'
      and products.paused_at is null
      and products.publish_at <= clock_timestamp()
  );

  for v_product in
    select products.id
    from public.products products
    where products.status = 'pending'
      and products.paused_at is null
      and products.publish_at <= clock_timestamp()
    order by products.publish_at, products.id
    limit least(greatest(coalesce(p_limit, 500), 1), 1000)
    for update skip locked
  loop
    v_scanned := v_scanned + 1;
    begin
      v_result_status := null;
      update public.products products
      set status = 'active'
      where products.id = v_product.id
        and products.status = 'pending'
        and products.paused_at is null
        and products.publish_at <= clock_timestamp()
      returning status into v_result_status;

      if v_result_status = 'active' then
        v_published := v_published + 1;
      elsif v_result_status = 'pending' then
        v_rescheduled := v_rescheduled + 1;
      end if;
      delete from app_private.scheduled_product_publication_failures
      where product_id = v_product.id;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_error = message_text;
      v_failed := v_failed + 1;
      insert into app_private.scheduled_product_publication_failures(
        product_id, last_sqlstate, last_error
      ) values (
        v_product.id, coalesce(v_sqlstate, 'XXXXX'),
        left(coalesce(v_error, '예약 공개 처리 실패'), 1000)
      )
      on conflict(product_id) do update set
        last_failed_at = clock_timestamp(),
        attempt_count = app_private.scheduled_product_publication_failures.attempt_count + 1,
        last_sqlstate = excluded.last_sqlstate,
        last_error = excluded.last_error;
    end;
  end loop;

  return jsonb_build_object(
    'scanned', v_scanned,
    'published', v_published,
    'rescheduled', v_rescheduled,
    'failed', v_failed,
    'processedAt', clock_timestamp()
  );
end;
$$;

revoke all on function app_private.activate_due_scheduled_products(integer)
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Auction lifecycle: 3-day no-bid visibility and the 21:00-22:00 close window.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_auction_drop_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_requested_at timestamptz;
begin
  if new.sale_type = 'auction' then
    if tg_op = 'INSERT' or (
      new.status = 'pending'
      and (old.status is distinct from new.status or old.publish_at is distinct from new.publish_at)
    ) then
      v_requested_at := coalesce(new.publish_at, clock_timestamp());
      new.publish_at := public.next_auction_drop_at(v_requested_at);
      new.closes_at := public.auction_close_at(new.publish_at);
    elsif new.status = 'pending' and new.closes_at is distinct from old.closes_at then
      new.closes_at := public.auction_close_at(new.publish_at);
    end if;

    if new.auction_feed_expires_at is null
      or (tg_op = 'INSERT' and new.auction_feed_expires_at <= new.publish_at)
    then
      new.auction_feed_expires_at := new.publish_at + interval '3 days';
    end if;
  elsif tg_op = 'INSERT' or new.sale_type = 'fixed' then
    new.auction_feed_expires_at := null;
    new.past_at := null;
    new.past_expires_at := null;
    new.past_action := null;
    new.closes_at := timestamptz '9999-12-31 23:59:59+00';
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_auction_drop_schedule()
from public, anon, authenticated, service_role;

update public.products
set auction_feed_expires_at = publish_at + interval '3 days'
where sale_type = 'auction'
  and status in ('pending', 'active')
  and (auction_feed_expires_at is null
    or auction_feed_expires_at > publish_at + interval '3 days');

create or replace function public.finalize_due_auctions(
  p_at timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_winner public.auction_bids%rowtype;
  v_kst_time time := timezone('Asia/Seoul', p_at)::time;
  v_next_close timestamptz;
  v_processed integer := 0;
begin
  if p_at is null then
    raise exception using errcode = '22023', message = '마감 기준 시각이 필요합니다.';
  end if;

  for v_product in
    select products.*
    from public.products products
    where products.sale_type = 'auction'
      and products.status = 'active'
      and products.closes_at <= p_at
    order by products.closes_at, products.id
    for update skip locked
  loop
    v_winner := null;
    select bids.* into v_winner
    from public.auction_bids bids
    where bids.product_id = v_product.id
    order by bids.amount desc, bids.created_at, bids.id
    limit 1;

    if v_winner.id is not null then
      update public.auction_bids bids
      set is_final = bids.id = v_winner.id
      where bids.product_id = v_product.id
        and bids.is_final is distinct from (bids.id = v_winner.id);
      update public.products
      set status = 'closed',
          bid_locked_at = p_at,
          final_bid_id = v_winner.id,
          final_bid_amount = v_winner.amount
      where id = v_product.id;
    elsif p_at >= v_product.publish_at + interval '3 days' then
      update public.products
      set status = 'closed',
          past_at = p_at,
          past_expires_at = null,
          past_action = 'pending',
          closes_at = p_at
      where id = v_product.id;
    else
      v_next_close := case
        when v_kst_time >= time '21:00:00' and v_kst_time < time '22:00:00'
          then (
            timezone('Asia/Seoul', p_at)::date + time '22:00:00'
          ) at time zone 'Asia/Seoul'
        else (
          timezone('Asia/Seoul', p_at)::date
          + case when v_kst_time < time '21:00:00' then 0 else 1 end
          + time '21:00:00'
        ) at time zone 'Asia/Seoul'
      end;
      update public.products
      set closes_at = v_next_close,
          auction_feed_expires_at = v_product.publish_at + interval '3 days'
      where id = v_product.id;
    end if;
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.finalize_due_auctions(timestamptz)
from public, anon, authenticated;

-- Remove the duplicate legacy finalizer. auction-drop-maintenance remains the
-- single authoritative one-minute lifecycle job.
do $$
declare v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'close-expired-products'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bid concurrency, first-bid extension, and assigned-center exclusion.
-- ---------------------------------------------------------------------------
create or replace function app_private.reject_own_store_bid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app_private.is_active_store_operator(
    (select products.store_id from public.products products where products.id = new.product_id),
    new.bidder_id
  ) then
    raise exception using errcode = '42501',
      message = '본인이 배정된 센터의 상품에는 입찰할 수 없습니다.';
  end if;
  return new;
end;
$$;

revoke all on function app_private.reject_own_store_bid()
from public, anon, authenticated;
drop trigger if exists auction_bids_reject_own_store on public.auction_bids;
create trigger auction_bids_reject_own_store
before insert on public.auction_bids
for each row execute function app_private.reject_own_store_bid();

create or replace function public.place_bid(p_product_id uuid, p_amount bigint)
returns table(
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
  v_now timestamptz := clock_timestamp();
  v_kst_time time := timezone('Asia/Seoul', v_now)::time;
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_product public.products%rowtype;
  v_bid_id uuid := gen_random_uuid();
  v_has_any_bid boolean;
  v_user_has_bid boolean;
  v_is_overtime boolean := false;
  v_should_extend boolean := false;
  v_first_late_bid boolean := false;
  v_next_closes_at timestamptz;
  v_minimum_amount bigint;
  v_participant_count integer;
  v_maximum_amount constant bigint := 1000000000;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인 후 입찰할 수 있습니다.';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(p_product_id::text, 71)
  ) then
    raise exception using errcode = 'PT409', message = '새로운 입찰이 진행되었습니다. 다시 시도해주세요.';
  end if;

  select profiles.display_name into v_display_name
  from public.profiles profiles where profiles.id = v_user_id;
  if v_display_name is null then
    raise exception using errcode = '23503', message = '회원 프로필을 찾을 수 없습니다. 다시 로그인해 주세요.';
  end if;

  select products.* into v_product
  from public.products products
  where products.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '입찰 상품을 찾을 수 없습니다.';
  end if;

  v_is_overtime := v_product.anti_sniping_extension_count > 0
    and v_product.anti_sniping_base_closes_at is not null
    and v_now >= v_product.anti_sniping_base_closes_at
    and v_now < v_product.closes_at;

  if v_product.status <> 'active' or v_product.publish_at > v_now then
    raise exception using errcode = 'P0001', message = '현재 공개 중인 상품만 입찰할 수 있습니다.';
  end if;
  if v_product.bid_locked_at is not null then
    raise exception using errcode = 'P0001', message = '확정 입찰이 완료된 상품입니다.';
  end if;
  if v_now >= v_product.closes_at then
    raise exception using errcode = 'P0001', message = '이 상품의 경매가 마감되었습니다.';
  end if;

  select exists(select 1 from public.auction_bids where product_id = p_product_id)
  into v_has_any_bid;
  select exists(
    select 1 from public.auction_bids
    where product_id = p_product_id and bidder_id = v_user_id
  ) into v_user_has_bid;

  if public.is_auction_blackout(v_now)
    and not (v_is_overtime and v_user_has_bid)
  then
    raise exception using errcode = 'P0001',
      message = '오후 9시부터 10시까지는 경매 마감 및 동기화 점검 중입니다.';
  end if;
  if v_is_overtime and not v_user_has_bid then
    raise exception using errcode = 'P0001', message = '마감 연장 시간에는 기존 참여자만 입찰할 수 있습니다.';
  end if;

  if v_kst_time >= time '20:56:00' and v_kst_time < time '21:00:00' then
    if not v_has_any_bid then
      v_first_late_bid := true;
    elsif not v_user_has_bid then
      raise exception using errcode = 'P0001', message = '오후 8시 56분부터는 기존 참여자만 입찰할 수 있습니다.';
    end if;
  end if;

  if p_amount is null or p_amount > v_maximum_amount then
    raise exception using errcode = '22003', message = '입찰 금액은 10억원 이하여야 합니다.';
  end if;
  if v_has_any_bid and v_product.current_price > v_maximum_amount - v_product.bid_increment then
    raise exception using errcode = '22003', message = '이 상품은 최대 입찰 금액에 도달했습니다.';
  end if;

  v_minimum_amount := case
    when v_has_any_bid then v_product.current_price + v_product.bid_increment
    else v_product.starting_price
  end;
  if p_amount < v_minimum_amount then
    raise exception using errcode = 'PT409',
      message = format('새로운 입찰이 진행되었습니다. 현재 최소 입찰가는 %s원입니다. 다시 시도해주세요.', v_minimum_amount);
  end if;

  insert into public.auction_bids(
    id, product_id, bidder_id, bidder_display_name, amount, is_final, created_at
  ) values (
    v_bid_id, p_product_id, v_user_id, v_display_name, p_amount, false, v_now
  );

  v_should_extend := v_product.closes_at > v_now
    and v_product.closes_at - v_now <= interval '3 minutes';
  v_next_closes_at := case
    when v_first_late_bid then greatest(v_product.closes_at, v_now + interval '15 minutes')
    when v_should_extend then v_now + interval '3 minutes'
    else v_product.closes_at
  end;
  v_participant_count := v_product.participant_count
    + case when v_user_has_bid then 0 else 1 end;

  perform set_config('app.authoritative_bid_product_id', p_product_id::text, true);
  update public.products
  set current_price = p_amount,
      participant_count = v_participant_count,
      bid_history = jsonb_build_array(jsonb_build_object(
        'id', v_bid_id::text,
        'bidAt', v_now,
        'bidderName', v_display_name,
        'amount', p_amount
      )) || coalesce(v_product.bid_history, '[]'::jsonb),
      closes_at = v_next_closes_at,
      anti_sniping_base_closes_at = case
        when v_first_late_bid or v_should_extend
          then coalesce(v_product.anti_sniping_base_closes_at, v_product.closes_at)
        else v_product.anti_sniping_base_closes_at
      end,
      anti_sniping_extended_at = case
        when v_first_late_bid or v_should_extend then v_now
        else v_product.anti_sniping_extended_at
      end,
      anti_sniping_extension_count = v_product.anti_sniping_extension_count
        + case when v_first_late_bid or v_should_extend then 1 else 0 end,
      bid_locked_at = null,
      final_bid_id = null,
      final_bid_amount = null
  where id = p_product_id;

  return query select
    v_bid_id, p_product_id, v_user_id, v_display_name, p_amount, v_now,
    false, p_amount, v_participant_count, null::timestamptz, null::uuid;
end;
$$;

revoke all on function public.place_bid(uuid, bigint)
from public, anon, authenticated;
grant execute on function public.place_bid(uuid, bigint) to authenticated;

-- Operators cannot mutate an active auction. Owner emergency controls remain
-- available through the existing owner-only ledger/emergency APIs.
revoke execute on function public.operator_extend_live_auction(uuid, integer, text) from authenticated;
revoke execute on function public.operator_close_live_auction(uuid, text) from authenticated;
revoke execute on function public.operator_cancel_auction_bid(uuid, text) from authenticated;

-- ---------------------------------------------------------------------------
-- Fully manual, sequential second-chance offers.
-- ---------------------------------------------------------------------------
alter table public.auction_purchase_offers
  drop constraint if exists auction_purchase_offers_kind_round_check;
alter table public.auction_purchase_offers
  add constraint auction_purchase_offers_kind_round_check check (
    (offer_kind = 'original' and offer_round = 1)
    or (offer_kind = 'second_chance' and offer_round >= 2)
    or (offer_kind = 'fixed_purchase' and offer_round >= 1)
  );

update public.auction_revenue_defense_settings
set second_chance_hours = 12
where singleton;

create or replace function public.operator_process_second_chance_manual(p_product_id uuid)
returns table(
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
  v_now timestamptz := clock_timestamp();
  v_product public.products%rowtype;
  v_previous public.auction_purchase_offers%rowtype;
  v_offer public.auction_purchase_offers%rowtype;
  v_next_bid public.auction_bids%rowtype;
  v_round integer;
  v_hours constant integer := 12;
begin
  if p_product_id is null then
    raise exception using errcode = '22023', message = '차순위 처리할 경매를 선택해 주세요.';
  end if;
  if v_actor is null or public.access_role_for_user(v_actor) not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = '소유자 또는 운영자 권한이 필요합니다.';
  end if;

  select products.* into v_product
  from public.products products
  where products.id = p_product_id
  for update;
  if not found or v_product.sale_type <> 'auction' or v_product.status <> 'closed' then
    raise exception using errcode = 'P0001', message = '마감된 경매만 차순위 처리할 수 있습니다.';
  end if;
  if not public.can_manage_product_store(v_product.store_id) then
    raise exception using errcode = '42501', message = '담당 센터의 경매만 처리할 수 있습니다.';
  end if;

  select offers.* into v_previous
  from public.auction_purchase_offers offers
  where offers.product_id = p_product_id
  order by offers.offer_round desc
  limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = '낙찰 원장을 찾을 수 없습니다.';
  end if;
  if v_previous.status = 'settled' then
    raise exception using errcode = 'P0001', message = '이미 결제가 완료된 낙찰입니다.';
  end if;
  if v_previous.status in ('offered', 'accepted', 'payment_due')
    and coalesce(v_previous.payment_due_at, v_previous.response_due_at, v_previous.offered_at) > v_now
  then
    raise exception using errcode = 'P0001', message = '현재 제안 또는 결제 기한이 아직 남아 있습니다.';
  end if;

  perform app_private.process_auction_purchase_offer_for_product(p_product_id, v_now);
  select offers.* into v_previous
  from public.auction_purchase_offers offers
  where offers.product_id = p_product_id
  order by offers.offer_round desc
  limit 1;

  select bids.* into v_next_bid
  from public.auction_bids bids
  where bids.product_id = p_product_id
    and bids.bidder_id is not null
    and public.access_role_for_user(bids.bidder_id) = 'member'
    and not public.is_owner_hidden_test_member(bids.bidder_id)
    and exists (
      select 1 from public.member_accounts accounts
      where accounts.member_id = bids.bidder_id and accounts.account_status = 'active'
    )
    and not exists (
      select 1 from public.auction_purchase_offers used
      where used.product_id = p_product_id and used.bidder_id = bids.bidder_id
    )
    and not exists (
      select 1 from public.member_bid_sanctions sanctions
      where sanctions.member_id = bids.bidder_id
        and sanctions.status = 'active'
        and sanctions.starts_at <= v_now
        and sanctions.ends_at > v_now
    )
  order by bids.amount desc, bids.created_at, bids.id
  limit 1;

  if v_next_bid.id is null then
    return query select p_product_id, 0, null::uuid, 'no_successor'::text,
      null::text, null::bigint, null::timestamptz, v_now;
    return;
  end if;

  select coalesce(max(offers.offer_round), 1) + 1 into v_round
  from public.auction_purchase_offers offers
  where offers.product_id = p_product_id;
  perform set_config('app.manual_second_chance', 'on', true);
  insert into public.auction_purchase_offers(
    product_id, offer_round, offer_kind, bid_id, bidder_id,
    bidder_display_name_snapshot, offered_amount, status, offered_at,
    response_due_at, payment_due_at, previous_offer_id
  ) values (
    p_product_id, v_round, 'second_chance', v_next_bid.id, v_next_bid.bidder_id,
    v_next_bid.bidder_display_name, v_next_bid.amount, 'offered', v_now,
    v_now + make_interval(hours => v_hours),
    v_now + make_interval(hours => v_hours),
    v_previous.id
  ) returning * into v_offer;

  return query select p_product_id, 1, v_offer.id, v_offer.status,
    v_offer.bidder_display_name_snapshot, v_offer.offered_amount,
    v_offer.response_due_at, v_now;
end;
$$;

revoke all on function public.operator_process_second_chance_manual(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.operator_process_second_chance_manual(uuid) to authenticated;

create or replace function public.operator_resolve_expired_auction(
  p_product_id uuid,
  p_action text
)
returns table(
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
  v_now timestamptz := clock_timestamp();
  v_product public.products%rowtype;
  v_new_id uuid;
  v_publish_at timestamptz;
  v_closes_at timestamptz;
  v_sale_type text;
  v_price bigint;
begin
  if p_product_id is null or p_action not in ('relist', 'archive', 'delete') then
    raise exception using errcode = '22023',
      message = '재경매, 아카이브숍 이동 또는 상품 삭제 작업을 선택해 주세요.';
  end if;
  if v_actor is null or public.access_role_for_user(v_actor) not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = '소유자 또는 운영자 권한이 필요합니다.';
  end if;

  select products.* into v_product
  from public.products products
  where products.id = p_product_id
  for update;
  if not found or v_product.sale_type <> 'auction' or v_product.status <> 'closed' then
    raise exception using errcode = 'P0001', message = '마감된 경매만 처리할 수 있습니다.';
  end if;
  if not public.can_manage_product_store(v_product.store_id) then
    raise exception using errcode = '42501', message = '담당 센터의 상품만 처리할 수 있습니다.';
  end if;
  if exists (
    select 1 from public.auction_purchase_offers offers
    where offers.product_id = p_product_id
      and offers.status = 'settled'
  ) then
    raise exception using errcode = 'P0001', message = '결제가 완료된 상품은 이 화면에서 처리할 수 없습니다.';
  end if;
  if exists (
    select 1 from public.auction_purchase_offers offers
    where offers.product_id = p_product_id
      and offers.status in ('offered', 'accepted', 'payment_due')
      and coalesce(offers.payment_due_at, offers.response_due_at, offers.offered_at) > v_now
  ) then
    raise exception using errcode = 'P0001', message = '진행 중인 차순위 제안 또는 결제 기한이 있습니다.';
  end if;
  if exists (
    select 1
    from public.auction_bids bids
    where bids.product_id = p_product_id
      and bids.bidder_id is not null
      and public.access_role_for_user(bids.bidder_id) = 'member'
      and not public.is_owner_hidden_test_member(bids.bidder_id)
      and exists (
        select 1 from public.member_accounts accounts
        where accounts.member_id = bids.bidder_id
          and accounts.account_status = 'active'
      )
      and not exists (
        select 1 from public.auction_purchase_offers used
        where used.product_id = p_product_id
          and used.bidder_id = bids.bidder_id
      )
      and not exists (
        select 1 from public.member_bid_sanctions sanctions
        where sanctions.member_id = bids.bidder_id
          and sanctions.status = 'active'
          and sanctions.starts_at <= v_now
          and sanctions.ends_at > v_now
      )
  ) then
    raise exception using errcode = 'P0001',
      message = '아직 차순위 기회를 받지 않은 입찰자가 있습니다. 후보를 모두 처리해 주세요.';
  end if;

  if p_action = 'delete' then
    update public.products
    set past_at = coalesce(past_at, v_now),
        past_expires_at = null,
        past_action = 'deleted',
        updated_by = v_actor
    where id = p_product_id;

    return query select p_product_id, null::uuid, p_action,
      null::bigint, v_product.current_price, null::timestamptz, null::timestamptz;
    return;
  end if;

  v_publish_at := public.next_auction_drop_at(v_now);
  v_sale_type := case when p_action = 'archive' then 'fixed' else 'auction' end;
  v_price := case when p_action = 'archive'
    then greatest(v_product.current_price, v_product.starting_price)
    else v_product.starting_price end;
  v_closes_at := case when v_sale_type = 'auction'
    then public.auction_close_at(v_publish_at)
    else timestamptz '9999-12-31 23:59:59+00' end;

  insert into public.products(
    title, description, category, category_id, brand, brand_slug, brand_source,
    gender, enhanced_title, hashtags, defect_tags, publish_at, closes_at,
    status, participant_count, starting_price, current_price, bid_increment,
    image_urls, thumbnail_urls, bid_history, bid_locked_at, final_bid_id,
    final_bid_amount, anti_sniping_base_closes_at, anti_sniping_extended_at,
    anti_sniping_extension_count, auction_feed_expires_at, past_at,
    past_expires_at, past_action, sale_type, fixed_price, store_id,
    inquiry_operator_id, created_by, updated_by, storage_class, size_label,
    condition_grade, measurements, inspection_notes, sale_completed_at,
    paused_at, publication_quota_exempt
  ) values (
    v_product.title, v_product.description, v_product.category,
    v_product.category_id, v_product.brand, v_product.brand_slug,
    v_product.brand_source, v_product.gender, v_product.enhanced_title,
    v_product.hashtags, v_product.defect_tags, v_publish_at, v_closes_at,
    'pending', 0, v_price, v_price, v_product.bid_increment,
    v_product.image_urls, v_product.thumbnail_urls, '[]'::jsonb, null, null,
    null, null, null, 0, null, null, null, null, v_sale_type,
    case when v_sale_type = 'fixed' then v_price else null end,
    v_product.store_id, v_product.inquiry_operator_id, v_actor, v_actor,
    v_product.storage_class, v_product.size_label, v_product.condition_grade,
    v_product.measurements, v_product.inspection_notes, null, null,
    p_action = 'relist'
  ) returning id, publish_at, closes_at
  into v_new_id, v_publish_at, v_closes_at;

  update public.products
  set past_at = coalesce(past_at, v_now),
      past_expires_at = null,
      past_action = case when p_action = 'relist' then 'relisted' else 'deleted' end,
      updated_by = v_actor
  where id = p_product_id;

  return query select p_product_id, v_new_id, p_action,
    case when v_sale_type = 'fixed' then v_price else null end,
    v_price, v_publish_at, v_closes_at;
end;
$$;

revoke all on function public.operator_resolve_expired_auction(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.operator_resolve_expired_auction(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Delivery completion settles twelve hours after the carrier reports delivery.
-- ---------------------------------------------------------------------------
alter table public.inventory_shipments
  drop constraint if exists inventory_shipments_delivery_timestamps_check,
  drop constraint if exists inventory_shipments_delivery_timing_check;

update public.inventory_shipments
set auto_settle_at = delivered_at + interval '12 hours'
where delivery_status = 'delivered'
  and delivered_at is not null
  and settlement_status = 'pending';

update public.inventory_shipment_trade_confirmations confirmations
set confirmation_due_at = shipments.delivered_at + interval '12 hours',
    updated_at = clock_timestamp()
from public.inventory_shipments shipments
where confirmations.shipment_id = shipments.id
  and confirmations.confirmed_at is null
  and shipments.delivery_status = 'delivered'
  and shipments.delivered_at is not null;

alter table public.inventory_shipments
  add constraint inventory_shipments_delivery_timing_check check (
    (delivery_status = 'delivered'
      and delivered_at is not null
      and auto_settle_at = delivered_at + interval '12 hours')
    or (delivery_status <> 'delivered'
      and delivered_at is null
      and auto_settle_at is null)
  );

-- The delivery tracker function used by the carrier adapters is repaired by
-- replacing its only 24-hour assignment with the new 12-hour contract.
do $$
declare
  v_source text;
begin
  select pg_get_functiondef(
    'public.record_inventory_delivery_tracking(uuid,text,text,text,timestamptz,text)'::regprocedure
  ) into v_source;
  if position('interval ''24 hours''' in v_source) = 0 then
    raise exception using errcode = 'P0001',
      message = '배송 완료 자동 확정 함수의 24시간 규칙을 찾지 못했습니다.';
  end if;
  v_source := replace(v_source, 'interval ''24 hours''', 'interval ''12 hours''');
  v_source := replace(v_source, '24시간 뒤', '12시간 뒤');
  execute v_source;
end;
$$;

-- Hobby deployments cannot run sub-daily Vercel Cron expressions. Dispatch
-- the existing protected route handlers from Supabase Cron and Vault instead.
create or replace function app_private.invoke_vault_cron_endpoint(
  p_url_secret_name text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select secrets.decrypted_secret into v_url
  from vault.decrypted_secrets secrets
  where secrets.name = p_url_secret_name
  limit 1;
  select secrets.decrypted_secret into v_secret
  from vault.decrypted_secrets secrets
  where secrets.name = 'web_push_dispatch_secret'
  limit 1;

  if nullif(btrim(coalesce(v_url, '')), '') is null
    or nullif(btrim(coalesce(v_secret, '')), '') is null
  then
    return null;
  end if;

  select net.http_get(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function app_private.invoke_vault_cron_endpoint(text)
from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
    or not exists (select 1 from pg_extension where extname = 'pg_net')
  then
    raise exception 'delivery automation requires pg_cron and pg_net';
  end if;

  for v_job_id in
    select jobs.jobid
    from cron.job jobs
    where jobs.jobname in (
      'track-inventory-deliveries-every-three-hours',
      'settle-delivered-inventory-hourly'
    )
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'track-inventory-deliveries-every-three-hours',
    '0 1,4,7,10,13,22 * * *',
    $job$select app_private.invoke_vault_cron_endpoint('delivery_tracking_cron_url');$job$
  );
  perform cron.schedule(
    'settle-delivered-inventory-hourly',
    '0 0-13,22,23 * * *',
    $job$select app_private.invoke_vault_cron_endpoint('auto_settlement_cron_url');$job$
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Retire the band_member role from active data and authorization contracts.
-- Historical migrations remain immutable.
-- ---------------------------------------------------------------------------
update public.account_access_roles
set role_code = 'member',
    reports_to_operator_id = null,
    updated_at = clock_timestamp()
where role_code = 'band_member';

alter table public.account_access_roles
  drop constraint if exists account_access_roles_role_code_check;
alter table public.account_access_roles
  add constraint account_access_roles_role_code_check
  check (role_code in ('owner', 'operator', 'employee', 'member'));

create or replace function public.is_payment_deadline_exempt(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select false; $$;

revoke all on function public.is_payment_deadline_exempt(uuid)
from public, anon, authenticated, service_role;

-- Both callers now use the expanded helper, so remove the superseded private
-- function without cascading to the existing product trigger or public API.
drop function if exists app_private.store_publication_limits(uuid);

commit;
