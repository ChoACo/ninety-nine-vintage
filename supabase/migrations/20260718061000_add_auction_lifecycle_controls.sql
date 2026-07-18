-- Database-authoritative auction blackout, finalization, public sold history,
-- and owner-only test controls. The existing close-expired-products cron name
-- is retained so recent-close operational screens keep the same lifecycle.

create or replace function public.is_auction_blackout(
  p_at timestamptz default clock_timestamp()
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'Asia/Seoul')::time >= time '21:00:00'
     and (p_at at time zone 'Asia/Seoul')::time < time '22:00:00';
$$;

revoke all on function public.is_auction_blackout(timestamptz) from public;

-- Auctions with bids become sold. Unsold auctions roll to the following KST
-- 21:00 deadline, remain visible, and reopen for bidding at 22:00.
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
    + case
        when (p_at at time zone 'Asia/Seoul')::time < time '21:00:00'
        then 0
        else 1
      end
    + time '21:00:00'
  ) at time zone 'Asia/Seoul';

  for v_product in
    select products.id
    from public.products as products
    where products.status = 'active'
      and products.closes_at <= p_at
    order by products.closes_at, products.id
    for update skip locked
  loop
    v_winner := null;

    select bids.*
    into v_winner
    from public.auction_bids as bids
    where bids.product_id = v_product.id
    order by bids.amount desc, bids.created_at, bids.id
    limit 1;

    if v_winner.id is null then
      update public.products as products
      set closes_at = v_next_close
      where products.id = v_product.id;
    else
      -- is_final is derived state, not a mutable bid amount. Keeping exactly
      -- one final row preserves compatibility with the winner/payment RPCs.
      update public.auction_bids as bids
      set is_final = (bids.id = v_winner.id)
      where bids.product_id = v_product.id
        and bids.is_final is distinct from (bids.id = v_winner.id);

      update public.products as products
      set
        status = 'closed',
        bid_locked_at = p_at,
        final_bid_id = v_winner.id,
        final_bid_amount = v_winner.amount
      where products.id = v_product.id;
    end if;

    v_processed_count := v_processed_count + 1;
  end loop;

  return v_processed_count;
end;
$$;

revoke all on function public.finalize_due_auctions(timestamptz)
  from public, anon, authenticated;

-- Replace the former status-only job with the atomic winner finalizer. Running
-- every minute also catches scheduler recovery without changing closes_at.
do $$
declare
  v_job_id bigint;
begin
  select jobs.jobid
  into v_job_id
  from cron.job as jobs
  where jobs.jobname = 'close-expired-products'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'close-expired-products',
    '* * * * *',
    $job$select public.finalize_due_auctions(clock_timestamp());$job$
  );
end;
$$;

-- Non-owner product-management RPCs cannot change auction state during the
-- daily settlement window. Scheduled/service operations have no auth.uid().
create or replace function public.guard_product_auction_blackout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
    and not public.is_owner()
    and public.is_auction_blackout(clock_timestamp())
  then
    if tg_op = 'INSERT' and new.status = 'active' then
      raise exception using
        errcode = 'P0001',
        message = '오후 9시부터 10시까지는 경매 정산 시간입니다.';
    elsif tg_op = 'UPDATE' then
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

drop trigger if exists products_guard_auction_blackout on public.products;
create trigger products_guard_auction_blackout
before insert or update on public.products
for each row execute function public.guard_product_auction_blackout();

-- Re-declare the authoritative transaction so following-day auctions reopen
-- at 22:00. The established 20:56 rule is preserved exactly until 21:00.
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

  if public.is_auction_blackout(v_now) then
    raise exception using errcode = 'P0001', message = '오후 9시부터 10시까지는 경매 정산 시간입니다.';
  end if;
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

  v_participant_count := v_product.participant_count
    + case when v_user_has_bid then 0 else 1 end;
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

