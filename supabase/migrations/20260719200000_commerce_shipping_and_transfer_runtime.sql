-- Complete the fixed-price purchase journey: paid fixed-price items must be
-- eligible for combined shipping just like auction wins.

create or replace function public.request_product_shipping(
  p_product_ids uuid[],
  p_address_id uuid,
  p_apply_shipping_credit boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_credit_count integer;
  v_address public.shipping_addresses%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_valid_count integer;
  v_distinct_count integer;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;
  if p_product_ids is null or cardinality(p_product_ids) < 1 or cardinality(p_product_ids) > 100 then
    raise exception using errcode = '22023', message = '택배 접수할 상품을 선택해 주세요.';
  end if;

  select count(distinct product_id)
  into v_distinct_count
  from unnest(p_product_ids) as selected(product_id);
  if v_distinct_count <> cardinality(p_product_ids) then
    raise exception using errcode = '22023', message = '중복된 상품 선택이 있습니다.';
  end if;

  if coalesce(p_apply_shipping_credit, false) then
    select accounts.shipping_credit_count
    into v_credit_count
    from public.member_accounts as accounts
    where accounts.member_id = v_user_id and accounts.account_status = 'active'
    for update;
    if v_credit_count is null or v_credit_count < 1 then
      raise exception using errcode = 'P0001', message = '택배 가능 횟수가 부족합니다.';
    end if;
  end if;

  select addresses.*
  into v_address
  from public.shipping_addresses as addresses
  where addresses.id = p_address_id and addresses.member_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = '선택한 배송지를 찾을 수 없습니다.';
  end if;

  perform products.id
  from public.products as products
  where products.id = any(p_product_ids)
  order by products.id
  for update;

  select count(*)
  into v_valid_count
  from public.products as products
  where products.id = any(p_product_ids)
    and products.status = 'closed'
    and not exists (
      select 1 from public.shipping_request_items as existing_items
      where existing_items.product_id = products.id
    )
    and (
      exists (
        select 1
        from public.commerce_order_items as commerce_items
        join public.commerce_orders as commerce_orders on commerce_orders.id = commerce_items.order_id
        where commerce_items.product_id = products.id
          and commerce_orders.member_id = v_user_id
          and commerce_items.payment_status = 'paid'
          and commerce_items.storage_expires_at > clock_timestamp()
      )
      or exists (
        select 1
        from public.auction_bids as bids
        where bids.product_id = products.id
          and bids.bidder_id = v_user_id
          and bids.id = (
            select winning.id
            from public.auction_bids as winning
            where winning.product_id = products.id
            order by winning.amount desc, winning.created_at desc, winning.id desc
            limit 1
          )
          and public.is_product_payment_settled(products.id, v_user_id)
      )
    );

  if v_valid_count <> cardinality(p_product_ids) then
    raise exception using errcode = '42501', message = '결제가 완료되지 않았거나 접수할 수 없는 상품이 포함되어 있습니다.';
  end if;

  insert into public.shipping_requests (id, member_id, address_id, address_snapshot)
  values (
    v_request_id,
    v_user_id,
    v_address.id,
    jsonb_build_object(
      'label', v_address.label,
      'recipientName', v_address.recipient_name,
      'phone', v_address.phone,
      'postalCode', v_address.postal_code,
      'address', v_address.address
    )
  );

  insert into public.shipping_request_items (request_id, product_id)
  select v_request_id, selected.product_id
  from unnest(p_product_ids) as selected(product_id);

  if coalesce(p_apply_shipping_credit, false) then
    update public.member_accounts
    set shipping_credit_count = shipping_credit_count - 1
    where member_id = v_user_id;
    insert into public.shipping_credit_ledger (member_id, delta, reason, shipping_request_id, created_by)
    values (v_user_id, -1, 'used', v_request_id, v_user_id);
  end if;

  return v_request_id;
end;
$$;

revoke all on function public.request_product_shipping(uuid[], uuid, boolean)
from public, anon, authenticated;
grant execute on function public.request_product_shipping(uuid[], uuid, boolean)
to authenticated;

-- Preserve the two-argument contract used by older clients.
create or replace function public.request_product_shipping(
  p_product_ids uuid[],
  p_address_id uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$ select public.request_product_shipping($1, $2, true); $$;

revoke all on function public.request_product_shipping(uuid[], uuid)
from public, anon, authenticated;
grant execute on function public.request_product_shipping(uuid[], uuid)
to authenticated;

-- Checkout is the single source of truth for the stock lock. Remove the
-- server-side cart rows after the order succeeds so stale carts cannot be
-- replayed by another tab.
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
  if coalesce(array_length(p_product_ids, 1), 0) = 0 or array_length(p_product_ids, 1) > 50 then
    raise exception using errcode = '22023', message = '상품 목록이 올바르지 않습니다.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null or char_length(p_idempotency_key) > 128 then
    raise exception using errcode = '22023', message = '주문 요청 키가 올바르지 않습니다.';
  end if;

  select jsonb_build_object(
    'id', orders.id, 'status', orders.status, 'subtotal', orders.subtotal,
    'shipping_fee', orders.shipping_fee, 'total', orders.total,
    'shipping_credit_applied', orders.shipping_credit_applied
  ) into v_result
  from public.commerce_orders as orders
  where orders.member_id = v_user_id and orders.idempotency_key = btrim(p_idempotency_key);
  if v_result is not null then return v_result; end if;

  select count(*) into v_requested_count
  from (select distinct unnest(p_product_ids) as id) as ids;
  if v_requested_count <> array_length(p_product_ids, 1) then
    raise exception using errcode = '22023', message = '상품 목록에 중복이 있습니다.';
  end if;

  for v_product in
    select products.* from public.products as products
    where products.id = any(p_product_ids)
    order by products.id
    for update
  loop
    v_locked_count := v_locked_count + 1;
    if v_product.sale_type <> 'fixed' or v_product.fixed_price is null
      or v_product.status <> 'active' or v_product.publish_at > clock_timestamp() then
      raise exception using errcode = '23505', message = '구매할 수 없는 상품이 포함되어 있습니다.';
    end if;
    v_subtotal := v_subtotal + v_product.fixed_price;
  end loop;
  if v_locked_count <> v_requested_count then
    raise exception using errcode = 'P0002', message = '상품을 찾을 수 없습니다.';
  end if;

  insert into public.commerce_orders (
    member_id, status, subtotal, shipping_fee, total, shipping_credit_applied, idempotency_key
  ) values (v_user_id, 'awaiting_payment', v_subtotal, 0, v_subtotal, false, btrim(p_idempotency_key))
  returning id into v_order_id;

  insert into public.commerce_order_items (order_id, product_id, store_id, unit_price, payment_status)
  select v_order_id, products.id, products.store_id, products.fixed_price, 'awaiting_payment'
  from public.products as products where products.id = any(p_product_ids);

  update public.products set status = 'closed', updated_at = clock_timestamp()
  where id = any(p_product_ids);
  delete from public.cart_items where member_id = v_user_id and product_id = any(p_product_ids);

  return jsonb_build_object(
    'id', v_order_id, 'status', 'awaiting_payment', 'subtotal', v_subtotal,
    'shipping_fee', 0, 'total', v_subtotal, 'shipping_credit_applied', false
  );
end;
$$;

revoke all on function public.create_commerce_order(uuid[], text, boolean)
from public, anon, authenticated;
grant execute on function public.create_commerce_order(uuid[], text, boolean)
to authenticated;
