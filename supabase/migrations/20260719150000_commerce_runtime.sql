-- Runtime primitives for fixed-price multi-store checkout.
-- The function is the transaction boundary: every product row is locked before
-- the order is created, so two members cannot claim the same item.

create table if not exists public.commerce_order_transfers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.commerce_orders (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete restrict,
  expected_amount bigint not null check (expected_amount > 0),
  bank_name_snapshot text not null,
  account_number_snapshot text not null,
  status text not null default 'awaiting_transfer' check (status in ('awaiting_transfer', 'confirmed', 'cancelled')),
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null
);

alter table public.commerce_order_transfers enable row level security;
drop policy if exists "Members read commerce order transfers" on public.commerce_order_transfers;
create policy "Members read commerce order transfers"
  on public.commerce_order_transfers for select to authenticated
  using (member_id = auth.uid() or public.is_staff());

create or replace function public.create_commerce_order(
  p_product_ids uuid[],
  p_idempotency_key text,
  p_apply_shipping_credit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_product public.products%rowtype;
  v_requested_count integer;
  v_locked_count integer := 0;
  v_subtotal bigint := 0;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if coalesce(array_length(p_product_ids, 1), 0) = 0
    or array_length(p_product_ids, 1) > 50
  then
    raise exception using errcode = '22023', message = '상품 목록이 올바르지 않습니다.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null or char_length(p_idempotency_key) > 128 then
    raise exception using errcode = '22023', message = '주문 요청 키가 올바르지 않습니다.';
  end if;

  select jsonb_build_object(
    'id', orders.id,
    'status', orders.status,
    'subtotal', orders.subtotal,
    'shipping_fee', orders.shipping_fee,
    'total', orders.total,
    'shipping_credit_applied', orders.shipping_credit_applied
  )
  into v_result
  from public.commerce_orders orders
  where orders.member_id = v_user_id
    and orders.idempotency_key = btrim(p_idempotency_key);
  if v_result is not null then return v_result; end if;

  select count(*) into v_requested_count from (select distinct unnest(p_product_ids) as id) ids;
  if v_requested_count <> array_length(p_product_ids, 1) then
    raise exception using errcode = '22023', message = '상품 목록에 중복이 있습니다.';
  end if;
  for v_product in
    select products.*
    from public.products products
    where products.id = any(p_product_ids)
    order by products.id
    for update
  loop
    v_locked_count := v_locked_count + 1;
    if v_product.sale_type <> 'fixed'
      or v_product.fixed_price is null
      or v_product.status <> 'active'
      or v_product.publish_at > clock_timestamp()
    then
      raise exception using errcode = '23505', message = '구매할 수 없는 상품이 포함되어 있습니다.';
    end if;
    v_subtotal := v_subtotal + v_product.fixed_price;
  end loop;

  if v_locked_count <> v_requested_count then
    raise exception using errcode = 'P0002', message = '상품을 찾을 수 없습니다.';
  end if;

  insert into public.commerce_orders (
    member_id, status, subtotal, shipping_fee, total,
    shipping_credit_applied, idempotency_key
  ) values (
    v_user_id, 'awaiting_payment', v_subtotal, 0, v_subtotal,
    false, btrim(p_idempotency_key)
  ) returning id into v_order_id;

  insert into public.commerce_order_items (
    order_id, product_id, store_id, unit_price, payment_status
  )
  select v_order_id, products.id, products.store_id, products.fixed_price, 'awaiting_payment'
  from public.products products
  where products.id = any(p_product_ids);

  update public.products
  set status = 'closed', updated_at = clock_timestamp()
  where id = any(p_product_ids);

  return jsonb_build_object(
    'id', v_order_id,
    'status', 'awaiting_payment',
    'subtotal', v_subtotal,
    'shipping_fee', 0,
    'total', v_subtotal,
    'shipping_credit_applied', false
  );
end;
$$;

revoke all on function public.create_commerce_order(uuid[], text, boolean) from public, anon, authenticated;
grant execute on function public.create_commerce_order(uuid[], text, boolean) to authenticated;

create or replace function public.confirm_commerce_order_transfer(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_transfer public.commerce_order_transfers%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;

  select * into v_order from public.commerce_orders where id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = '주문을 찾을 수 없습니다.'; end if;
  select * into v_transfer from public.commerce_order_transfers where order_id = p_order_id for update;
  if not found or v_transfer.status = 'cancelled' then
    raise exception using errcode = '22023', message = '입금 대기 내역을 찾을 수 없습니다.';
  end if;
  if v_transfer.status = 'confirmed' then return true; end if;

  update public.commerce_order_transfers
  set status = 'confirmed', confirmed_at = v_now, confirmed_by = auth.uid()
  where id = v_transfer.id;
  update public.commerce_order_items items
  set payment_status = 'paid', paid_at = v_now,
      storage_expires_at = v_now + case
        when products.storage_class = 'large' then interval '7 days'
        else interval '14 days'
      end
  from public.products products
  where items.order_id = p_order_id and products.id = items.product_id;
  update public.commerce_orders
  set status = 'paid', updated_at = v_now
  where id = p_order_id;
  insert into public.notifications (member_id, audience_role, kind, title, body, href)
  values (v_order.member_id, 'member', 'payment_confirmed', '입금이 확인되었습니다.', '주문 상품이 보관 목록에 추가되었습니다.', '/account#storage');
  return true;
end;
$$;

revoke all on function public.confirm_commerce_order_transfer(uuid) from public, anon, authenticated;
grant execute on function public.confirm_commerce_order_transfer(uuid) to authenticated;
