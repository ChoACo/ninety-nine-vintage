-- Cart items are a saved fixed-price purchase list, not inventory holds.
-- Keep the old RPC names for a backwards-compatible client transition while
-- making every reservation timestamp nullable and non-authoritative.

alter table public.cart_items
  alter column reserved_until drop default,
  alter column reserved_until drop not null;

alter table public.cart_items
  drop constraint if exists cart_items_reservation_window_check;

drop index if exists public.cart_items_product_reservation_key;
drop index if exists public.cart_items_member_reservation_idx;

drop policy if exists "Members read their cart reservations" on public.cart_items;
drop policy if exists "Members manage their cart" on public.cart_items;
create policy "Members manage their cart"
on public.cart_items
for all to authenticated
using (member_id = (select auth.uid()))
with check (member_id = (select auth.uid()));

revoke all on table public.cart_items from anon, authenticated;
grant select, insert, update, delete on table public.cart_items to authenticated;

create or replace function public.get_my_cart_reservations()
returns table (product_id uuid, created_at timestamptz, reserved_until timestamptz, server_time timestamptz)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인 후 장바구니를 이용해 주세요.';
  end if;
  return query
    select c.product_id, c.created_at, c.reserved_until, clock_timestamp()
    from public.cart_items c
    where c.member_id = (select auth.uid())
    order by c.created_at desc, c.product_id;
end;
$$;
revoke all on function public.get_my_cart_reservations() from public, anon, authenticated, service_role;
grant execute on function public.get_my_cart_reservations() to authenticated;

create or replace function public.reserve_fixed_product_for_cart(p_product_id uuid)
returns table (product_id uuid, reserved_until timestamptz, server_time timestamptz)
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인 후 장바구니를 이용해 주세요.';
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.sale_type = 'fixed'
      and p.status = 'active' and p.publish_at <= v_now
  ) then
    raise exception using errcode = 'P0001', message = '현재 구매할 수 없는 상품입니다.';
  end if;
  insert into public.cart_items(member_id, product_id, created_at, reserved_until)
  values (v_user_id, p_product_id, v_now, null)
  on conflict (member_id, product_id) do nothing;
  return query select p_product_id, null::timestamptz, v_now;
end;
$$;
revoke all on function public.reserve_fixed_product_for_cart(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reserve_fixed_product_for_cart(uuid) to authenticated;

create or replace function public.release_my_cart_reservation(p_product_id uuid)
returns boolean
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_deleted boolean;
  v_count integer;
begin
  delete from public.cart_items
  where member_id = (select auth.uid()) and product_id = p_product_id;
  get diagnostics v_count = row_count;
  v_deleted := v_count > 0;
  return v_deleted;
end;
$$;
revoke all on function public.release_my_cart_reservation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_my_cart_reservation(uuid) to authenticated;

-- A cart row never blocks another buyer. Checkout consumes only the current
-- buyer's saved row after the product/order locks have been acquired.
create or replace function app_private.consume_cart_reservation_for_order_item()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare v_member_id uuid; v_sale_type text;
begin
  select o.member_id into v_member_id from public.commerce_orders o where o.id = new.order_id;
  if v_member_id is null then
    raise exception using errcode = '23503', message = '주문 회원 정보를 확인할 수 없습니다.';
  end if;
  select p.sale_type into v_sale_type from public.products p where p.id = new.product_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = '주문 상품을 찾을 수 없습니다.';
  end if;
  if v_sale_type = 'fixed' then
    delete from public.cart_items where product_id = new.product_id and member_id = v_member_id;
  end if;
  return new;
end;
$$;
revoke all on function app_private.consume_cart_reservation_for_order_item() from public, anon, authenticated, service_role;

drop function if exists public.purge_expired_cart_reservations(timestamptz);
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'purge-expired-cart-reservations' limit 1;
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
end;
$$;
