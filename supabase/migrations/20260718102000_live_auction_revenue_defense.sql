-- Server-authoritative live-auction revenue defence.
--
-- 1. Bids placed with strictly less than three minutes remaining extend the
--    product deadline to three minutes from the database clock.
-- 2. A persisted purchase-offer ledger owns manual-transfer deadlines,
--    non-payment penalties, and one optional 12-hour second-chance offer.
-- 3. Existing payment/bid APIs keep their public names; client timers are
--    presentation only and never transition money or auction state.

alter table public.products
  add column if not exists anti_sniping_base_closes_at timestamptz,
  add column if not exists anti_sniping_extended_at timestamptz,
  add column if not exists anti_sniping_extension_count integer not null default 0;

alter table public.products
  drop constraint if exists products_anti_sniping_extension_count_check;
alter table public.products
  add constraint products_anti_sniping_extension_count_check
  check (anti_sniping_extension_count >= 0);

alter table public.products
  drop constraint if exists products_anti_sniping_metadata_check;
alter table public.products
  add constraint products_anti_sniping_metadata_check check (
    (
      anti_sniping_extension_count = 0
      and anti_sniping_base_closes_at is null
      and anti_sniping_extended_at is null
    )
    or (
      anti_sniping_extension_count > 0
      and anti_sniping_base_closes_at is not null
      and anti_sniping_extended_at is not null
      and anti_sniping_base_closes_at <= closes_at
      and anti_sniping_extended_at < closes_at
      and participant_count > 0
      and jsonb_array_length(bid_history) > 0
    )
  );

-- Staff may create an ordinary auction, but extension metadata is owned only
-- by the row-locked bid RPC. This closes direct PostgREST metadata forgery.
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
);

create or replace function app_private.guard_anti_sniping_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authoritative_product_id text := current_setting(
    'app.authoritative_bid_product_id',
    true
  );
begin
  if tg_op = 'INSERT' then
    if new.anti_sniping_extension_count <> 0
      or new.anti_sniping_base_closes_at is not null
      or new.anti_sniping_extended_at is not null
    then
      raise exception using
        errcode = '42501',
        message = '마감 연장 정보는 서버 입찰 엔진에서만 생성할 수 있습니다.';
    end if;
    return new;
  end if;

  if new.anti_sniping_extension_count is distinct from old.anti_sniping_extension_count
    or new.anti_sniping_base_closes_at is distinct from old.anti_sniping_base_closes_at
    or new.anti_sniping_extended_at is distinct from old.anti_sniping_extended_at
  then
    -- Clearing stale metadata is always safe. Any non-empty mutation requires
    -- the transaction-local marker for this exact product.
    if not (
      new.anti_sniping_extension_count = 0
      and new.anti_sniping_base_closes_at is null
      and new.anti_sniping_extended_at is null
    ) and coalesce(v_authoritative_product_id, '') <> new.id::text
    then
      raise exception using
        errcode = '42501',
        message = '마감 연장 정보는 서버 입찰 엔진에서만 변경할 수 있습니다.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_anti_sniping_metadata()
from public, anon, authenticated, service_role;

drop trigger if exists products_guard_anti_sniping_metadata on public.products;
create trigger products_guard_anti_sniping_metadata
before insert or update on public.products
for each row execute function app_private.guard_anti_sniping_metadata();

-- One cheap server-clock sample is shared by all client countdown surfaces.
create or replace function public.get_auction_server_time()
returns timestamptz
language sql
volatile
security definer
set search_path = ''
as $$
  select clock_timestamp();
$$;

revoke all on function public.get_auction_server_time() from public;
grant execute on function public.get_auction_server_time() to anon, authenticated;

-- The normal 21:00-22:00 settlement guard remains intact. Only an update made
-- by the authoritative bid transaction for the exact product may pass during
-- anti-sniping overtime. Direct product writes remain unavailable to members.
create or replace function public.guard_product_auction_blackout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authoritative_bid_product_id text := current_setting(
    'app.authoritative_bid_product_id',
    true
  );
begin
  if auth.uid() is not null
    and not public.is_owner()
    and public.is_auction_blackout(clock_timestamp())
  then
    if tg_op = 'INSERT' and new.status = 'active' then
      raise exception using
        errcode = 'P0001',
        message = '오후 9시부터 10시까지는 경매 정산 시간입니다.';
    elsif tg_op = 'UPDATE'
      and coalesce(v_authoritative_bid_product_id, '') <> new.id::text
    then
      if new.status is distinct from old.status
        or new.publish_at is distinct from old.publish_at
        or new.closes_at is distinct from old.closes_at
        or new.starting_price is distinct from old.starting_price
        or new.current_price is distinct from old.current_price
        or new.bid_increment is distinct from old.bid_increment
        or new.participant_count is distinct from old.participant_count
        or new.bid_history is distinct from old.bid_history
        or new.bid_locked_at is distinct from old.bid_locked_at
        or new.final_bid_id is distinct from old.final_bid_id
        or new.final_bid_amount is distinct from old.final_bid_amount
        or new.anti_sniping_base_closes_at is distinct from old.anti_sniping_base_closes_at
        or new.anti_sniping_extended_at is distinct from old.anti_sniping_extended_at
        or new.anti_sniping_extension_count is distinct from old.anti_sniping_extension_count
      then
        raise exception using
          errcode = 'P0001',
          message = '오후 9시부터 10시까지는 경매 정산 시간입니다.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_product_auction_blackout() from public;

