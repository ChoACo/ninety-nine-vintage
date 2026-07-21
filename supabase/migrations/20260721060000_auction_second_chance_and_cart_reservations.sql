-- DB-authoritative operator second-chance action and fixed-price cart holds.
--
-- Auction deadlines continue to use the existing clock_timestamp()-based bid
-- transaction. Fixed-price payment/order ledgers also remain unchanged: this
-- migration serializes a short cart hold with those existing checkout RPCs by
-- locking the same product row and consuming the hold from an order-item
-- trigger inside the checkout transaction.

alter table public.cart_items
  add column if not exists reserved_until timestamptz;

-- Preserve only carts that were created during the last fifteen minutes. A
-- future created_at written through the former direct-table policy is clamped
-- before the reservation invariant is installed.
update public.cart_items
set created_at = clock_timestamp()
where created_at > clock_timestamp();

update public.cart_items
set reserved_until = least(
  created_at + interval '15 minutes',
  clock_timestamp() + interval '15 minutes'
)
where reserved_until is null;

delete from public.cart_items
where reserved_until <= clock_timestamp();

-- The old cart was a personal list, so more than one member could contain the
-- same one-of-one product. Keep the newest still-live row when introducing the
-- exclusive inventory contract.
with ranked_cart_items as (
  select
    cart_items.ctid,
    row_number() over (
      partition by cart_items.product_id
      order by cart_items.reserved_until desc, cart_items.created_at desc,
        cart_items.member_id
    ) as reservation_rank
  from public.cart_items as cart_items
)
delete from public.cart_items as cart_items
using ranked_cart_items as ranked
where cart_items.ctid = ranked.ctid
  and ranked.reservation_rank > 1;

alter table public.cart_items
  alter column reserved_until
    set default (clock_timestamp() + interval '15 minutes'),
  alter column reserved_until set not null;

alter table public.cart_items
  drop constraint if exists cart_items_reservation_window_check;
alter table public.cart_items
  add constraint cart_items_reservation_window_check
  check (reserved_until > created_at);

create unique index if not exists cart_items_product_reservation_key
on public.cart_items (product_id);

create index if not exists cart_items_member_reservation_idx
on public.cart_items (member_id, reserved_until desc);

drop policy if exists "Members manage their cart" on public.cart_items;
drop policy if exists "Members read their cart reservations"
on public.cart_items;
create policy "Members read their cart reservations"
on public.cart_items
for select
to authenticated
using (
  member_id = (select auth.uid())
  and reserved_until > clock_timestamp()
);

-- Inventory writes are RPC-only. This removes the former ability to forge
-- created_at/reserved_until or race a direct PostgREST upsert.
revoke insert, update, delete, truncate on table public.cart_items
from anon, authenticated;
grant select on table public.cart_items to authenticated;

