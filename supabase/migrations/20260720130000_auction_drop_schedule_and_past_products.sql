-- Enforce the daily drop schedule and retain expired unsold auctions in a
-- short, operator-actionable "past products" queue.

alter table public.products
  add column if not exists auction_feed_expires_at timestamptz,
  add column if not exists past_at timestamptz,
  add column if not exists past_expires_at timestamptz,
  add column if not exists past_action text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_past_action_check'
  ) then
    alter table public.products
      add constraint products_past_action_check
      check (past_action is null or past_action in ('pending', 'relisted', 'deleted'));
  end if;
end;
$$;

update public.products
set auction_feed_expires_at = publish_at + interval '7 days'
where sale_type = 'auction'
  and auction_feed_expires_at is null;

create index if not exists products_auction_feed_expiry_idx
  on public.products (sale_type, status, auction_feed_expires_at);
create index if not exists products_past_expiry_idx
  on public.products (store_id, past_at, past_expires_at)
  where past_at is not null;

create or replace function public.next_auction_drop_at(p_at timestamptz)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_date date := (p_at at time zone 'Asia/Seoul')::date;
  v_time time := (p_at at time zone 'Asia/Seoul')::time;
begin
  if p_at is null then
    raise exception using errcode = '22023', message = '경매 등록 기준 시각이 필요합니다.';
  end if;
  return (
    v_date + case when v_time < time '10:00:00' then 0 else 1 end
    + time '10:00:00'
  ) at time zone 'Asia/Seoul';
end;
$$;

create or replace function public.auction_close_at(p_publish_at timestamptz)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_date date := (p_publish_at at time zone 'Asia/Seoul')::date;
  v_time time := (p_publish_at at time zone 'Asia/Seoul')::time;
begin
  if p_publish_at is null then
    raise exception using errcode = '22023', message = '경매 공개 시각이 필요합니다.';
  end if;
  return (
    v_date + case when v_time < time '21:00:00' then 0 else 1 end
    + time '21:00:00'
  ) at time zone 'Asia/Seoul';
end;
$$;

revoke all on function public.next_auction_drop_at(timestamptz) from public;
revoke all on function public.auction_close_at(timestamptz) from public;

-- Any new auction is queued for the next 10:00 KST drop. Existing active
-- auctions retain their current deadline so a live auction is never moved by
-- a metadata edit or by the settlement worker.
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
      new.auction_feed_expires_at := new.publish_at + interval '7 days';
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

revoke all on function public.normalize_auction_drop_schedule() from public;
drop trigger if exists products_normalize_auction_drop_schedule on public.products;
create trigger products_normalize_auction_drop_schedule
before insert or update on public.products
for each row execute function public.normalize_auction_drop_schedule();