-- Exact replacement of the current authoritative bid transaction with an
-- additive overtime lane. The RPC signature and response remain unchanged.
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
  v_is_overtime boolean := false;
  v_should_extend boolean := false;
  v_next_closes_at timestamptz;
  v_minimum_amount bigint;
  v_participant_count integer;
  v_maximum_amount constant bigint := 1000000000;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인 후 입찰할 수 있습니다.';
  end if;

  select profiles.display_name into v_display_name
  from public.profiles as profiles where profiles.id = v_user_id;
  if v_display_name is null then
    raise exception using errcode = '23503', message = '회원 프로필을 찾을 수 없습니다. 다시 로그인해 주세요.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '입찰 상품을 찾을 수 없습니다.';
  end if;

  v_now := clock_timestamp();
  v_kst_time := (v_now at time zone 'Asia/Seoul')::time;
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

  select exists (
    select 1 from public.auction_bids as bids
    where bids.product_id = p_product_id
  ) into v_has_any_bid;
  select exists (
    select 1 from public.auction_bids as bids
    where bids.product_id = p_product_id and bids.bidder_id = v_user_id
  ) into v_user_has_bid;

  if public.is_auction_blackout(v_now)
    and not (v_is_overtime and v_user_has_bid)
  then
    raise exception using errcode = 'P0001', message = '오후 9시부터 10시까지는 경매 정산 시간입니다.';
  end if;

  -- Overtime never re-opens to a new participant, including after 22:00.
  if v_is_overtime and not v_user_has_bid then
    raise exception using errcode = 'P0001', message = '마감 연장 시간에는 기존 참여자만 입찰할 수 있습니다.';
  end if;

  if v_kst_time >= time '20:56:00' and v_kst_time < time '21:00:00' then
    if not v_has_any_bid then
      v_is_final := true;
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
    raise exception using errcode = '22003', message = format('현재 최소 입찰가는 %s원입니다.', v_minimum_amount);
  end if;

  insert into public.auction_bids (
    id, product_id, bidder_id, bidder_display_name, amount, is_final, created_at
  ) values (
    v_bid_id, p_product_id, v_user_id, v_display_name, p_amount, v_is_final, v_now
  );

  v_should_extend := not v_is_final
    and v_product.closes_at > v_now
    and v_product.closes_at - v_now < interval '3 minutes';
  v_next_closes_at := case
    when v_should_extend then v_now + interval '3 minutes'
    else v_product.closes_at
  end;
  v_participant_count := v_product.participant_count
    + case when v_user_has_bid then 0 else 1 end;

  perform set_config('app.authoritative_bid_product_id', p_product_id::text, true);
  update public.products
  set
    current_price = p_amount,
    participant_count = v_participant_count,
    bid_history = jsonb_build_array(jsonb_build_object(
      'id', v_bid_id::text,
      'bidAt', v_now,
      'bidderName', v_display_name,
      'amount', p_amount
    )) || coalesce(v_product.bid_history, '[]'::jsonb),
    closes_at = v_next_closes_at,
    anti_sniping_base_closes_at = case
      when v_should_extend then coalesce(
        v_product.anti_sniping_base_closes_at,
        v_product.closes_at
      )
      else v_product.anti_sniping_base_closes_at
    end,
    anti_sniping_extended_at = case
      when v_should_extend then v_now
      else v_product.anti_sniping_extended_at
    end,
    anti_sniping_extension_count = v_product.anti_sniping_extension_count
      + case when v_should_extend then 1 else 0 end,
    bid_locked_at = case when v_is_final then v_now else null end,
    final_bid_id = case when v_is_final then v_bid_id else null end,
    final_bid_amount = case when v_is_final then p_amount else null end
  where id = p_product_id;

  return query select
    v_bid_id, p_product_id, v_user_id, v_display_name, p_amount, v_now,
    v_is_final, p_amount, v_participant_count,
    case when v_is_final then v_now else null end,
    case when v_is_final then v_bid_id else null end;
end;
$$;

revoke all on function public.place_bid(uuid, bigint) from public;
grant execute on function public.place_bid(uuid, bigint) to authenticated;

