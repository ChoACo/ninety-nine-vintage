-- Fixed-price products share the existing product, winner, and payment ledgers
-- without weakening the live-auction transaction. Existing rows remain auctions.

alter table public.products
  add column if not exists sale_type text not null default 'auction',
  add column if not exists fixed_price bigint;

alter table public.products
  drop constraint if exists products_sale_type_check;
alter table public.products
  add constraint products_sale_type_check
  check (sale_type in ('auction', 'fixed'));

alter table public.products
  drop constraint if exists products_fixed_price_contract_check;
alter table public.products
  add constraint products_fixed_price_contract_check check (
    (
      sale_type = 'auction'
      and fixed_price is null
    )
    or (
      sale_type = 'fixed'
      and fixed_price is not null
      and fixed_price between 1 and 1000000000
      and starting_price = fixed_price
      and current_price = fixed_price
    )
  );

create index if not exists products_public_sale_feed_idx
  on public.products (sale_type, status, publish_at desc, id desc);

-- Auction offers retain their exact two-round contract. Fixed-price products
-- use an independent, monotonically increasing purchase round so every reopen
-- creates a new immutable offer instead of overwriting round 1.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select constraints.conname
    from pg_catalog.pg_constraint as constraints
    where constraints.conrelid = 'public.auction_purchase_offers'::regclass
      and constraints.contype = 'c'
      and (
        pg_catalog.pg_get_constraintdef(constraints.oid) ilike '%offer_kind%'
        or (
          pg_catalog.pg_get_constraintdef(constraints.oid) ilike '%offer_round%'
          and pg_catalog.pg_get_constraintdef(constraints.oid) ilike '%2%'
        )
      )
  loop
    execute format(
      'alter table public.auction_purchase_offers drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

alter table public.auction_purchase_offers
  add constraint auction_purchase_offers_offer_round_check
    check (offer_round between 1 and 2147483647),
  add constraint auction_purchase_offers_offer_kind_check
    check (offer_kind in ('original', 'second_chance', 'fixed_purchase')),
  add constraint auction_purchase_offers_kind_round_check check (
    (offer_kind = 'original' and offer_round = 1)
    or (offer_kind = 'second_chance' and offer_round = 2)
    or (offer_kind = 'fixed_purchase' and offer_round >= 1)
  ),
  add constraint auction_purchase_offers_response_contract_check check (
    (
      offer_kind in ('original', 'fixed_purchase')
      and response_due_at is null
    )
    or (
      offer_kind = 'second_chance'
      and response_due_at is not null
      and response_due_at > offered_at
    )
  );

-- Legacy offer seeders still emit (original, round 1). Normalize only fixed
-- products at the database boundary. Auctions cannot opt into fixed rounds,
-- and the latest offer is linked as previous_offer_id for an append-only chain.
create or replace function app_private.normalize_fixed_purchase_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_type text;
  v_previous_offer_id uuid;
  v_next_offer_round integer;
begin
  select products.sale_type
  into v_sale_type
  from public.products as products
  where products.id = new.product_id;

  if not found then
    return new;
  end if;

  if v_sale_type = 'fixed' then
    if new.offer_kind = 'second_chance' then
      raise exception using
        errcode = '23514',
        message = '정가 상품에는 차순위 구매 offer를 생성할 수 없습니다.';
    end if;

    select offers.id, offers.offer_round + 1
    into v_previous_offer_id, v_next_offer_round
    from public.auction_purchase_offers as offers
    where offers.product_id = new.product_id
    order by offers.offer_round desc
    limit 1;

    new.offer_kind := 'fixed_purchase';
    new.offer_round := coalesce(v_next_offer_round, 1);
    new.previous_offer_id := v_previous_offer_id;
    new.response_due_at := null;
  elsif new.offer_kind = 'fixed_purchase' then
    raise exception using
      errcode = '23514',
      message = '경매 상품에는 정가 구매 offer를 생성할 수 없습니다.';
  end if;

  return new;
end;
$$;

revoke all on function app_private.normalize_fixed_purchase_offer()
from public, anon, authenticated, service_role;

drop trigger if exists auction_purchase_offers_normalize_fixed_purchase
on public.auction_purchase_offers;
create trigger auction_purchase_offers_normalize_fixed_purchase
before insert on public.auction_purchase_offers
for each row execute function app_private.normalize_fixed_purchase_offer();

comment on column public.products.sale_type is
  '판매 방식: auction은 실시간 경매, fixed는 선착순 정가 판매';
comment on column public.products.fixed_price is
  '정가 판매 금액. auction 상품에는 반드시 null';

-- Keep the latest hardened staff insert contract and add sale-type invariants.
drop policy if exists "Staff insert products" on public.products;
create policy "Staff insert products"
on public.products
for insert
to authenticated
with check (
  (select public.can_manage_products())
  and created_by = (select auth.uid())
  and status in ('pending', 'active')
  and participant_count = 0
  and current_price = starting_price
  and bid_history = '[]'::jsonb
  and bid_locked_at is null
  and final_bid_id is null
  and final_bid_amount is null
  and anti_sniping_extension_count = 0
  and anti_sniping_base_closes_at is null
  and anti_sniping_extended_at is null
  and (
    (sale_type = 'auction' and fixed_price is null)
    or (
      sale_type = 'fixed'
      and fixed_price between 1 and 1000000000
      and starting_price = fixed_price
      and current_price = fixed_price
    )
  )
);

-- A fixed product must never enter the normal bid engine. The only permitted
-- auction_bids insert is the exact row created by claim_fixed_price_product().
create or replace function app_private.guard_product_sale_type_bid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_type text;
  v_fixed_purchase_product_id text := current_setting(
    'app.fixed_purchase_product_id',
    true
  );
begin
  select products.sale_type
  into v_sale_type
  from public.products as products
  where products.id = new.product_id;

  if not found then
    return new;
  end if;

  if v_sale_type = 'fixed'
    and coalesce(v_fixed_purchase_product_id, '') <> new.product_id::text
  then
    raise exception using
      errcode = '42501',
      message = '정가 상품은 일반 입찰로 구매할 수 없습니다.';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_product_sale_type_bid()
from public, anon, authenticated, service_role;

drop trigger if exists auction_bids_guard_product_sale_type
on public.auction_bids;
create trigger auction_bids_guard_product_sale_type
before insert on public.auction_bids
for each row execute function app_private.guard_product_sale_type_bid();

-- Bid sanctions remain scoped to auctions. A fixed purchase still requires the
-- active Kakao account checks in claim_fixed_price_product(), and the exact
-- transaction-local marker cannot be supplied through PostgREST.
create or replace function public.enforce_member_bid_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock_key bigint;
  v_blocked_until timestamptz;
  v_fixed_purchase_product_id text := current_setting(
    'app.fixed_purchase_product_id',
    true
  );
begin
  if new.bidder_id is null then
    return new;
  end if;

  if coalesce(v_fixed_purchase_product_id, '') = new.product_id::text then
    return new;
  end if;

  v_lock_key := hashtextextended(
    'member-warning-enforcement:' || new.bidder_id::text,
    0
  );

  if not pg_try_advisory_xact_lock(v_lock_key) then
    raise exception using
      errcode = 'P0001',
      message = '입찰 제한 상태를 갱신 중입니다. 잠시 후 다시 시도해 주세요.';
  end if;

  select max(sanctions.ends_at)
  into v_blocked_until
  from public.member_bid_sanctions as sanctions
  where sanctions.member_id = new.bidder_id
    and sanctions.ends_at > clock_timestamp();

  if v_blocked_until is not null then
    raise exception using
      errcode = '42501',
      message = format('누적 경고 제재로 %s까지 입찰할 수 없습니다.', v_blocked_until);
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_member_bid_eligibility()
from public, anon, authenticated, service_role;

-- Claiming is a single row-locked transaction. The final bid-shaped ledger row
-- deliberately reuses existing won-item and manual-transfer payment queries.
create or replace function public.claim_fixed_price_product(
  p_product_id uuid
)
returns table (
  product_id uuid,
  bid_id uuid,
  buyer_id uuid,
  buyer_display_name text,
  amount bigint,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_product public.products%rowtype;
  v_bid_id uuid := gen_random_uuid();
  v_now timestamptz;
  v_closed_at timestamptz;
  v_manual_transfer_enabled boolean;
  v_previous_offer_id uuid;
  v_next_offer_round integer;
  v_purchase_offer_id uuid;
  v_purchase_offer_round integer;
begin
  if p_product_id is null then
    raise exception using
      errcode = '22023',
      message = '구매할 상품을 선택해 주세요.';
  end if;

  if v_user_id is null
    or coalesce(public.access_role_for_user(v_user_id), '')
      not in ('member', 'band_member')
    or not public.auth_user_has_kakao_identity(v_user_id)
    or not exists (
      select 1
      from public.member_accounts as accounts
      where accounts.member_id = v_user_id
        and accounts.account_status = 'active'
    )
  then
    raise exception using
      errcode = '42501',
      message = '구매할 수 있는 활성 카카오 회원이 아닙니다.';
  end if;

  select profiles.display_name
  into v_display_name
  from public.profiles as profiles
  where profiles.id = v_user_id;

  if nullif(btrim(v_display_name), '') is null then
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
      message = '정가 상품을 찾을 수 없습니다.';
  end if;

  v_now := clock_timestamp();

  if v_product.sale_type <> 'fixed'
    or v_product.fixed_price is null
  then
    raise exception using
      errcode = '22023',
      message = '정가 판매 상품만 바로 구매할 수 있습니다.';
  end if;
  if v_product.status <> 'active' or v_product.publish_at > v_now then
    raise exception using
      errcode = 'P0001',
      message = '현재 공개 중인 정가 상품이 아닙니다.';
  end if;
  if v_product.final_bid_id is not null
    or v_product.final_bid_amount is not null
    or v_product.bid_locked_at is not null
    or exists (
      select 1
      from public.auction_bids as bids
      where bids.product_id = p_product_id
    )
  then
    raise exception using
      errcode = '23505',
      message = '이미 다른 회원이 구매한 상품입니다.';
  end if;

  perform set_config('app.fixed_purchase_product_id', p_product_id::text, true);
  insert into public.auction_bids (
    id,
    product_id,
    bidder_id,
    bidder_display_name,
    amount,
    is_final,
    created_at
  ) values (
    v_bid_id,
    p_product_id,
    v_user_id,
    v_display_name,
    v_product.fixed_price,
    true,
    v_now
  );

  -- The exact-row marker also permits purchase during the 21:00-22:00 auction
  -- settlement blackout without opening any direct product mutation path.
  perform set_config('app.authoritative_bid_product_id', p_product_id::text, true);
  v_closed_at := greatest(
    v_now,
    v_product.publish_at + interval '1 microsecond'
  );

  update public.products
  set
    current_price = v_product.fixed_price,
    participant_count = 1,
    bid_history = jsonb_build_array(jsonb_build_object(
      'id', v_bid_id::text,
      'bidAt', v_now,
      'bidderName', v_display_name,
      'amount', v_product.fixed_price
    )),
    closes_at = v_closed_at,
    bid_locked_at = v_now,
    final_bid_id = v_bid_id,
    final_bid_amount = v_product.fixed_price,
    status = 'closed'
  where id = p_product_id;

  -- Create the payment obligation at claim time rather than waiting for the
  -- buyer to reveal the bank account. On a later unpaid reopen, MAX + 1 and
  -- previous_offer_id preserve every prior offer as append-only evidence.
  select exists (
    select 1
    from public.payment_runtime_settings as settings
    where settings.singleton
      and settings.active_mode = 'manual_transfer'
  ) into v_manual_transfer_enabled;

  if v_manual_transfer_enabled then
    select offers.id, offers.offer_round + 1
    into v_previous_offer_id, v_next_offer_round
    from public.auction_purchase_offers as offers
    where offers.product_id = p_product_id
    order by offers.offer_round desc
    limit 1;

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
      payment_due_at,
      previous_offer_id
    ) values (
      p_product_id,
      coalesce(v_next_offer_round, 1),
      'fixed_purchase',
      v_bid_id,
      v_user_id,
      v_display_name,
      v_product.fixed_price,
      'payment_due',
      v_now,
      case
        when public.is_payment_deadline_exempt(v_user_id)
          or public.is_owner_hidden_test_member(v_user_id)
        then null
        else app_private.original_manual_payment_due_at(v_closed_at, v_now)
      end,
      v_previous_offer_id
    ) returning id, offer_round
      into v_purchase_offer_id, v_purchase_offer_round;
  end if;

  perform app_private.write_security_activity(
    v_user_id,
    v_user_id,
    'commerce',
    'commerce.fixed_price.claimed',
    'create',
    'claim_fixed_price_product',
    'product',
    p_product_id::text,
    'notice',
    null,
    null,
    jsonb_build_object(
      'product_id', p_product_id,
      'bid_id', v_bid_id,
      'amount', v_product.fixed_price,
      'sale_type', 'fixed',
      'purchase_offer_id', v_purchase_offer_id,
      'purchase_offer_round', v_purchase_offer_round
    )
  );

  return query select
    p_product_id,
    v_bid_id,
    v_user_id,
    v_display_name,
    v_product.fixed_price,
    v_now;
end;
$$;

revoke all on function public.claim_fixed_price_product(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.claim_fixed_price_product(uuid)
to authenticated;

comment on function public.claim_fixed_price_product(uuid) is
  '활성 카카오 회원이 공개 중인 정가 상품을 한 번만 원자적으로 구매 확정';

-- Publishing reviewed fixed products must not assign the nightly auction
-- deadline. The response keeps the existing auction closes_at contract.
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
  v_published_ids uuid[];
  v_skipped_ids uuid[];
  v_closes_at timestamptz;
begin
  if v_actor is null
    or coalesce(public.access_role_for_user(v_actor), '') not in ('owner', 'operator')
  then
    raise exception using
      errcode = '42501',
      message = '운영자만 대기 상품을 즉시 공개할 수 있습니다.';
  end if;

  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    raise exception using
      errcode = '22023',
      message = '즉시 공개할 상품을 하나 이상 선택해 주세요.';
  end if;
  if cardinality(p_product_ids) > 200 then
    raise exception using
      errcode = '22023',
      message = '한 번에 최대 200개 상품까지 즉시 공개할 수 있습니다.';
  end if;

  select array_agg(input.product_id order by input.first_position)
  into v_ids
  from (
    select input_values.product_id, min(input_values.position) as first_position
    from unnest(p_product_ids) with ordinality as input_values(product_id, position)
    where input_values.product_id is not null
    group by input_values.product_id
  ) as input;

  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception using
      errcode = '22023',
      message = '즉시 공개할 상품 ID를 확인해 주세요.';
  end if;

  v_closes_at := (
    (v_now at time zone 'Asia/Seoul')::date
    + case
        when (v_now at time zone 'Asia/Seoul')::time < time '21:00:00'
        then 0
        else 1
      end
    + time '21:00:00'
  ) at time zone 'Asia/Seoul';

  with published as (
    update public.products as products
    set
      status = 'active',
      publish_at = v_now,
      closes_at = case
        when products.sale_type = 'fixed'
          then timestamptz '9999-12-31 23:59:59+00'
        else v_closes_at
      end,
      updated_by = v_actor
    where products.id = any(v_ids)
      and products.status = 'pending'
    returning products.id
  )
  select coalesce(array_agg(published.id order by published.id), '{}'::uuid[])
  into v_published_ids
  from published;

  select coalesce(array_agg(requested.id order by requested.position), '{}'::uuid[])
  into v_skipped_ids
  from unnest(v_ids) with ordinality as requested(id, position)
  where not (requested.id = any(v_published_ids));

  return query select
    cardinality(v_ids),
    cardinality(v_published_ids),
    cardinality(v_skipped_ids),
    v_published_ids,
    v_skipped_ids,
    v_now,
    v_closes_at;
end;
$$;

revoke all on function public.publish_pending_products_now(uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.publish_pending_products_now(uuid[])
to authenticated;

-- Preserve the exact hardened 8-argument management contract while keeping a
-- pending fixed product's canonical price and non-auction deadline in sync.
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
    when v_product.sale_type = 'fixed'
      then timestamptz '9999-12-31 23:59:59+00'
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
    fixed_price = case
      when v_product.sale_type = 'fixed' then p_starting_price
      else null
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

-- The shared unpaid-offer processor removes the expired winner bid after it
-- records the existing warning/sanction. Auctions stay closed for second-chance
-- handling, while a one-buyer fixed product must return to the public shop.
create or replace function app_private.reopen_fixed_product_after_last_bid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if exists (
    select 1
    from public.products as products
    where products.id = old.product_id
      and products.sale_type = 'fixed'
      and products.fixed_price is not null
  )
  and not exists (
    select 1
    from public.auction_bids as bids
    where bids.product_id = old.product_id
  )
  then
    -- Reuse the exact-product mutation marker already trusted by the hardened
    -- product guards. It is transaction-local and unavailable to PostgREST.
    perform set_config(
      'app.authoritative_bid_product_id',
      old.product_id::text,
      true
    );

    update public.products as products
    set
      status = case
        when products.publish_at <= v_now then 'active'
        else 'pending'
      end,
      closes_at = timestamptz '9999-12-31 23:59:59+00',
      current_price = products.fixed_price,
      participant_count = 0,
      bid_history = '[]'::jsonb,
      bid_locked_at = null,
      final_bid_id = null,
      final_bid_amount = null,
      anti_sniping_base_closes_at = null,
      anti_sniping_extended_at = null,
      anti_sniping_extension_count = 0
    where products.id = old.product_id
      and products.sale_type = 'fixed'
      and products.fixed_price is not null;
  end if;

  return old;
end;
$$;

revoke all on function app_private.reopen_fixed_product_after_last_bid()
from public, anon, authenticated, service_role;

drop trigger if exists auction_bids_reopen_fixed_after_last
on public.auction_bids;
create constraint trigger auction_bids_reopen_fixed_after_last
after delete on public.auction_bids
deferrable initially deferred
for each row execute function app_private.reopen_fixed_product_after_last_bid();
