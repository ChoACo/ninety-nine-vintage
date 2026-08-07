-- Phase 1: 장바구니 싹쓸이 방지 + 만료 점유 lazy 정리 방지용 스케줄러.
--
-- 1) reserve_fixed_product_for_cart 에 회원당 활성 점유 상한(3개)을 추가한다.
--    점유 상한 검사는 회원당 보유 중(reserved_until > clock_timestamp())인
--    점유 행을 집계하고, 이미 3개 이상 보유하면 새 점유를 거부한다.
-- 2) cart_items 의 만료 행을 1분마다 삭제하는 pg_cron 스케줄을 등록한다.

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
  v_active_hold_count integer;
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

  -- 싹쓸이 방지: 회원당 동시 활성 점유는 최대 3개까지만 허용한다.
  -- 만료된 점유는 집계에서 제외하므로 정상 해제 후 재점유는 가능하다.
  select count(*)
  into v_active_hold_count
  from public.cart_items as cart_items
  where cart_items.member_id = v_user_id
    and cart_items.reserved_until > clock_timestamp();

  if v_active_hold_count >= 3 then
    raise exception using
      errcode = 'P0001',
      message = '한 번에 최대 3개의 상품만 점유할 수 있습니다.';
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

-- 만료 점유 1분 주기 정리.
-- 이전에는 만료 행이 누군가 같은 상품을 다시 건드릴 때만 물리 삭제되어
-- 유니크 인덱스(product_id) 슬롯을 계속 점유하는 dead-row가 누적됐다.
create or replace function public.purge_expired_cart_reservations(
  p_at timestamptz default clock_timestamp()
)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.cart_items as cart_items
    where cart_items.reserved_until <= p_at
    returning 1
  )
  select count(*) from deleted;
$$;

revoke all on function public.purge_expired_cart_reservations(timestamptz)
from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  select jobs.jobid
  into v_job_id
  from cron.job as jobs
  where jobs.jobname = 'purge-expired-cart-reservations'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'purge-expired-cart-reservations',
    '* * * * *',
    $job$select public.purge_expired_cart_reservations(clock_timestamp());$job$
  );
end;
$$;