-- The isolated owner test member exercises the same deadline engine. Hidden
-- identity masking and the existing audit contract are preserved.
create or replace function public.owner_place_test_bid(
  p_product_id uuid,
  p_amount bigint,
  p_test_member_id uuid,
  p_reason text default '숨은 테스트 계정 입찰'
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
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_kst_time time;
  v_display_name text;
  v_product public.products%rowtype;
  v_after public.products%rowtype;
  v_bid_id uuid := gen_random_uuid();
  v_has_any_bid boolean;
  v_test_member_has_bid boolean;
  v_is_final boolean := false;
  v_is_overtime boolean := false;
  v_should_extend boolean := false;
  v_next_closes_at timestamptz;
  v_minimum_amount bigint;
  v_participant_count integer;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '운영 총책임자만 테스트 입찰을 실행할 수 있습니다.';
  end if;
  if not public.is_owner_hidden_test_member(p_test_member_id)
    or not exists (
      select 1
      from public.owner_hidden_test_members as hidden_test
      where hidden_test.test_user_id = p_test_member_id
        and hidden_test.owner_id = v_actor
        and hidden_test.retired_at is null
    )
  then
    raise exception using errcode = '42501', message = '승인된 숨은 테스트 계정이 아닙니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 2 and 500 then
    raise exception using errcode = '22023', message = '테스트 입찰 사유를 입력해 주세요.';
  end if;

  select profiles.display_name into v_display_name
  from public.profiles as profiles where profiles.id = p_test_member_id;
  if v_display_name is null then
    raise exception using errcode = 'P0002', message = '숨은 테스트 프로필을 찾을 수 없습니다.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '입찰 상품을 찾을 수 없습니다.';
  end if;

  v_now := clock_timestamp();
  v_kst_time := (v_now at time zone 'Asia/Seoul')::time;
  v_is_overtime := v_product.anti_sniping_extension_count > 0
    and v_product.anti_sniping_base_closes_at is not null
    and v_now >= v_product.anti_sniping_base_closes_at
    and v_now < v_product.closes_at;
  if v_product.status <> 'active'
    or v_product.publish_at > v_now
    or v_product.closes_at <= v_now
    or v_product.bid_locked_at is not null
  then
    raise exception using errcode = 'P0001', message = '현재 입찰 가능한 상품이 아닙니다.';
  end if;

  select exists (
    select 1 from public.auction_bids as bids where bids.product_id = p_product_id
  ) into v_has_any_bid;
  select exists (
    select 1 from public.auction_bids as bids
    where bids.product_id = p_product_id and bids.bidder_id = p_test_member_id
  ) into v_test_member_has_bid;

  if public.is_auction_blackout(v_now)
    and not (v_is_overtime and v_test_member_has_bid)
  then
    raise exception using errcode = 'P0001', message = '오후 9시부터 10시까지는 경매 정산 시간입니다.';
  end if;
  if v_is_overtime and not v_test_member_has_bid then
    raise exception using errcode = 'P0001', message = '마감 연장 시간에는 기존 참여자만 입찰할 수 있습니다.';
  end if;

  if v_kst_time >= time '20:56:00' and v_kst_time < time '21:00:00' then
    if not v_has_any_bid then
      v_is_final := true;
    elsif not v_test_member_has_bid then
      raise exception using errcode = 'P0001', message = '오후 8시 56분부터는 기존 참여자만 입찰할 수 있습니다.';
    end if;
  end if;

  if p_amount is null or p_amount not between 1 and 1000000000 then
    raise exception using errcode = '22003', message = '입찰 금액은 1원~10억원이어야 합니다.';
  end if;
  if v_has_any_bid and v_product.current_price > 1000000000 - v_product.bid_increment then
    raise exception using errcode = '22003', message = '이 상품은 최대 입찰 금액에 도달했습니다.';
  end if;
  v_minimum_amount := case
    when v_has_any_bid then v_product.current_price + v_product.bid_increment
    else v_product.starting_price
  end;
  if p_amount < v_minimum_amount then
    raise exception using errcode = '22003', message = format('현재 최소 입찰가는 %s원입니다.', v_minimum_amount);
  end if;

  insert into public.auction_bids (
    id, product_id, bidder_id, bidder_display_name, amount, is_final, created_at
  ) values (
    v_bid_id, p_product_id, p_test_member_id, v_display_name, p_amount, v_is_final, v_now
  );

  v_should_extend := not v_is_final
    and v_product.closes_at > v_now
    and v_product.closes_at - v_now < interval '3 minutes';
  v_next_closes_at := case
    when v_should_extend then v_now + interval '3 minutes'
    else v_product.closes_at
  end;
  v_participant_count := v_product.participant_count
    + case when v_test_member_has_bid then 0 else 1 end;
  perform set_config('app.authoritative_bid_product_id', p_product_id::text, true);
  update public.products as products
  set
    current_price = p_amount,
    participant_count = v_participant_count,
    bid_history = jsonb_build_array(jsonb_build_object(
      'id', v_bid_id::text,
      'bidAt', v_now,
      'bidderName', '***',
      'amount', p_amount
    )) || coalesce(v_product.bid_history, '[]'::jsonb),
    closes_at = v_next_closes_at,
    anti_sniping_base_closes_at = case
      when v_should_extend then coalesce(
        v_product.anti_sniping_base_closes_at,
        v_product.closes_at
      )
      else v_product.anti_sniping_base_closes_at
    end,
    anti_sniping_extended_at = case
      when v_should_extend then v_now
      else v_product.anti_sniping_extended_at
    end,
    anti_sniping_extension_count = v_product.anti_sniping_extension_count
      + case when v_should_extend then 1 else 0 end,
    bid_locked_at = case when v_is_final then v_now else null end,
    final_bid_id = case when v_is_final then v_bid_id else null end,
    final_bid_amount = case when v_is_final then p_amount else null end,
    updated_by = v_actor
  where products.id = p_product_id
  returning products.* into v_after;

  insert into public.owner_auction_action_audit (
    actor_owner_id, subject_member_id, product_id, action, reason,
    before_state, after_state, payload
  ) values (
    v_actor, p_test_member_id, p_product_id, 'test_bid', btrim(p_reason),
    to_jsonb(v_product), to_jsonb(v_after),
    jsonb_build_object(
      'bid_id', v_bid_id,
      'amount', p_amount,
      'is_final', v_is_final,
      'anti_sniping_extended', v_should_extend
    )
  );

  return query select
    v_bid_id, p_product_id, p_test_member_id, v_display_name, p_amount, v_now,
    v_is_final, p_amount, v_participant_count,
    case when v_is_final then v_now else null end,
    case when v_is_final then v_bid_id else null end;
end;
$$;

revoke all on function public.owner_place_test_bid(uuid, bigint, uuid, text) from public;
grant execute on function public.owner_place_test_bid(uuid, bigint, uuid, text) to authenticated;

-- Sanctions can remove every bid from an extended auction. Clear the overtime
-- identity immediately after the last row disappears so the ordinary rollover
-- can publish the product again instead of treating the next day as overtime.
create or replace function app_private.clear_anti_sniping_after_last_bid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.auction_bids as bids
    where bids.product_id = old.product_id
  ) then
    perform set_config(
      'app.authoritative_bid_product_id',
      old.product_id::text,
      true
    );
    update public.products as products
    set
      anti_sniping_base_closes_at = null,
      anti_sniping_extended_at = null,
      anti_sniping_extension_count = 0
    where products.id = old.product_id
      and products.anti_sniping_extension_count > 0;
  end if;
  return old;