-- Owner-native controls use their own append-only audit while retaining the
-- actor/subject/action/payload shape of operator-delegation audit records.
create table if not exists public.owner_auction_action_audit (
  id uuid primary key default gen_random_uuid(),
  actor_owner_id uuid not null references public.profiles (id) on delete restrict,
  subject_member_id uuid references public.profiles (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  action text not null check (action in ('close_now', 'override_price', 'test_bid')),
  reason text not null check (char_length(btrim(reason)) between 2 and 500),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default clock_timestamp()
);

create index if not exists owner_auction_action_audit_product_time_idx
  on public.owner_auction_action_audit (product_id, occurred_at desc);
create index if not exists owner_auction_action_audit_actor_time_idx
  on public.owner_auction_action_audit (actor_owner_id, occurred_at desc);

alter table public.owner_auction_action_audit enable row level security;
revoke all on public.owner_auction_action_audit from public, anon, authenticated;
grant select on public.owner_auction_action_audit to authenticated;

drop policy if exists "Owner reads auction action audit" on public.owner_auction_action_audit;
create policy "Owner reads auction action audit"
on public.owner_auction_action_audit
for select
to authenticated
using ((select public.is_owner()));

create or replace function public.prevent_owner_auction_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = '경매 조작 감사 기록은 변경할 수 없습니다.';
end;
$$;

revoke all on function public.prevent_owner_auction_audit_mutation() from public;

drop trigger if exists owner_auction_action_audit_immutable on public.owner_auction_action_audit;
create trigger owner_auction_action_audit_immutable
before update or delete on public.owner_auction_action_audit
for each row execute function public.prevent_owner_auction_audit_mutation();

create or replace function public.owner_close_auction_now(
  p_product_id uuid,
  p_reason text default '서비스 테스트 즉시 마감'
)
returns table (
  product_id uuid,
  status text,
  closed_at timestamptz,
  winner_bid_id uuid,
  winner_id uuid,
  winner_display_name text,
  winning_amount bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_closed_at timestamptz;
  v_product public.products%rowtype;
  v_after public.products%rowtype;
  v_winner public.auction_bids%rowtype;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '운영 총책임자만 즉시 마감할 수 있습니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 2 and 500 then
    raise exception using errcode = '22023', message = '즉시 마감 사유를 입력해 주세요.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '상품을 찾을 수 없습니다.';
  end if;
  if v_product.status <> 'active' or v_product.publish_at > v_now then
    raise exception using errcode = 'P0001', message = '진행 중인 경매만 즉시 마감할 수 있습니다.';
  end if;

  select bids.* into v_winner
  from public.auction_bids as bids
  where bids.product_id = p_product_id
  order by bids.amount desc, bids.created_at, bids.id
  limit 1;

  update public.auction_bids as bids
  set is_final = (v_winner.id is not null and bids.id = v_winner.id)
  where bids.product_id = p_product_id
    and bids.is_final is distinct from (v_winner.id is not null and bids.id = v_winner.id);

  v_closed_at := greatest(v_now, v_product.publish_at + interval '1 microsecond');
  update public.products as products
  set
    status = 'closed',
    closes_at = v_closed_at,
    bid_locked_at = case when v_winner.id is null then null else v_closed_at end,
    final_bid_id = v_winner.id,
    final_bid_amount = v_winner.amount,
    updated_by = v_actor
  where products.id = p_product_id
  returning products.* into v_after;

  insert into public.owner_auction_action_audit (
    actor_owner_id, subject_member_id, product_id, action, reason,
    before_state, after_state, payload
  ) values (
    v_actor, v_winner.bidder_id, p_product_id, 'close_now', btrim(p_reason),
    to_jsonb(v_product), to_jsonb(v_after),
    jsonb_build_object(
      'winner_bid_id', v_winner.id,
      'winner_id', v_winner.bidder_id,
      'winning_amount', v_winner.amount
    )
  );

  return query select
    p_product_id, v_after.status, v_after.closes_at, v_winner.id,
    v_winner.bidder_id, v_winner.bidder_display_name, v_winner.amount;
end;
$$;

revoke all on function public.owner_close_auction_now(uuid, text) from public;
grant execute on function public.owner_close_auction_now(uuid, text) to authenticated;

create or replace function public.owner_override_auction_price(
  p_product_id uuid,
  p_starting_price bigint default null,
  p_current_price bigint default null,
  p_reason text default '서비스 테스트 가격 조정'
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_product public.products%rowtype;
  v_after public.products%rowtype;
  v_new_starting_price bigint;
  v_new_current_price bigint;
  v_highest_bid bigint;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '운영 총책임자만 경매 가격을 조정할 수 있습니다.';
  end if;
  if p_starting_price is null and p_current_price is null then
    raise exception using errcode = '22023', message = '조정할 가격을 하나 이상 입력해 주세요.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 2 and 500 then
    raise exception using errcode = '22023', message = '가격 조정 사유를 입력해 주세요.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '상품을 찾을 수 없습니다.';
  end if;
  if v_product.status <> 'active'
    or v_product.publish_at > v_now
    or v_product.closes_at <= v_now
    or v_product.bid_locked_at is not null
  then
    raise exception using errcode = 'P0001', message = '진행 중이며 확정되지 않은 경매만 가격을 조정할 수 있습니다.';
  end if;

  select max(bids.amount) into v_highest_bid
  from public.auction_bids as bids where bids.product_id = p_product_id;
  v_new_starting_price := coalesce(p_starting_price, v_product.starting_price);
  v_new_current_price := case
    when p_current_price is not null then p_current_price
    when v_highest_bid is null and p_starting_price is not null then p_starting_price
    else v_product.current_price
  end;

  if v_new_starting_price not between 1 and 1000000000
    or v_new_current_price not between 1 and 1000000000
    or v_new_current_price < v_new_starting_price
    or (v_highest_bid is not null and v_new_current_price < v_highest_bid)
  then
    raise exception using
      errcode = '22023',
      message = '가격은 1원~10억원이며 현재가는 시작가와 최고 입찰가보다 낮을 수 없습니다.';
  end if;

  update public.products as products
  set starting_price = v_new_starting_price,
      current_price = v_new_current_price,
      updated_by = v_actor
  where products.id = p_product_id
  returning products.* into v_after;

  insert into public.owner_auction_action_audit (
    actor_owner_id, product_id, action, reason,
    before_state, after_state, payload
  ) values (
    v_actor, p_product_id, 'override_price', btrim(p_reason),
    to_jsonb(v_product), to_jsonb(v_after),
    jsonb_build_object(
      'requested_starting_price', p_starting_price,
      'requested_current_price', p_current_price,
      'highest_ledger_bid', v_highest_bid
    )
  );

  return next v_after;
end;
$$;

revoke all on function public.owner_override_auction_price(uuid, bigint, bigint, text) from public;
grant execute on function public.owner_override_auction_price(uuid, bigint, bigint, text) to authenticated;

-- The owner can exercise the real ledger as the isolated hidden test member.
-- The predicate is defined by the preceding hidden-owner migration.
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
  if public.is_auction_blackout(v_now) then
    raise exception using errcode = 'P0001', message = '오후 9시부터 10시까지는 경매 정산 시간입니다.';
  end if;
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

  v_participant_count := v_product.participant_count
    + case when v_test_member_has_bid then 0 else 1 end;
  update public.products as products
  set
    current_price = p_amount,
    participant_count = v_participant_count,
    bid_history = jsonb_build_array(jsonb_build_object(
      'id', v_bid_id::text,
      'bidAt', v_now,
      -- Never copy the hidden test nickname into the publicly selectable
      -- products.bid_history projection. The private ledger retains it.
      'bidderName', '***',
      'amount', p_amount
    )) || coalesce(v_product.bid_history, '[]'::jsonb),
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
    jsonb_build_object('bid_id', v_bid_id, 'amount', p_amount, 'is_final', v_is_final)
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

create or replace function public.mask_public_auction_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(btrim(coalesce(p_name, ''))) = 0 then '***'
    when position('*' in btrim(p_name)) > 0 then btrim(p_name)
    when length(btrim(p_name)) = 1 then btrim(p_name) || '*'
    when length(btrim(p_name)) = 2 then left(btrim(p_name), 1) || '*'
    else left(btrim(p_name), 1) || '*' || right(btrim(p_name), 1)
  end;
$$;

revoke all on function public.mask_public_auction_name(text) from public;

-- Only product snapshots and a masked nickname are public. Member UUIDs,
-- hidden test identities, and payment/account data never leave this RPC.
create or replace function public.get_public_sold_auctions(
  p_limit integer default 30,
  p_before timestamptz default null
)
returns table (
  product_id uuid,
  title text,
  description text,
  image_urls text[],
  sold_at timestamptz,
  winning_amount bigint,
  winner_display_name text,
  participant_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = '판매 완료 조회 개수는 1~100개여야 합니다.';
  end if;

  return query
  select
    products.id,
    products.title,
    products.description,
    products.image_urls,
    products.closes_at,
    products.final_bid_amount,
    case
      when public.is_owner_hidden_test_member(winner.bidder_id) then '***'
      else public.mask_public_auction_name(winner.bidder_display_name)
    end,
    products.participant_count
  from public.products as products
  join public.auction_bids as winner
    on winner.id = products.final_bid_id
   and winner.product_id = products.id
  where products.status = 'closed'
    and products.final_bid_id is not null
    and products.final_bid_amount is not null
    and (p_before is null or products.closes_at < p_before)
  order by products.closes_at desc, products.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_public_sold_auctions(integer, timestamptz) from public;
grant execute on function public.get_public_sold_auctions(integer, timestamptz) to anon, authenticated;
