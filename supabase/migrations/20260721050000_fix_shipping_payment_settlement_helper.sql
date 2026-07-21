-- Restore the private payment-settlement helper after the idempotent shipping
-- request migration accidentally referenced a public helper that does not exist.

create or replace function public.request_product_shipping(
  p_product_ids uuid[],
  p_address_id uuid,
  p_apply_shipping_credit boolean,
  p_idempotency_key text
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
  v_existing_request uuid;
  v_valid_count integer;
  v_distinct_count integer;
  v_key text := nullif(btrim(p_idempotency_key), '');
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;
  if v_key is not null and char_length(v_key) > 128 then
    raise exception using errcode = '22023', message = '배송 요청 키가 올바르지 않습니다.';
  end if;
  if v_key is not null then
    -- Serialize identical member/key requests before their first lookup. A
    -- concurrent retry waits for the creating transaction to commit, then
    -- observes and returns the same shipping request instead of reaching the
    -- product-already-requested validation path.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_user_id::text || ':' || v_key, 0)
    );
    select requests.id into v_existing_request
    from public.shipping_requests as requests
    where requests.member_id = v_user_id and requests.idempotency_key = v_key;
    if v_existing_request is not null then return v_existing_request; end if;
  end if;
  if p_product_ids is null or cardinality(p_product_ids) < 1 or cardinality(p_product_ids) > 100 then
    raise exception using errcode = '22023', message = '택배 접수할 상품을 선택해 주세요.';
  end if;

  select count(distinct product_id) into v_distinct_count
  from unnest(p_product_ids) as selected(product_id);
  if v_distinct_count <> cardinality(p_product_ids) then
    raise exception using errcode = '22023', message = '중복된 상품 선택이 있습니다.';
  end if;

  if coalesce(p_apply_shipping_credit, false) then
    select accounts.shipping_credit_count into v_credit_count
    from public.member_accounts as accounts
    where accounts.member_id = v_user_id and accounts.account_status = 'active'
    for update;
    if v_credit_count is null or v_credit_count < 1 then
      raise exception using errcode = 'P0001', message = '택배 가능 횟수가 부족합니다.';
    end if;
  end if;

  select addresses.* into v_address
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

  select count(*) into v_valid_count
  from public.products as products
  where products.id = any(p_product_ids)
    and products.status = 'closed'
    and not exists (
      select 1 from public.shipping_request_items as existing_items
      where existing_items.product_id = products.id
    )
    and (
      exists (
        select 1 from public.commerce_order_items as commerce_items
        join public.commerce_orders as commerce_orders on commerce_orders.id = commerce_items.order_id
        where commerce_items.product_id = products.id
          and commerce_orders.member_id = v_user_id
          and commerce_items.payment_status = 'paid'
          and commerce_items.storage_expires_at > clock_timestamp()
      )
      or exists (
        select 1 from public.auction_bids as bids
        where bids.product_id = products.id
          and bids.bidder_id = v_user_id
          and bids.id = (
            select winning.id
            from public.auction_bids as winning
            where winning.product_id = products.id
            order by winning.amount desc, winning.created_at desc, winning.id desc
            limit 1
          )
          and app_private.is_product_payment_settled(products.id, v_user_id)
      )
    );

  if v_valid_count <> cardinality(p_product_ids) then
    raise exception using errcode = '42501', message = '결제가 완료되지 않았거나 접수할 수 없는 상품이 포함되어 있습니다.';
  end if;

  begin
    insert into public.shipping_requests (id, member_id, address_id, address_snapshot, idempotency_key)
    values (
      v_request_id, v_user_id, v_address.id,
      jsonb_build_object(
        'label', v_address.label,
        'recipientName', v_address.recipient_name,
        'phone', v_address.phone,
        'postalCode', v_address.postal_code,
        'address', v_address.address
      ),
      v_key
    );
  exception when unique_violation then
    if v_key is not null then
      select requests.id into v_existing_request
      from public.shipping_requests as requests
      where requests.member_id = v_user_id and requests.idempotency_key = v_key;
      if v_existing_request is not null then return v_existing_request; end if;
    end if;
    raise;
  end;

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

revoke all on function public.request_product_shipping(uuid[], uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.request_product_shipping(uuid[], uuid, boolean, text)
to authenticated;

create or replace function public.request_product_shipping(
  p_product_ids uuid[],
  p_address_id uuid,
  p_apply_shipping_credit boolean default true
)
returns uuid
language sql
security definer
set search_path = ''
as $$ select public.request_product_shipping($1, $2, $3, null); $$;

revoke all on function public.request_product_shipping(uuid[], uuid, boolean)
from public, anon, authenticated;
grant execute on function public.request_product_shipping(uuid[], uuid, boolean)
to authenticated;

create or replace function public.request_product_shipping(
  p_product_ids uuid[],
  p_address_id uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$ select public.request_product_shipping($1, $2, true, null); $$;

revoke all on function public.request_product_shipping(uuid[], uuid)
from public, anon, authenticated;
grant execute on function public.request_product_shipping(uuid[], uuid)
to authenticated;