end;
$$;

revoke all on function app_private.clear_anti_sniping_after_last_bid()
from public, anon, authenticated, service_role;

drop trigger if exists auction_bids_clear_anti_sniping_after_last
on public.auction_bids;
create trigger auction_bids_clear_anti_sniping_after_last
after delete on public.auction_bids
for each row execute function app_private.clear_anti_sniping_after_last_bid();

-- ---------------------------------------------------------------------------
-- Purchase-offer and manual-transfer deadline ledger
-- ---------------------------------------------------------------------------

create table public.auction_revenue_defense_settings (
  singleton boolean primary key default true check (singleton),
  policy_effective_at timestamptz not null default clock_timestamp(),
  original_payment_hour smallint not null default 11
    check (original_payment_hour between 0 and 23),
  original_payment_minute smallint not null default 59
    check (original_payment_minute between 0 and 59),
  second_chance_hours smallint not null default 12
    check (second_chance_hours between 1 and 48),
  created_at timestamptz not null default clock_timestamp()
);

insert into public.auction_revenue_defense_settings (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.auction_revenue_defense_settings enable row level security;
alter table public.auction_revenue_defense_settings force row level security;
revoke all on public.auction_revenue_defense_settings
from public, anon, authenticated, service_role;

create table public.auction_purchase_offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  offer_round integer not null check (offer_round between 1 and 2),
  offer_kind text not null check (offer_kind in ('original', 'second_chance')),
  bid_id uuid references public.auction_bids (id) on delete set null,
  bidder_id uuid references public.profiles (id) on delete set null,
  bidder_display_name_snapshot text not null
    check (char_length(btrim(bidder_display_name_snapshot)) between 1 and 80),
  offered_amount bigint not null check (offered_amount between 1 and 1000000000),
  status text not null check (
    status in (
      'payment_due',
      'offered',
      'accepted',
      'settled',
      'expired_unpaid',
      'declined',
      'expired_offer',
      'no_successor'
    )
  ),
  offered_at timestamptz not null default clock_timestamp(),
  response_due_at timestamptz,
  payment_due_at timestamptz,
  accepted_at timestamptz,
  settled_at timestamptz,
  previous_offer_id uuid references public.auction_purchase_offers (id)
    on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  unique (product_id, offer_round),
  check (
    (offer_kind = 'original' and offer_round = 1)
    or (offer_kind = 'second_chance' and offer_round = 2)
  ),
  check (
    (offer_kind = 'original' and response_due_at is null)
    or (
      offer_kind = 'second_chance'
      and response_due_at is not null
      and response_due_at > offered_at
    )
  ),
  check (payment_due_at is null or payment_due_at > offered_at)
);

create unique index auction_purchase_offers_live_product_idx
on public.auction_purchase_offers (product_id)
where status in ('payment_due', 'offered', 'accepted');

create index auction_purchase_offers_member_due_idx
on public.auction_purchase_offers (bidder_id, payment_due_at)
where status in ('payment_due', 'offered', 'accepted');

create index auction_purchase_offers_processor_idx
on public.auction_purchase_offers (
  coalesce(response_due_at, payment_due_at),
  id
)
where status in ('payment_due', 'offered', 'accepted');

alter table public.auction_purchase_offers enable row level security;
alter table public.auction_purchase_offers force row level security;
revoke all on public.auction_purchase_offers
from public, anon, authenticated, service_role;

create or replace function app_private.guard_payment_mode_with_live_offers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active_mode is distinct from old.active_mode
    and exists (
      select 1
      from public.auction_purchase_offers as offers
      where offers.status in ('payment_due', 'offered', 'accepted')
    )
  then
    raise exception using
      errcode = '55000',
      message = '진행 중인 낙찰 결제 또는 차순위 구매 기회가 있어 결제 모드를 전환할 수 없습니다.';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_payment_mode_with_live_offers()
from public, anon, authenticated, service_role;

drop trigger if exists payment_runtime_guard_live_purchase_offers
on public.payment_runtime_settings;
create trigger payment_runtime_guard_live_purchase_offers
before update of active_mode on public.payment_runtime_settings
for each row execute function app_private.guard_payment_mode_with_live_offers();

