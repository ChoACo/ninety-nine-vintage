begin;

set local lock_timeout = '10s';

alter table public.commerce_order_shipping_fee_allocations
  add column unit_kind text,
  add column unit_name text,
  add column billing_store_name text,
  add column included_store_ids uuid[],
  add column included_product_ids uuid[],
  add column product_subtotal bigint;

create or replace function app_private.populate_commerce_shipping_unit_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_ids uuid[];
  v_product_ids uuid[];
  v_product_subtotal bigint;
  v_unit_name text;
  v_billing_store_name text;
begin
  if new.charge_mode = 'per_group' then
    select
      array_agg(distinct items.store_id order by items.store_id),
      array_agg(items.product_id order by items.product_id),
      sum(items.unit_price)::bigint,
      groups.name
    into v_store_ids, v_product_ids, v_product_subtotal, v_unit_name
    from public.commerce_order_items as items
    join public.store_fulfillment_group_members as members
      on members.store_id = items.store_id
     and members.group_id = new.fulfillment_group_id
    join public.store_fulfillment_groups as groups
      on groups.id = members.group_id
    where items.order_id = new.order_id
    group by groups.name;
    new.unit_kind := 'fulfillment_group';
  else
    select
      array_agg(distinct items.store_id order by items.store_id),
      array_agg(items.product_id order by items.product_id),
      sum(items.unit_price)::bigint,
      stores.name
    into v_store_ids, v_product_ids, v_product_subtotal, v_unit_name
    from public.commerce_order_items as items
    join public.stores on stores.id = items.store_id
    where items.order_id = new.order_id
      and items.store_id = new.origin_store_id
    group by stores.name;
    new.unit_kind := 'store';
  end if;

  select stores.name into v_billing_store_name
  from public.stores
  where stores.id = new.billing_store_id;

  if coalesce(array_length(v_store_ids, 1), 0) < 1
    or coalesce(array_length(v_product_ids, 1), 0) < 1
    or coalesce(v_product_subtotal, 0) < 1
    or nullif(btrim(v_unit_name), '') is null
    or nullif(btrim(v_billing_store_name), '') is null
  then
    raise exception using
      errcode = '23514',
      message = '주문 배송 단위 스냅샷을 생성할 수 없습니다.';
  end if;

  new.unit_name := v_unit_name;
  new.billing_store_name := v_billing_store_name;
  new.included_store_ids := v_store_ids;
  new.included_product_ids := v_product_ids;
  new.product_subtotal := v_product_subtotal;
  new.policy_snapshot := new.policy_snapshot || jsonb_build_object(
    'unitKind', new.unit_kind,
    'unitName', new.unit_name,
    'billingStoreId', new.billing_store_id,
    'billingStoreName', new.billing_store_name,
    'includedStoreIds', to_jsonb(new.included_store_ids),
    'includedProductIds', to_jsonb(new.included_product_ids),
    'productSubtotal', new.product_subtotal,
    'shippingFee', new.amount
  );
  return new;
end;
$$;

revoke all on function app_private.populate_commerce_shipping_unit_snapshot()
from public, anon, authenticated, service_role;

create trigger commerce_shipping_allocation_populate_snapshot
before insert or update on public.commerce_order_shipping_fee_allocations
for each row execute function app_private.populate_commerce_shipping_unit_snapshot();

update public.commerce_order_shipping_fee_allocations
set charge_mode = charge_mode;

drop trigger commerce_shipping_allocation_populate_snapshot
on public.commerce_order_shipping_fee_allocations;
create trigger commerce_shipping_allocation_populate_snapshot
before insert on public.commerce_order_shipping_fee_allocations
for each row execute function app_private.populate_commerce_shipping_unit_snapshot();

alter table public.commerce_order_shipping_fee_allocations
  alter column unit_kind set not null,
  alter column unit_name set not null,
  alter column billing_store_name set not null,
  alter column included_store_ids set not null,
  alter column included_product_ids set not null,
  alter column product_subtotal set not null,
  add constraint commerce_shipping_allocation_unit_kind_check
    check (unit_kind in ('store', 'fulfillment_group')),
  add constraint commerce_shipping_allocation_unit_shape_check
    check (
      cardinality(included_store_ids) > 0
      and cardinality(included_product_ids) > 0
      and product_subtotal > 0
      and (
        (unit_kind = 'store' and charge_mode = 'per_store'
          and origin_store_id is not null and fulfillment_group_id is null)
        or
        (unit_kind = 'fulfillment_group' and charge_mode = 'per_group'
          and origin_store_id is null and fulfillment_group_id is not null)
      )
    );

create or replace function app_private.guard_commerce_shipping_allocation_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = '주문 배송 단위 스냅샷은 변경할 수 없습니다.';
end;
$$;

revoke all on function app_private.guard_commerce_shipping_allocation_immutable()
from public, anon, authenticated, service_role;