-- Operators may inspect and act on their own expired products. Owners can act
-- on every store. Relisting always returns to the next 10:00 KST drop and
-- starts a fresh seven-day feed window.
create or replace function public.manage_past_auction_products(
  p_product_ids uuid[],
  p_action text
)
returns table (
  processed_count integer,
  skipped_count integer,
  processed_ids uuid[],
  skipped_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_ids uuid[];
  v_processed uuid[] := '{}'::uuid[];
  v_skipped uuid[] := '{}'::uuid[];
  v_product record;
  v_publish_at timestamptz;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_action not in ('relist', 'delete') then
    raise exception using errcode = '22023', message = '재등록 또는 삭제 작업만 가능합니다.';
  end if;
  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    raise exception using errcode = '22023', message = '상품을 하나 이상 선택해 주세요.';
  end if;
  if cardinality(p_product_ids) > 200 then
    raise exception using errcode = '22023', message = '한 번에 최대 200개까지 처리할 수 있습니다.';
  end if;

  select coalesce(array_agg(distinct ids.id), '{}'::uuid[])
  into v_ids
  from unnest(p_product_ids) as ids(id)
  where ids.id is not null;

  for v_product in
    select products.*
    from public.products as products
    where products.id = any(v_ids)
      and products.sale_type = 'auction'
      and products.past_at is not null
      and products.past_expires_at > v_now
      and (
        public.is_owner()
        or exists (
          select 1 from public.stores as stores
          where stores.id = products.store_id
            and stores.operator_id = v_actor
        )
      )
    for update
  loop
    if p_action = 'relist' then
      v_publish_at := public.next_auction_drop_at(v_now);
      update public.products
      set status = 'active',
          publish_at = v_publish_at,
          closes_at = public.auction_close_at(v_publish_at),
          auction_feed_expires_at = v_publish_at + interval '7 days',
          past_at = null,
          past_expires_at = null,
          past_action = 'relisted',
          updated_by = v_actor
      where id = v_product.id;
    else
      if exists (select 1 from public.auction_bids where product_id = v_product.id)
        or exists (select 1 from public.auction_purchase_offers where product_id = v_product.id)
      then
        v_skipped := array_append(v_skipped, v_product.id);
        continue;
      end if;
      begin
        delete from public.products where id = v_product.id;
      exception when foreign_key_violation then
        update public.products
        set past_action = 'deleted', updated_by = v_actor
        where id = v_product.id;
        v_skipped := array_append(v_skipped, v_product.id);
        continue;
      end;
    end if;
    v_processed := array_append(v_processed, v_product.id);
  end loop;

  select coalesce(array_agg(ids.id), '{}'::uuid[])
  into v_skipped
  from unnest(v_ids) as ids(id)
  where not (ids.id = any(v_processed));

  return query select cardinality(v_processed), cardinality(v_skipped), v_processed, v_skipped;
end;
$$;

revoke all on function public.manage_past_auction_products(uuid[], text) from public, anon;
grant execute on function public.manage_past_auction_products(uuid[], text) to authenticated;

-- Finalization now also moves no-bid products past the seven-day feed window
-- and removes dependency-free past rows after three days. Financially linked
-- rows are retained as immutable history rather than being force-deleted.
create or replace function public.finalize_due_auctions(
  p_at timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_winner public.auction_bids%rowtype;
  v_next_close timestamptz;
  v_processed_count integer := 0;
begin
  if p_at is null then
    raise exception using errcode = '22023', message = '마감 기준 시각이 필요합니다.';
  end if;

  v_next_close := (
    (p_at at time zone 'Asia/Seoul')::date
    + case when (p_at at time zone 'Asia/Seoul')::time < time '21:00:00' then 0 else 1 end
    + time '21:00:00'
  ) at time zone 'Asia/Seoul';

  for v_product in
    select products.id
    from public.products as products
    where products.sale_type = 'auction'
      and products.status = 'active'
      and (
        products.closes_at <= p_at
        or products.auction_feed_expires_at <= p_at
      )
    order by products.closes_at, products.id
    for update skip locked
  loop
    v_winner := null;
    select bids.* into v_winner
    from public.auction_bids as bids
    where bids.product_id = v_product.id
    order by bids.amount desc, bids.created_at, bids.id
    limit 1;

    if v_winner.id is not null then
      update public.auction_bids as bids
      set is_final = (bids.id = v_winner.id)
      where bids.product_id = v_product.id
        and bids.is_final is distinct from (bids.id = v_winner.id);
      update public.products
      set status = 'closed',
          bid_locked_at = p_at,
          final_bid_id = v_winner.id,
          final_bid_amount = v_winner.amount
      where id = v_product.id;
    elsif exists (
      select 1 from public.products
      where id = v_product.id and auction_feed_expires_at <= p_at
    ) then
      update public.products
      set status = 'closed',
          past_at = p_at,
          past_expires_at = p_at + interval '3 days',
          past_action = 'pending',
          closes_at = p_at
      where id = v_product.id;
    else
      update public.products
      set closes_at = v_next_close
      where id = v_product.id;
    end if;
    v_processed_count := v_processed_count + 1;
  end loop;

  delete from public.products as products
  where products.sale_type = 'auction'
    and products.past_action = 'pending'
    and products.past_expires_at <= p_at
    and not exists (select 1 from public.auction_bids where product_id = products.id)
    and not exists (select 1 from public.auction_purchase_offers where product_id = products.id);

  return v_processed_count;
end;
$$;

revoke all on function public.finalize_due_auctions(timestamptz) from public, anon, authenticated;

-- Keep the existing cron name and add an explicit schedule-maintenance alias
-- for operators who inspect cron jobs by purpose.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'auction-drop-maintenance') then
    perform cron.schedule(
      'auction-drop-maintenance',
      '* * * * *',
      $job$select public.finalize_due_auctions(clock_timestamp());$job$
    );
  end if;
end;
$$;

-- Pending auction publication now means "queue for the next 10:00 drop";
-- fixed-price products remain immediately purchasable.
create or replace function public.publish_pending_products_now(
  p_product_ids uuid[]
)
returns table (
  requested_count integer,
  published_count integer,
  skipped_count integer,
  published_ids uuid[],
  skipped_ids uuid[],
  published_at timestamptz,
  closes_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_ids uuid[];
  v_published_ids uuid[] := '{}'::uuid[];
  v_skipped_ids uuid[] := '{}'::uuid[];
  v_auction_publish_at timestamptz := public.next_auction_drop_at(v_now);
  v_auction_closes_at timestamptz := public.auction_close_at(v_auction_publish_at);
begin
  if v_actor is null or coalesce(public.access_role_for_user(v_actor), '') not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = '운영자만 대기 상품을 공개할 수 있습니다.';
  end if;
  if p_product_ids is null or cardinality(p_product_ids) = 0 or cardinality(p_product_ids) > 200 then
    raise exception using errcode = '22023', message = '공개할 상품을 1~200개 선택해 주세요.';
  end if;
  select coalesce(array_agg(distinct ids.id), '{}'::uuid[]) into v_ids
  from unnest(p_product_ids) as ids(id) where ids.id is not null;

  with published as (
    update public.products as products
    set status = 'active',
        publish_at = case when products.sale_type = 'auction' then v_auction_publish_at else v_now end,
        closes_at = case when products.sale_type = 'auction' then v_auction_closes_at else timestamptz '9999-12-31 23:59:59+00' end,
        auction_feed_expires_at = case when products.sale_type = 'auction' then v_auction_publish_at + interval '7 days' else null end,
        updated_by = v_actor
    where products.id = any(v_ids) and products.status = 'pending'
    returning products.id
  )
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_published_ids from published;
  select coalesce(array_agg(ids.id order by ids.position), '{}'::uuid[]) into v_skipped_ids
  from unnest(v_ids) with ordinality as ids(id, position)
  where not (ids.id = any(v_published_ids));
  return query select cardinality(v_ids), cardinality(v_published_ids), cardinality(v_skipped_ids), v_published_ids, v_skipped_ids, v_now, v_auction_closes_at;
end;
$$;

revoke all on function public.publish_pending_products_now(uuid[]) from public, anon;
grant execute on function public.publish_pending_products_now(uuid[]) to authenticated;