create table public.auction_offer_penalties (
  offer_id uuid primary key references public.auction_purchase_offers (id)
    on delete restrict,
  warning_id uuid not null unique references public.member_warnings (id)
    on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.auction_offer_penalties enable row level security;
alter table public.auction_offer_penalties force row level security;
revoke all on public.auction_offer_penalties
from public, anon, authenticated, service_role;

alter table public.manual_transfer_orders
  drop constraint if exists manual_transfer_orders_product_id_key;

alter table public.manual_transfer_orders
  add column if not exists purchase_offer_id uuid
    references public.auction_purchase_offers (id) on delete restrict,
  add column if not exists due_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

alter table public.manual_transfer_orders
  drop constraint if exists manual_transfer_orders_status_check;
alter table public.manual_transfer_orders
  add constraint manual_transfer_orders_status_check check (
    status in ('awaiting_manual_transfer', 'confirmed', 'cancelled_unpaid')
  );

alter table public.manual_transfer_orders
  drop constraint if exists manual_transfer_orders_confirmation_check;
alter table public.manual_transfer_orders
  add constraint manual_transfer_orders_confirmation_check check (
    (
      status = 'awaiting_manual_transfer'
      and confirmed_at is null
      and confirmed_by is null
      and cancelled_at is null
      and cancellation_reason is null
    )
    or (
      status = 'confirmed'
      and confirmed_at is not null
      and cancelled_at is null
      and cancellation_reason is null
    )
    or (
      status = 'cancelled_unpaid'
      and confirmed_at is null
      and confirmed_by is null
      and cancelled_at is not null
      and char_length(btrim(cancellation_reason)) between 2 and 200
    )
  );

create unique index manual_transfer_orders_live_product_idx
on public.manual_transfer_orders (product_id)
where status in ('awaiting_manual_transfer', 'confirmed');

create unique index manual_transfer_orders_purchase_offer_idx
on public.manual_transfer_orders (purchase_offer_id)
where purchase_offer_id is not null;

create index manual_transfer_orders_due_idx
on public.manual_transfer_orders (due_at, id)
where status = 'awaiting_manual_transfer' and due_at is not null;

-- Members cannot erase an accepted purchase obligation to bypass the no-show
-- policy. Optional, unaccepted offers are declined automatically; completed
-- and cancelled financial history is retained with its direct identity removed.
create or replace function app_private.anonymize_manual_transfer_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.auction_purchase_offers as offers
    where offers.bidder_id = old.id
      and offers.status in ('payment_due', 'accepted')
  ) then
    raise exception using
      errcode = '55000',
      message = '입금 처리 중인 낙찰 상품이 있어 회원 탈퇴를 진행할 수 없습니다.';
  end if;

  update public.auction_purchase_offers as offers
  set status = 'declined'
  where offers.bidder_id = old.id
    and offers.status = 'offered';

  delete from public.manual_transfer_orders
  where buyer_id = old.id
    and status = 'awaiting_manual_transfer';

  update public.manual_transfer_orders
  set
    buyer_id = null,
    buyer_deleted_at = clock_timestamp()
  where buyer_id = old.id
    and status in ('confirmed', 'cancelled_unpaid');
  return old;
end;
$$;

revoke all on function app_private.anonymize_manual_transfer_history()
from public, anon, authenticated, service_role;

