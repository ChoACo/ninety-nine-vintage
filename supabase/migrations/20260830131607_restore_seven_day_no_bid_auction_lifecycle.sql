begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Restore the original business rule: an auction with no bids remains public
-- for seven days, through the 21:00 KST closing boundary on the seventh day.

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
        new.auction_feed_expires_at := public.auction_close_at(
          v_overflow_at + interval '7 days'
        );
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
        new.auction_feed_expires_at := public.auction_close_at(
          v_overflow_at + interval '7 days'
        );
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

    new.auction_feed_expires_at := public.auction_close_at(
      new.publish_at + interval '7 days'
    );
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
set auction_feed_expires_at = public.auction_close_at(
  publish_at + interval '7 days'
)
where sale_type = 'auction'
  and status in ('pending', 'active')
  and auction_feed_expires_at is distinct from public.auction_close_at(
    publish_at + interval '7 days'
  );

-- Reopen only auctions that the temporary three-day policy closed as no-bid
-- items and that still have time remaining in the restored seven-day window.
-- Completed, cancelled, recovered, or bid-bearing products are excluded.
alter table public.products
  disable trigger products_enforce_store_publication_quota;

update public.products as products
set status = 'active',
    closes_at = least(
      public.auction_close_at(clock_timestamp()),
      public.auction_close_at(products.publish_at + interval '7 days')
    ),
    auction_feed_expires_at = public.auction_close_at(
      products.publish_at + interval '7 days'
    ),
    past_at = null,
    past_expires_at = null,
    past_action = null,
    bid_locked_at = null
where products.sale_type = 'auction'
  and products.status = 'closed'
  and products.final_bid_id is null
  and products.final_bid_amount is null
  and products.sale_completed_at is null
  and products.past_action = 'pending'
  and products.past_at is not null
  and public.auction_close_at(products.publish_at + interval '7 days') > clock_timestamp()
  and not exists (
    select 1
    from public.auction_bids as bids
    where bids.product_id = products.id
  );

alter table public.products
  enable trigger products_enforce_store_publication_quota;

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
    elsif p_at >= public.auction_close_at(
      v_product.publish_at + interval '7 days'
    ) then
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
      set closes_at = least(
            v_next_close,
            public.auction_close_at(v_product.publish_at + interval '7 days')
          ),
          auction_feed_expires_at = public.auction_close_at(
            v_product.publish_at + interval '7 days'
          )
      where id = v_product.id;
    end if;
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.finalize_due_auctions(timestamptz)
from public, anon, authenticated, service_role;

commit;
