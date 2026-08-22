begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Preserve the current fulfillment-unit fee calculator behind a private name.
-- The new wrapper uses its immutable fee snapshots, then removes only units
-- already covered by a member's available center entitlement for VAULT orders.
alter function app_private.apply_commerce_checkout_shipping_fee(uuid, boolean, boolean)
  rename to apply_commerce_checkout_shipping_fee_all_units;

create function app_private.apply_commerce_checkout_shipping_fee(
  p_order_id uuid,
  p_immediate_shipping boolean,
  p_allow_zero_fee_upgrade boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_result jsonb;
  v_shipping_fee bigint;
  v_covered_count integer := 0;
begin
  select * into v_order
  from public.commerce_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '배송비를 적용할 주문을 찾지 못했습니다.';
  end if;

  -- A replay must retain the original financial snapshot even if a token was
  -- consumed or granted after the order was created.
  if not p_allow_zero_fee_upgrade then
    return jsonb_build_object(
      'id', v_order.id,
      'status', v_order.status,
      'subtotal', v_order.subtotal,
      'shipping_fee', v_order.shipping_fee,
      'total', v_order.total,
      'shipping_credit_applied', v_order.shipping_credit_applied
    );
  end if;

  v_result := app_private.apply_commerce_checkout_shipping_fee_all_units(
    p_order_id,
    true,
    true
  );

  if not coalesce(p_immediate_shipping, false) then
    delete from public.commerce_order_shipping_fee_allocations as allocations
    where allocations.order_id = p_order_id
      and exists (
        select 1
        from public.shipping_fee_waiver_entitlements as entitlements
        where entitlements.member_id = v_order.member_id
          and entitlements.business_id = allocations.business_id
          and entitlements.status = 'available'
      );
    get diagnostics v_covered_count = row_count;

    select coalesce(sum(allocations.amount), 0)::bigint
    into v_shipping_fee
    from public.commerce_order_shipping_fee_allocations as allocations
    where allocations.order_id = p_order_id;

    update public.commerce_orders
    set
      shipping_fee = v_shipping_fee,
      total = subtotal + v_shipping_fee,
      shipping_credit_applied = v_covered_count > 0,
      updated_at = clock_timestamp()
    where id = p_order_id
    returning * into v_order;

    v_result := v_result || jsonb_build_object(
      'shipping_fee', v_order.shipping_fee,
      'total', v_order.total,
      'shipping_credit_applied', v_covered_count > 0
    );
  end if;

  return v_result;
end;
$$;

revoke all on function app_private.apply_commerce_checkout_shipping_fee(
  uuid, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function app_private.apply_commerce_checkout_shipping_fee_all_units(
  uuid, boolean, boolean
) from public, anon, authenticated, service_role;

-- A fee paid for later VAULT dispatch grants one consumable center token.
-- Immediate delivery already consumes the paid fee and must never leave a
-- second free shipment behind.
create or replace function app_private.project_prepaid_shipping_entitlements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('paid', 'shipped')
    and new.shipping_fee > 0
    and not new.direct_ship
  then
    insert into public.shipping_fee_waiver_entitlements (
      member_id, business_id, exception_case_id, commerce_order_id, prepaid_amount
    )
    select
      new.member_id, allocations.business_id, null, new.id, allocations.amount
    from public.commerce_order_shipping_fee_allocations as allocations
    where allocations.order_id = new.id
    on conflict (commerce_order_id, business_id)
      where commerce_order_id is not null
    do nothing;
  end if;
  return new;
end;
$$;

revoke all on function app_private.project_prepaid_shipping_entitlements()
from public, anon, authenticated, service_role;

-- Correct the two address overloads: the former implementation marked every
-- fixed-price purchase direct_ship=true merely because an address was saved.
create or replace function public.create_commerce_manual_transfer_checkout(
  p_product_ids uuid[], p_idempotency_key text, p_apply_shipping_credit boolean,
  p_include_shipping_fee boolean, p_shipping_address_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_checkout jsonb;
  v_order_id uuid;
  v_address public.shipping_addresses%rowtype;
  v_due timestamptz := clock_timestamp() + interval '6 hours';
begin
  select * into v_address from public.shipping_addresses
  where id = p_shipping_address_id and member_id = auth.uid();
  if not found then
    raise exception using errcode = 'P0002', message = '선택한 배송지를 찾을 수 없습니다.';
  end if;
  v_checkout := public.create_commerce_manual_transfer_checkout(
    p_product_ids, p_idempotency_key, p_apply_shipping_credit,
    p_include_shipping_fee
  );
  v_order_id := (v_checkout -> 'order' ->> 'id')::uuid;
  select coalesce(payment_due_at, v_due) into v_due
  from public.commerce_orders
  where id = v_order_id and member_id = auth.uid()
  for update;
  update public.commerce_orders set
    shipping_address_id = v_address.id,
    shipping_address_snapshot = jsonb_build_object(
      'label', v_address.label, 'recipientName', v_address.recipient_name,
      'phone', v_address.phone, 'postalCode', v_address.postal_code,
      'address', v_address.address
    ),
    direct_ship = coalesce(p_include_shipping_fee, false),
    payment_due_at = v_due,
    updated_at = clock_timestamp()
  where id = v_order_id and member_id = auth.uid();
  update public.commerce_order_transfers
  set payment_due_at = v_due where order_id = v_order_id;
  v_checkout := jsonb_set(v_checkout, '{transfer,payment_due_at}', to_jsonb(v_due), true);
  v_checkout := jsonb_set(v_checkout, '{order,payment_due_at}', to_jsonb(v_due), true);
  return jsonb_set(
    v_checkout, '{order,direct_ship}', to_jsonb(coalesce(p_include_shipping_fee, false)), true
  );
end;
$$;

revoke all on function public.create_commerce_manual_transfer_checkout(
  uuid[], text, boolean, boolean, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_commerce_manual_transfer_checkout(
  uuid[], text, boolean, boolean, uuid
) to authenticated;

create or replace function public.create_commerce_manual_transfer_checkout(
  p_product_ids uuid[], p_idempotency_key text, p_apply_shipping_credit boolean,
  p_include_shipping_fee boolean, p_shipping_region text, p_shipping_address_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_checkout jsonb;
  v_order_id uuid;
  v_address public.shipping_addresses%rowtype;
  v_due timestamptz := clock_timestamp() + interval '6 hours';
begin
  if p_shipping_region not in ('regular', 'remote_area') then
    raise exception using errcode = '22023', message = '배송 지역 구분을 확인해 주세요.';
  end if;
  select * into v_address from public.shipping_addresses
  where id = p_shipping_address_id and member_id = auth.uid();
  if not found then
    raise exception using errcode = 'P0002', message = '선택한 배송지를 찾을 수 없습니다.';
  end if;
  v_checkout := public.create_commerce_manual_transfer_checkout(
    p_product_ids, p_idempotency_key, p_apply_shipping_credit,
    p_include_shipping_fee, p_shipping_region
  );
  v_order_id := (v_checkout -> 'order' ->> 'id')::uuid;
  select coalesce(payment_due_at, v_due) into v_due
  from public.commerce_orders
  where id = v_order_id and member_id = auth.uid()
  for update;
  update public.commerce_orders set
    shipping_address_id = v_address.id,
    shipping_address_snapshot = jsonb_build_object(
      'label', v_address.label, 'recipientName', v_address.recipient_name,
      'phone', v_address.phone, 'postalCode', v_address.postal_code,
      'address', v_address.address
    ),
    direct_ship = coalesce(p_include_shipping_fee, false),
    payment_due_at = v_due,
    updated_at = clock_timestamp()
  where id = v_order_id and member_id = auth.uid();
  update public.commerce_order_transfers
  set payment_due_at = v_due where order_id = v_order_id;
  v_checkout := jsonb_set(v_checkout, '{transfer,payment_due_at}', to_jsonb(v_due), true);
  v_checkout := jsonb_set(v_checkout, '{order,payment_due_at}', to_jsonb(v_due), true);
  return jsonb_set(
    v_checkout, '{order,direct_ship}', to_jsonb(coalesce(p_include_shipping_fee, false)), true
  );
end;
$$;

revoke all on function public.create_commerce_manual_transfer_checkout(
  uuid[], text, boolean, boolean, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_commerce_manual_transfer_checkout(
  uuid[], text, boolean, boolean, text, uuid
) to authenticated;

-- Replace the obsolete "stored item exists" waiver predicate in both auction
-- quote and begin RPCs with the same available per-center entitlement source
-- used by fixed-price checkout and the shipment command.
do $$
declare
  v_signature regprocedure;
  v_definition text;
  v_rewritten text;
  v_old_pattern text := $pattern$\(\s*select count\(\*\)::integer\s*from public\.customer_inventory_items as inventory\s*join public\.inventory_item_fulfillments as fulfillments\s*on fulfillments\.inventory_item_id = inventory\.id\s*where inventory\.member_id = v_actor\s*and inventory\.business_id = stores\.business_id\s*and inventory\.ownership_status = 'active'\s*and not fulfillments\.is_blocked\s*and fulfillments\.current_stage in \([^\)]*\)\s*\) > 0$pattern$;
  v_new_expression text := $replacement$exists (
          select 1
          from public.shipping_fee_waiver_entitlements as entitlements
          where entitlements.member_id = v_actor
            and entitlements.business_id = stores.business_id
            and entitlements.status = 'available'
        )$replacement$;
begin
  foreach v_signature in array array[
    'public.get_my_auction_payment_quote()'::regprocedure,
    'public.begin_my_combined_auction_payment(text,boolean,uuid[])'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_signature);
    v_rewritten := regexp_replace(
      v_definition, v_old_pattern, v_new_expression, 'gni'
    );
    if v_rewritten = v_definition then
      raise exception 'Expected stored-item shipping predicate was not found in %', v_signature;
    end if;
    execute v_rewritten;
  end loop;
end;
$$;

comment on function app_private.apply_commerce_checkout_shipping_fee(uuid, boolean, boolean)
is 'Unified shipping fee engine: immediate delivery always pays; vault delivery uses an available per-center entitlement or prepays one future dispatch.';

commit;