create or replace function app_private.original_manual_payment_due_at(
  p_closed_at timestamptz,
  p_now timestamptz default clock_timestamp()
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select greatest(
    (
      (p_closed_at at time zone 'Asia/Seoul')::date
      + 1
      + make_time(
          settings.original_payment_hour,
          settings.original_payment_minute,
          59
        )
    ) at time zone 'Asia/Seoul',
    p_now + interval '1 hour'
  )
  from public.auction_revenue_defense_settings as settings
  where settings.singleton;
$$;

revoke all on function app_private.original_manual_payment_due_at(
  timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create or replace function app_private.set_purchase_offer_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function app_private.set_purchase_offer_updated_at()
from public, anon, authenticated, service_role;

create trigger auction_purchase_offers_set_updated_at
before update on public.auction_purchase_offers
for each row execute function app_private.set_purchase_offer_updated_at();

-- A cancelled ledger no longer blocks a later provider or the successor's
-- own manual-transfer record. Confirmed and waiting ledgers still prevent
-- double settlement exactly as before.
create or replace function app_private.reject_portone_manual_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.manual_transfer_orders as manual_orders
    where manual_orders.product_id = new.product_id
      and manual_orders.status in ('awaiting_manual_transfer', 'confirmed')
  ) then
    raise exception using
      errcode = '55000',
      message = '수동 계좌이체가 진행 중이거나 완료된 상품입니다.';
  end if;
  return new;
end;
$$;

revoke all on function app_private.reject_portone_manual_overlap()
from public, anon, authenticated, service_role;

create or replace function public.get_manual_transfer_status_for_service(
  p_product_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select manual_orders.status
  from public.manual_transfer_orders as manual_orders
  where manual_orders.product_id = p_product_id
    and manual_orders.status in ('awaiting_manual_transfer', 'confirmed')
  order by
    case manual_orders.status when 'confirmed' then 0 else 1 end,
    manual_orders.updated_at desc,
    manual_orders.id desc
  limit 1;
$$;

revoke all on function public.get_manual_transfer_status_for_service(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_manual_transfer_status_for_service(uuid)
to service_role;

-- Operations projection includes the persisted deadline and offer round so a
-- staff member can distinguish an original winner from a second chance before
-- touching the confirmation action.
drop function if exists public.get_pending_manual_transfers(integer, integer);
create function public.get_pending_manual_transfers(
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  order_id uuid,
  product_id uuid,
  buyer_id uuid,
  buyer_display_name text,
  product_title text,
  image_urls text[],
  bank_name text,
  account_number text,
  expected_amount bigint,
  status text,
  requested_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz,
  total_count bigint,
  due_at timestamptz,
  purchase_offer_kind text,
  purchase_offer_status text,
  purchase_offer_round integer,
  payment_deadline_exempt boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_manage_members() then
    raise exception using errcode = '42501', message = '입금 확인 권한이 없습니다.';
  end if;
  if p_limit not between 1 and 200 or p_offset not between 0 and 1000000 then
    raise exception using errcode = '22023', message = '조회 범위를 확인해 주세요.';
  end if;

  return query
  select
    manual_orders.id,
    manual_orders.product_id,
    manual_orders.buyer_id,
    coalesce(profiles.display_name, '탈퇴 회원'),
    products.title,
    products.image_urls,
    manual_orders.bank_name_snapshot,
    manual_orders.account_number_snapshot,
    manual_orders.expected_amount,
    manual_orders.status,
    manual_orders.requested_at,
    manual_orders.confirmed_at,
    manual_orders.updated_at,
    count(*) over (),
    manual_orders.due_at,
    offers.offer_kind,
    offers.status,
    offers.offer_round,
    public.is_payment_deadline_exempt(manual_orders.buyer_id)
  from public.manual_transfer_orders as manual_orders
  join public.products as products on products.id = manual_orders.product_id
  left join public.profiles as profiles on profiles.id = manual_orders.buyer_id
  left join public.auction_purchase_offers as offers
    on offers.id = manual_orders.purchase_offer_id
  where manual_orders.status = 'awaiting_manual_transfer'
    and (
      public.is_owner()
      or not exists (
        select 1
        from public.owner_hidden_test_members as hidden_test_members
        where hidden_test_members.test_user_id = manual_orders.buyer_id
      )
    )
  order by manual_orders.due_at nulls last, manual_orders.requested_at,
    manual_orders.id
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_pending_manual_transfers(integer, integer)
from public, anon;
grant execute on function public.get_pending_manual_transfers(integer, integer)
to authenticated;

-- Cron cannot call the staff-only add_member_warning RPC. This private helper
-- reuses the same advisory lock, every-third-warning rule, escalating sanction
-- duration, and active-bid cancellation contract with a NULL system actor.
create or replace function app_private.apply_system_late_payment_warning(
  p_offer_id uuid,
  p_member_id uuid,
  p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_warning_count integer;
  v_sanction_count integer;
  v_blocked_until timestamptz;
  v_warning_id uuid;
  v_sanction_id uuid;
  v_sanction_round integer;
  v_lock_key bigint;
begin
  if p_offer_id is null or p_member_id is null or p_now is null then
    return null;
  end if;
  if public.is_payment_deadline_exempt(p_member_id)
    or public.is_owner_hidden_test_member(p_member_id)
  then
    return null;
  end if;

  select penalties.warning_id, sanctions.id
  into v_warning_id, v_sanction_id
  from public.auction_offer_penalties as penalties
  left join public.member_bid_sanctions as sanctions
    on sanctions.warning_id = penalties.warning_id
  where penalties.offer_id = p_offer_id;
  if v_warning_id is not null then
    return v_sanction_id;
  end if;

  v_lock_key := hashtextextended(
    'member-warning-enforcement:' || p_member_id::text,
    0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  -- Role changes may happen after the auction closes. Re-check under the same
  -- member lock so staff accounts and newly exempt band members are never
  -- sanctioned by a stale offer snapshot.
  if coalesce(public.access_role_for_user(p_member_id), '')
      not in ('member', 'band_member')
    or public.is_payment_deadline_exempt(p_member_id)
    or public.is_owner_hidden_test_member(p_member_id)
  then
    return null;
  end if;

  -- Re-check after acquiring the same member lock used by the operator path.
  select penalties.warning_id, sanctions.id
  into v_warning_id, v_sanction_id
  from public.auction_offer_penalties as penalties
  left join public.member_bid_sanctions as sanctions
    on sanctions.warning_id = penalties.warning_id
  where penalties.offer_id = p_offer_id;
  if v_warning_id is not null then
    return v_sanction_id;
  end if;

  select count(*)::integer
  into v_warning_count
  from public.member_warnings as warnings
  where warnings.member_id = p_member_id;

  select count(*)::integer, max(sanctions.ends_at)
  into v_sanction_count, v_blocked_until
  from public.member_bid_sanctions as sanctions
  where sanctions.member_id = p_member_id;

  v_warning_count := v_warning_count + 1;
  insert into public.member_warnings (
    member_id,
    category,
    reason,
    warning_number,
    created_by,
    created_at
  ) values (
    p_member_id,
    'late_payment',
    '낙찰 상품 계좌이체 기한 미준수',
    v_warning_count,
    null,
    p_now
  ) returning id into v_warning_id;

  insert into public.auction_offer_penalties (offer_id, warning_id, created_at)
  values (p_offer_id, v_warning_id, p_now);

  if mod(v_warning_count, 3) = 0 then
    v_sanction_round := v_sanction_count + 1;
    v_blocked_until := greatest(p_now, coalesce(v_blocked_until, p_now))
      + make_interval(days => v_sanction_round);

    insert into public.member_bid_sanctions (
      member_id,
      warning_id,
      sanction_round,
      starts_at,
      ends_at
    ) values (
      p_member_id,
      v_warning_id,
      v_sanction_round,
      p_now,
      v_blocked_until
    ) returning id into v_sanction_id;

    perform public.cancel_member_active_bids(
      p_member_id,
      v_sanction_id,
      p_now
    );
  end if;

  return v_sanction_id;
end;
$$;

revoke all on function app_private.apply_system_late_payment_warning(
  uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;

-- Confirmation and expiry both lock products before payment rows. The trigger
-- performs the last server-clock boundary check so an operator cannot confirm
-- an order after the processor has made it ineligible.
create or replace function app_private.guard_manual_transfer_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.auction_purchase_offers%rowtype;
begin
  if new.status = 'confirmed'
    and old.status = 'awaiting_manual_transfer'
  then
    if old.due_at is not null and clock_timestamp() >= old.due_at then
      raise exception using
        errcode = '55000',
        message = '입금 확인 기한이 지나 차순위 승계 처리 대상입니다.';
    end if;

    if old.purchase_offer_id is not null then
      select offers.* into v_offer
      from public.auction_purchase_offers as offers
      where offers.id = old.purchase_offer_id
      for update;

      if v_offer.id is null
        or v_offer.product_id <> old.product_id
        or v_offer.bidder_id is distinct from old.buyer_id
        or v_offer.status not in ('payment_due', 'accepted')
        or (
          v_offer.payment_due_at is not null
          and clock_timestamp() >= v_offer.payment_due_at
        )
      then
        raise exception using
          errcode = '55000',
          message = '현재 유효한 낙찰 결제 권한이 아닙니다.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_manual_transfer_deadline()
from public, anon, authenticated, service_role;

create trigger manual_transfer_orders_guard_deadline
before update of status on public.manual_transfer_orders
for each row execute function app_private.guard_manual_transfer_deadline();

create or replace function app_private.sync_offer_from_manual_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.purchase_offer_id is not null and new.status = 'confirmed' then
    update public.auction_purchase_offers as offers
    set status = 'settled', settled_at = new.confirmed_at
    where offers.id = new.purchase_offer_id
      and offers.status in ('payment_due', 'accepted');
  elsif new.purchase_offer_id is not null
    and new.status = 'cancelled_unpaid'
  then
    update public.auction_purchase_offers as offers
    set status = 'expired_unpaid'
    where offers.id = new.purchase_offer_id
      and offers.status in ('payment_due', 'accepted');
  end if;
  return new;
end;
$$;

revoke all on function app_private.sync_offer_from_manual_transfer()
from public, anon, authenticated, service_role;

create trigger manual_transfer_orders_sync_purchase_offer
after insert or update of status on public.manual_transfer_orders
for each row execute function app_private.sync_offer_from_manual_transfer();

create or replace function public.process_auction_purchase_offers(
  p_at timestamptz default clock_timestamp()
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
  where products.status = 'closed'
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
  where offers.status in ('payment_due', 'accepted')
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
    where offers.status = 'offered'
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
    where offers.status in ('payment_due', 'accepted')
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

revoke all on function public.process_auction_purchase_offers(timestamptz)
from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobs.jobid into v_job_id
  from cron.job as jobs
  where jobs.jobname = 'process-auction-purchase-offers'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'process-auction-purchase-offers',
    '* * * * *',
    $job$select public.process_auction_purchase_offers(clock_timestamp());$job$
  );
end;
$$;

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
stable
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

create or replace function public.claim_my_second_chance_offer(
  p_offer_id uuid
)
returns table (
  offer_id uuid,
  product_id uuid,
  status text,
  payment_due_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_product_id uuid;
  v_product public.products%rowtype;
  v_offer public.auction_purchase_offers%rowtype;
  v_bid public.auction_bids%rowtype;
  v_settings public.payment_runtime_settings%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;

  select settings.* into v_settings
  from public.payment_runtime_settings as settings
  where settings.singleton
  for share;
  if v_settings.active_mode <> 'manual_transfer'
    or v_settings.bank_name is null
    or v_settings.account_number is null
  then
    raise exception using
      errcode = '55000',
      message = '현재 계좌이체 구매 기회를 수락할 수 없습니다.';
  end if;

  select offers.product_id into v_product_id
  from public.auction_purchase_offers as offers
  where offers.id = p_offer_id;
  if v_product_id is null then
    raise exception using errcode = 'P0002', message = '차순위 구매 기회를 찾지 못했습니다.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = v_product_id
  for update;

  select offers.* into v_offer
  from public.auction_purchase_offers as offers
  where offers.id = p_offer_id
  for update;

  if v_offer.bidder_id is distinct from v_user_id
    or v_offer.offer_kind <> 'second_chance'
    or v_offer.status <> 'offered'
  then
    raise exception using errcode = '42501', message = '본인의 유효한 차순위 구매 기회가 아닙니다.';
  end if;
  if v_offer.response_due_at is null or v_offer.response_due_at <= v_now then
    raise exception using errcode = '55000', message = '차순위 구매 기회가 만료되었습니다.';
  end if;
  if v_product.status <> 'closed'
    or v_product.final_bid_id is not null
    or v_product.final_bid_amount is not null
  then
    raise exception using errcode = '55000', message = '다른 결제 권한이 이미 확정된 상품입니다.';
  end if;

  select bids.* into v_bid
  from public.auction_bids as bids
  where bids.id = v_offer.bid_id
    and bids.product_id = v_offer.product_id
    and bids.bidder_id = v_user_id
  for update;
  if v_bid.id is null or v_bid.amount <> v_offer.offered_amount then
    raise exception using errcode = '55000', message = '차순위 입찰 원장을 검증하지 못했습니다.';
  end if;

  update public.auction_bids as bids
  set is_final = (bids.id = v_bid.id)
  where bids.product_id = v_offer.product_id
    and bids.is_final is distinct from (bids.id = v_bid.id);

  perform set_config('app.authoritative_bid_product_id', v_offer.product_id::text, true);
  update public.products
  set
    final_bid_id = v_bid.id,
    final_bid_amount = v_bid.amount,
    bid_locked_at = v_now,
    current_price = v_bid.amount
  where id = v_offer.product_id;

  update public.auction_purchase_offers
  set status = 'accepted', accepted_at = v_now
  where id = v_offer.id
  returning * into v_offer;

  return query select
    v_offer.id,
    v_offer.product_id,
    v_offer.status,
    v_offer.payment_due_at;
end;
$$;

revoke all on function public.claim_my_second_chance_offer(uuid)
from public, anon;
grant execute on function public.claim_my_second_chance_offer(uuid)
to authenticated;

create or replace function public.decline_my_second_chance_offer(
  p_offer_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_product_id uuid;
  v_offer public.auction_purchase_offers%rowtype;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;

  select offers.product_id into v_product_id
  from public.auction_purchase_offers as offers
  where offers.id = p_offer_id;
  if v_product_id is null then
    raise exception using errcode = 'P0002', message = '차순위 구매 기회를 찾지 못했습니다.';
  end if;

  perform products.id
  from public.products as products
  where products.id = v_product_id
  for update;

  select offers.* into v_offer
  from public.auction_purchase_offers as offers
  where offers.id = p_offer_id
  for update;

  if v_offer.bidder_id is distinct from v_user_id
    or v_offer.offer_kind <> 'second_chance'
    or v_offer.status <> 'offered'
  then
    raise exception using errcode = '42501', message = '본인의 유효한 차순위 구매 기회가 아닙니다.';
  end if;
  if v_offer.response_due_at is null
    or v_offer.response_due_at <= clock_timestamp()
  then
    raise exception using errcode = '55000', message = '차순위 구매 기회가 만료되었습니다.';
  end if;

  update public.auction_purchase_offers
  set status = 'declined'
  where id = v_offer.id;
  return 'declined';
end;
$$;

revoke all on function public.decline_my_second_chance_offer(uuid)
from public, anon;
grant execute on function public.decline_my_second_chance_offer(uuid)
to authenticated;

-- Preserve the public checkout response while binding each new payment intent
-- to the canonical products.final_bid_id and persisted purchase-offer deadline.
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
    on conflict (product_id, offer_round) do update
      set updated_at = excluded.updated_at
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

drop function if exists public.get_my_won_products();
create function public.get_my_won_products()
returns table (
  product_id uuid,
  title text,
  image_urls text[],
  closed_at timestamptz,
  final_bid_amount bigint,
  shipping_status text,
  shipment_request_id uuid,
  payment_id text,
  payment_method text,
  vbank_num text,
  vbank_bank text,
  vbank_due timestamptz,
  payment_status text,
  requested_method text,
  portone_status text,
  manual_transfer_order_id uuid,
  manual_transfer_status text,
  manual_transfer_requested_at timestamptz,
  manual_transfer_confirmed_at timestamptz,
  is_payment_settled boolean,
  active_payment_mode text,
  purchase_offer_id uuid,
  purchase_offer_kind text,
  purchase_offer_status text,
  purchase_offer_round integer,
  payment_due_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;

  return query
  select
    products.id,
    products.title,
    products.image_urls,
    products.closes_at,
    winner.amount,
    case
      when requests.status = 'shipped' then 'shipped'
      when requests.id is not null then 'requested'
      else 'ready'
    end,
    requests.id,
    orders.payment_id,
    orders.payment_method,
    orders.vbank_num,
    orders.vbank_bank,
    orders.vbank_due,
    case
      when orders.portone_status = 'PAID' then '결제완료'
      when manual_orders.status = 'confirmed' then '결제완료'
      else coalesce(orders.payment_status, '대기중')
    end,
    orders.requested_method,
    orders.portone_status,
    manual_orders.id,
    manual_orders.status,
    manual_orders.requested_at,
    manual_orders.confirmed_at,
    app_private.is_product_payment_settled(products.id, v_user_id),
    settings.active_mode,
    offers.id,
    offers.offer_kind,
    offers.status,
    offers.offer_round,
    coalesce(manual_orders.due_at, offers.payment_due_at)
  from public.products as products
  join public.auction_bids as winner
    on winner.id = products.final_bid_id
   and winner.product_id = products.id
  cross join public.payment_runtime_settings as settings
  left join public.shipping_request_items as items
    on items.product_id = products.id
  left join public.shipping_requests as requests
    on requests.id = items.request_id
  left join public.payment_orders as orders
    on orders.product_id = products.id and orders.buyer_id = v_user_id
  left join lateral (
    select manual_rows.*
    from public.manual_transfer_orders as manual_rows
    where manual_rows.product_id = products.id
      and manual_rows.buyer_id = v_user_id
      and manual_rows.status in ('awaiting_manual_transfer', 'confirmed')
    order by
      case manual_rows.status when 'confirmed' then 0 else 1 end,
      manual_rows.updated_at desc,
      manual_rows.id desc
    limit 1
  ) as manual_orders on true
  left join lateral (
    select offer_rows.*
    from public.auction_purchase_offers as offer_rows
    where offer_rows.product_id = products.id
      and offer_rows.bidder_id = v_user_id
      and offer_rows.status in ('payment_due', 'accepted', 'settled')
    order by offer_rows.offer_round desc
    limit 1
  ) as offers on true
  where winner.bidder_id = v_user_id
    and products.status = 'closed'
    and settings.singleton
    and (
      offers.id is not null
      or not exists (
        select 1
        from public.auction_purchase_offers as any_offer
        where any_offer.product_id = products.id
      )
      or products.closes_at < (
        select policy.policy_effective_at
        from public.auction_revenue_defense_settings as policy
        where policy.singleton
      )
      or public.is_payment_deadline_exempt(v_user_id)
    )
  order by products.closes_at desc, products.id;
end;
$$;

revoke all on function public.get_my_won_products() from public, anon;
grant execute on function public.get_my_won_products() to authenticated;