create trigger commerce_shipping_allocation_immutable
before update or delete on public.commerce_order_shipping_fee_allocations
for each row execute function app_private.guard_commerce_shipping_allocation_immutable();

create or replace function public.quote_commerce_shipping_fee(p_product_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_requested_count integer;
  v_valid_count integer;
  v_product_total bigint;
  v_shipping_total bigint;
  v_charges jsonb;
  v_missing_setting boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  v_requested_count := coalesce(array_length(p_product_ids, 1), 0);
  if v_requested_count = 0 or v_requested_count > 50
    or v_requested_count <> (select count(distinct value) from unnest(p_product_ids) as value)
  then
    raise exception using errcode = '22023', message = '배송비 견적 상품을 확인해 주세요.';
  end if;

  select count(*)::integer, sum(products.current_price)::bigint
  into v_valid_count, v_product_total
  from public.products
  where products.id = any(p_product_ids)
    and products.sale_type = 'fixed'
    and products.status = 'active'
    and products.publish_at <= clock_timestamp()
    and public.can_purchase_product(products.id);
  if v_valid_count <> v_requested_count then
    raise exception using errcode = '42501', message = '구매할 수 없는 센터 상품이 포함되어 있습니다.';
  end if;

  with product_scopes as (
    select products.id product_id, products.title, products.current_price,
      stores.id store_id, stores.name store_name,
      groups.id group_id, groups.name group_name, groups.shipping_charge_mode,
      groups.group_shipping_fee_amount, groups.representative_store_id,
      settings.shipping_fee_amount
    from public.products
    join public.stores on stores.id = products.store_id
    left join public.store_fulfillment_group_members members on members.store_id = stores.id
    left join public.store_fulfillment_groups groups on groups.id = members.group_id and groups.is_active
    left join public.inventory_fulfillment_rollout_settings settings on settings.business_id = stores.business_id
    where products.id = any(p_product_ids)
  ), charges as (
    select
      case when shipping_charge_mode = 'per_group' then 'group:' || group_id::text else 'store:' || store_id::text end charge_key,
      case when shipping_charge_mode = 'per_group' then 'per_group' else 'per_store' end mode,
      case when shipping_charge_mode = 'per_group' then group_id else null end group_id,
      case when shipping_charge_mode = 'per_group' then max(group_name) else max(store_name) end unit_name,
      case when shipping_charge_mode = 'per_group' then representative_store_id else store_id end billing_store_id,
      case when shipping_charge_mode = 'per_group' then max(group_shipping_fee_amount) else max(shipping_fee_amount) end amount,
      sum(current_price)::bigint product_subtotal,
      jsonb_agg(distinct store_id order by store_id) store_ids,
      jsonb_agg(distinct store_name order by store_name) store_names,
      jsonb_agg(product_id order by product_id) product_ids,
      jsonb_agg(jsonb_build_object('id', product_id, 'title', title, 'amount', current_price) order by product_id) products
    from product_scopes
    group by
      case when shipping_charge_mode = 'per_group' then 'group:' || group_id::text else 'store:' || store_id::text end,
      case when shipping_charge_mode = 'per_group' then 'per_group' else 'per_store' end,
      case when shipping_charge_mode = 'per_group' then group_id else null end,
      case when shipping_charge_mode = 'per_group' then representative_store_id else store_id end,
      group_id, representative_store_id, shipping_charge_mode,
      case when shipping_charge_mode = 'per_group' then null else store_id end
  )
  select coalesce(sum(amount), 0), coalesce(bool_or(amount is null), true),
    coalesce(jsonb_agg(jsonb_build_object(
      'chargeKey', charge_key, 'mode', mode, 'unitKind', case when mode = 'per_group' then 'fulfillment_group' else 'store' end,
      'groupId', group_id, 'groupName', case when mode = 'per_group' then unit_name else null end,
      'unitName', unit_name, 'billingStoreId', billing_store_id,
      'billingStoreName', (select name from public.stores where id = billing_store_id),
      'amount', amount, 'productSubtotal', product_subtotal,
      'storeIds', store_ids, 'storeNames', store_names, 'productIds', product_ids, 'products', products
    ) order by charge_key), '[]'::jsonb)
  into v_shipping_total, v_missing_setting, v_charges
  from charges;

  if v_missing_setting or v_shipping_total < 1 then
    raise exception using errcode = '55000', message = '센터·출고 그룹 배송비 설정을 확인해 주세요.';
  end if;
  return jsonb_build_object(
    'productSubtotal', v_product_total,
    'shippingFee', v_shipping_total,
    'total', v_product_total + v_shipping_total,
    'chargeCount', jsonb_array_length(v_charges),
    'charges', v_charges
  );
end;
$$;

revoke all on function public.quote_commerce_shipping_fee(uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.quote_commerce_shipping_fee(uuid[]) to authenticated;

comment on table public.commerce_order_shipping_fee_allocations is
  'Immutable checkout-time shipping units grouped by one store or one active fulfillment group.';

commit;