create or replace function public.get_my_cart_reservations()
returns table (
  product_id uuid,
  created_at timestamptz,
  reserved_until timestamptz,
  server_time timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null or not public.is_member() then
    raise exception using
      errcode = '42501',
      message = '카카오 회원 로그인 후 장바구니를 이용해 주세요.';
  end if;

  return query
  select
    cart_items.product_id,
    cart_items.created_at,
    cart_items.reserved_until,
    v_now
  from public.cart_items as cart_items
  where cart_items.member_id = v_user_id
    and cart_items.reserved_until > v_now
  order by cart_items.created_at desc, cart_items.product_id;
end;
$$;

revoke all on function public.get_my_cart_reservations()
from public, anon, authenticated, service_role;
grant execute on function public.get_my_cart_reservations()
to authenticated;

create or replace function public.reserve_fixed_product_for_cart(
  p_product_id uuid
)
returns table (
  product_id uuid,
  reserved_until timestamptz,
  server_time timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_product public.products%rowtype;
  v_reservation public.cart_items%rowtype;
begin
  if p_product_id is null then
    raise exception using
      errcode = '22023',
      message = '장바구니에 담을 상품을 선택해 주세요.';
  end if;
  if v_user_id is null or not public.is_member() then
    raise exception using
      errcode = '42501',
      message = '카카오 회원 로그인 후 장바구니를 이용해 주세요.';
  end if;

  -- Checkout and reservation acquisition lock this same row. Whichever
  -- transaction wins is therefore the only one that can consume/hold stock.
  select products.*
  into v_product
  from public.products as products
  where products.id = p_product_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '상품을 찾을 수 없습니다.';
  end if;

  v_now := clock_timestamp();
  if v_product.sale_type <> 'fixed'
    or v_product.fixed_price is null
    or v_product.status <> 'active'
    or v_product.publish_at > v_now
  then
    raise exception using
      errcode = 'P0001',
      message = '현재 구매할 수 없는 상품입니다.';
  end if;

  delete from public.cart_items as cart_items
  where cart_items.product_id = p_product_id
    and cart_items.reserved_until <= v_now;

  select cart_items.*
  into v_reservation
  from public.cart_items as cart_items
  where cart_items.product_id = p_product_id
  for update;

  if found then
    if v_reservation.member_id <> v_user_id then
      raise exception using
        errcode = '23505',
        message = '다른 회원이 이 상품을 15분 동안 구매 준비 중입니다.';
    end if;

    -- Repeated clicks are idempotent and cannot extend an unexpired hold.
    return query select
      v_reservation.product_id,
      v_reservation.reserved_until,
      v_now;
    return;
  end if;

  insert into public.cart_items (
    member_id,
    product_id,
    created_at,
    reserved_until
  ) values (
    v_user_id,
    p_product_id,
    v_now,
    v_now + interval '15 minutes'
  )
  returning * into v_reservation;

  return query select
    v_reservation.product_id,
    v_reservation.reserved_until,
    v_now;
end;
$$;

revoke all on function public.reserve_fixed_product_for_cart(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.reserve_fixed_product_for_cart(uuid)
to authenticated;

create or replace function public.release_my_cart_reservation(
  p_product_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_deleted_count integer;
begin
  if p_product_id is null then
    raise exception using
      errcode = '22023',
      message = '장바구니에서 뺄 상품을 선택해 주세요.';
  end if;
  if v_user_id is null or not public.is_member() then
    raise exception using
      errcode = '42501',
      message = '카카오 회원 로그인 후 장바구니를 이용해 주세요.';
  end if;

  -- Match reserve/checkout lock ordering so release cannot interleave with a
  -- payment transaction that is already consuming this reservation.
  perform 1
  from public.products as products
  where products.id = p_product_id
  for update;

  delete from public.cart_items as cart_items
  where cart_items.product_id = p_product_id
    and cart_items.member_id = v_user_id;
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$$;

revoke all on function public.release_my_cart_reservation(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.release_my_cart_reservation(uuid)
to authenticated;

-- Both manual-transfer and PortOne checkout already insert order items while
-- holding product row locks. This trigger rejects a different member's live
-- hold and consumes the buyer's own hold in that same stock-locking transaction
-- without modifying either payment ledger RPC.
create or replace function app_private.consume_cart_reservation_for_order_item()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_sale_type text;
  v_now timestamptz;
  v_reservation public.cart_items%rowtype;
begin
  select orders.member_id
  into v_member_id
  from public.commerce_orders as orders
  where orders.id = new.order_id;

  if v_member_id is null then
    raise exception using
      errcode = '23503',
      message = '주문 회원 정보를 확인할 수 없습니다.';
  end if;

  select products.sale_type
  into v_sale_type
  from public.products as products
  where products.id = new.product_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '주문 상품을 찾을 수 없습니다.';
  end if;
  if v_sale_type <> 'fixed' then
    return new;
  end if;

  v_now := clock_timestamp();
  delete from public.cart_items as cart_items
  where cart_items.product_id = new.product_id
    and cart_items.reserved_until <= v_now;

  select cart_items.*
  into v_reservation
  from public.cart_items as cart_items
  where cart_items.product_id = new.product_id
  for update;

  if found and v_reservation.member_id <> v_member_id then
    raise exception using
      errcode = '23505',
      message = '다른 회원이 구매 준비 중인 상품이 포함되어 있습니다.';
  end if;

  if found then
    delete from public.cart_items as cart_items
    where cart_items.product_id = new.product_id
      and cart_items.member_id = v_member_id;
  end if;

  return new;
end;
$$;

revoke all on function app_private.consume_cart_reservation_for_order_item()
from public, anon, authenticated, service_role;

drop trigger if exists commerce_order_items_consume_cart_reservation
on public.commerce_order_items;
create trigger commerce_order_items_consume_cart_reservation
before insert on public.commerce_order_items
for each row
execute function app_private.consume_cart_reservation_for_order_item();

-- This legacy direct-claim path does not create a commerce order/payment
-- attempt and cannot participate in the cart-reservation transaction. Current
-- checkout uses create_commerce_order/prepare_commerce_portone_checkout, so
-- remove browser access to the bypass while retaining historical SQL objects.
revoke execute on function public.claim_fixed_price_product(uuid)
from anon, authenticated, service_role;

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
  v_processed := public.process_auction_purchase_offers(v_now);

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
  'Owner/operator store-scoped retry of the DB-clock, deadline-gated second-chance processor';
