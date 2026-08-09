begin;

-- P1-3 Stage 2: retire every commerce_shipments writer and freeze the legacy
-- shipping history. inventory_shipments is now the only shipping write path.
-- The earlier canonical migrations granted EXECUTE only to these roles, so the
-- revokes below close every new-call path; re-asserting the closed surface is
-- additive and idempotent even if a future migration reopens one grant.

revoke all on function public.request_commerce_order_shipment(
  uuid, uuid, uuid, text, bigint, text, text, uuid
)
from public, anon, authenticated, service_role;
revoke all on function public.pack_commerce_shipment(
  uuid, bigint, uuid, text
)
from public, anon, authenticated, service_role;
revoke all on function public.ship_commerce_shipment(
  uuid, bigint, text, text, uuid, text
)
from public, anon, authenticated, service_role;
revoke all on function public.correct_commerce_shipment_tracking(
  uuid, bigint, text, text, text, uuid
)
from public, anon, authenticated, service_role;

-- Direct table mutation was already closed by the canonical migrations; re-assert
-- every role boundary so a future grant can never reopen a legacy writer.
revoke insert, update, delete on table
  public.shipping_requests,
  public.shipping_request_items
from public, anon, authenticated, service_role;
revoke insert, update, delete on table
  public.commerce_shipments,
  public.commerce_shipment_orders,
  public.commerce_shipment_items,
  public.commerce_shipment_events,
  public.commerce_shipment_reconciliation_cases
from public, anon, authenticated, service_role;

-- shipping_requests is a read-only projection of an immutable history. The
-- canonical projection trigger already prevents fact drift on update; a new
-- insert/delete guard makes the "no new projections" rule database-enforced.
create or replace function app_private.guard_shipping_requests_retired()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = '신규 배송 요청은 inventory_shipments로만 생성할 수 있습니다.';
end;
$$;

revoke all on function app_private.guard_shipping_requests_retired()
from public, anon, authenticated, service_role;

drop trigger if exists shipping_requests_retired_writes
  on public.shipping_requests;
create trigger shipping_requests_retired_writes
before insert or delete on public.shipping_requests
for each row execute function app_private.guard_shipping_requests_retired();

-- commerce_shipments and its manifest rows are immutable compatibility history.
-- The RPC revokes above remove every caller; this trigger is the defense-in-depth
-- that keeps even a security-definer writer from mutating the record.
create or replace function app_private.guard_commerce_shipments_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = '기존 canonical 배송 기록은 immutable history로 직접 수정할 수 없습니다.';
end;
$$;

revoke all on function app_private.guard_commerce_shipments_immutable()
from public, anon, authenticated, service_role;

drop trigger if exists commerce_shipments_immutable_history on public.commerce_shipments;
create trigger commerce_shipments_immutable_history
before insert or update or delete on public.commerce_shipments
for each row execute function app_private.guard_commerce_shipments_immutable();

drop trigger if exists commerce_shipment_orders_immutable_history on public.commerce_shipment_orders;
create trigger commerce_shipment_orders_immutable_history
before insert or update or delete on public.commerce_shipment_orders
for each row execute function app_private.guard_commerce_shipments_immutable();

drop trigger if exists commerce_shipment_items_immutable_history on public.commerce_shipment_items;
create trigger commerce_shipment_items_immutable_history
before insert or update or delete on public.commerce_shipment_items
for each row execute function app_private.guard_commerce_shipments_immutable();

drop trigger if exists commerce_shipment_events_immutable_history on public.commerce_shipment_events;
create trigger commerce_shipment_events_immutable_history
before insert or update or delete on public.commerce_shipment_events
for each row execute function app_private.guard_commerce_shipments_immutable();

drop trigger if exists commerce_shipment_reconciliation_cases_immutable_history
  on public.commerce_shipment_reconciliation_cases;
create trigger commerce_shipment_reconciliation_cases_immutable_history
before insert or update or delete on public.commerce_shipment_reconciliation_cases
for each row execute function app_private.guard_commerce_shipments_immutable();

-- Compatibility read contract: expose a legacy shipment with a stable
-- sourceKind/sourceId plus the v2 inventory shipments it is already linked to
-- through customer_inventory_items.legacy_commerce_shipment_id. The v2 tables
-- are only read when present so this helper also runs on schemas that predate
-- the unified inventory cutover.
create or replace function app_private.get_commerce_shipment_compat(
  p_shipment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shipment public.commerce_shipments%rowtype;
  v_links jsonb := '[]'::jsonb;
  v_items jsonb;
begin
  select * into v_shipment
  from public.commerce_shipments
  where id = p_shipment_id;

  if not found then
    return null;
  end if;

  if to_regclass('public.customer_inventory_items') is not null
     and to_regclass('public.inventory_shipment_items') is not null then
    select coalesce(jsonb_agg(distinct x.shipment_id order by x.shipment_id), '[]'::jsonb)
    into v_links
    from public.customer_inventory_items as items
    join public.inventory_shipment_items as x on x.inventory_item_id = items.id
    where items.legacy_commerce_shipment_id = v_shipment.id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'orderItemId', x.order_item_id,
    'productId', x.product_id
  ) order by x.order_item_id), '[]'::jsonb)
  into v_items
  from public.commerce_shipment_items as x
  where x.shipment_id = v_shipment.id;

  return jsonb_build_object(
    'sourceKind', 'canonical_commerce',
    'sourceId', v_shipment.id,
    'status', v_shipment.status,
    'settlementMethod', v_shipment.settlement_method,
    'courier', v_shipment.courier,
    'trackingNumber', v_shipment.tracking_number,
    'requestedAt', v_shipment.created_at,
    'packedAt', v_shipment.packed_at,
    'shippedAt', v_shipment.shipped_at,
    'memberId', v_shipment.member_id,
    'businessId', v_shipment.business_id,
    'immutable', true,
    'linkedInventoryShipmentIds', v_links,
    'items', v_items
  );
end;
$$;

revoke all on function app_private.get_commerce_shipment_compat(uuid)
from public, anon, authenticated, service_role;

-- FIX 1: a member-scoped read that lists every paid, fully-unshipped commerce
-- order whose items are not yet represented in the unified inventory. These are
-- the legacy-only rows the pre-cutover customers can still request shipping for.
-- The read is server-computed and never writes; it returns nothing for any other
-- member, and an order is excluded as soon as any item is unpaid, expired,
-- already shipped through commerce_shipment_items, or mapped into a v2
-- customer_inventory_items entitlement (no duplication with the v2 list).
create or replace function public.get_my_legacy_eligible_orders()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
  v_mapped_order_ids jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_member is null then
    raise exception using errcode = '42501', message = '구매자 로그인이 필요합니다.';
  end if;

  if to_regclass('public.customer_inventory_items') is not null then
    select coalesce(jsonb_agg(distinct item.order_id), '[]'::jsonb)
    into v_mapped_order_ids
    from public.customer_inventory_items mapped_item
    join public.commerce_order_items item on item.id = mapped_item.commerce_order_item_id;
  end if;

  with order_summary as (
    select
      order_item.order_id,
      min(order_item.storage_expires_at) as storage_expires_at,
      coalesce(jsonb_agg(jsonb_build_object(
        'orderItemId', order_item.id,
        'productId', order_item.product_id,
        'title', order_product.title,
        'imageUrl', coalesce(order_product.image_urls[1], ''),
        'storageExpiresAt', order_item.storage_expires_at
      ) order by order_item.id), '[]'::jsonb) as items
    from public.commerce_order_items order_item
    join public.products order_product on order_product.id = order_item.product_id
    group by order_item.order_id
  ),
  eligible_orders as (
    select orders.id, orders.updated_at
    from public.commerce_orders orders
    where orders.member_id = v_member
      and orders.status = 'paid'
      and not exists (
        select 1
        from public.commerce_order_items invalid_item
        where invalid_item.order_id = orders.id
          and (invalid_item.payment_status <> 'paid'
               or invalid_item.storage_expires_at is null
               or invalid_item.storage_expires_at <= clock_timestamp())
      )
      and not exists (
        select 1
        from public.commerce_shipment_items shipped_item
        where shipped_item.order_item_id in (
          select order_item.id
          from public.commerce_order_items order_item
          where order_item.order_id = orders.id
        )
      )
      and not (v_mapped_order_ids ? orders.id::text)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceKind', 'canonical_commerce',
    'sourceId', orders.id,
    'status', 'paid',
    'requestEligible', true,
    'requestBlockReason', null,
    'storageExpiresAt', summary.storage_expires_at,
    'items', summary.items
  ) order by orders.updated_at desc, orders.id), '[]'::jsonb)
  into v_result
  from eligible_orders orders
  join order_summary summary on summary.order_id = orders.id;

  return jsonb_build_object('orders', coalesce(v_result, '[]'::jsonb));
end;
$$;

grant execute on function public.get_my_legacy_eligible_orders()
to authenticated;
revoke all on function public.get_my_legacy_eligible_orders()
from public, anon, service_role;

-- FIX 1 verified compatibility command: the only way a customer can request
-- shipping for a legacy-only order after the legacy writers are retired. It
-- validates the same paid/unshipped/unmapped contract as the read above, then
-- converts each paid item into a v2 customer_inventory_items entitlement
-- (preserving the original storage expiry) and submits a single
-- request_inventory_shipment. All new shipping facts land in
-- inventory_shipments only; commerce_shipments/shipping_requests stay
-- untouched and immutable. On schemas that predate the unified inventory
-- cutover (no request_inventory_shipment) the command fails closed instead of
-- guessing.
create or replace function public.request_legacy_order_shipment(
  p_order_id uuid,
  p_address_id uuid,
  p_apply_shipping_credit boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_member uuid;
  v_business uuid;
  v_business_count integer;
  v_method text;
  v_item_ids uuid[] := '{}'::uuid[];
  v_item_id uuid;
  v_order_item record;
begin
  if to_regprocedure('public.request_inventory_shipment(uuid[],uuid,text,bigint,text,text,uuid)') is null
     or to_regclass('public.customer_inventory_items') is null
     or to_regclass('public.inventory_fulfillment_rollout_settings') is null
  then
    raise exception using
      errcode = '55000',
      message = '통합 보관 시스템이 활성화되지 않아 기존 주문 배송을 신청할 수 없습니다.';
  end if;

  if v_actor is null or not public.is_member() then
    raise exception using errcode = '42501', message = '구매자 로그인이 필요합니다.';
  end if;
  if p_order_id is null or p_address_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = '기존 주문 배송 신청 입력값을 확인해 주세요.';
  end if;

  select orders.member_id into v_member
  from public.commerce_orders orders
  where orders.id = p_order_id;
  if v_member is null then
    raise exception using errcode = 'P0002', message = '기존 주문을 찾지 못했습니다.';
  end if;
  if v_member is distinct from v_actor then
    raise exception using errcode = '42501', message = '기존 주문 배송 신청 권한이 없습니다.';
  end if;
  if not exists(
    select 1
    from public.commerce_order_items item
    where item.order_id = p_order_id and item.payment_status = 'paid'
  ) then
    raise exception using errcode = '55000', message = '결제 완료 상품이 없는 주문입니다.';
  end if;
  if exists(
    select 1
    from public.commerce_order_items invalid_item
    where invalid_item.order_id = p_order_id
      and (invalid_item.payment_status <> 'paid'
           or invalid_item.storage_expires_at is null
           or invalid_item.storage_expires_at <= clock_timestamp())
  ) then
    raise exception using
      errcode = '55000',
      message = '결제가 끝나지 않았거나 보관 유효 기간이 지난 상품이 포함되어 있습니다.';
  end if;
  if exists(
    select 1
    from public.commerce_shipment_items shipped_item
    where shipped_item.order_item_id in (
      select item.id from public.commerce_order_items item where item.order_id = p_order_id
    )
  ) then
    raise exception using errcode = '55000', message = '이미 배송된 주문은 다시 신청할 수 없습니다.';
  end if;
  if exists(
    select 1
    from public.customer_inventory_items mapped_item
    where mapped_item.commerce_order_item_id in (
      select item.id from public.commerce_order_items item where item.order_id = p_order_id
    )
  ) then
    raise exception using
      errcode = '55000',
      message = '이미 보관 상품으로 전환된 주문은 선택 상품 배송으로 신청해 주세요.';
  end if;

  select count(distinct store.business_id) into v_business_count
  from public.commerce_order_items item
  join public.stores store on store.id = item.store_id
  where item.order_id = p_order_id;
  if v_business_count is distinct from 1 then
    raise exception using errcode = '55000', message = '서로 다른 사업장의 주문은 한 번에 배송 신청할 수 없습니다.';
  end if;
  select store.business_id into v_business
  from public.commerce_order_items item
  join public.stores store on store.id = item.store_id
  where item.order_id = p_order_id
  limit 1;
  if not exists(
    select 1
    from public.inventory_fulfillment_rollout_settings settings
    where settings.business_id = v_business
      and settings.item_selected_shipments_enabled
  ) then
    raise exception using errcode = '55000', message = '선택 배송 기능이 아직 활성화되지 않았습니다.';
  end if;
  if not exists(
    select 1
    from public.shipping_addresses address
    where address.id = p_address_id and address.member_id = v_actor
  ) then
    raise exception using errcode = 'P0002', message = '배송지를 찾지 못했습니다.';
  end if;

  perform pg_catalog.set_config('app.inventory_entitlement_backfill', '1', true);
  for v_order_item in
    select item.id
    from public.commerce_order_items item
    where item.order_id = p_order_id and item.payment_status = 'paid'
    order by item.id
  loop
    v_item_id := app_private.create_customer_inventory_entitlement('commerce', v_order_item.id);
    if v_item_id is null then
      raise exception using
        errcode = '55000',
        message = '기존 주문 상품을 보관 상품으로 전환하지 못했습니다.';
    end if;
    v_item_ids := array_append(v_item_ids, v_item_id);
  end loop;

  v_method := case when coalesce(p_apply_shipping_credit, false)
    then 'shipping_credit' else 'manual_transfer' end;
  return public.request_inventory_shipment(
    v_item_ids, p_address_id, v_method, null, null, null, p_idempotency_key
  );
end;
$$;

grant execute on function public.request_legacy_order_shipment(
  uuid, uuid, boolean, uuid
)
to authenticated;
revoke all on function public.request_legacy_order_shipment(
  uuid, uuid, boolean, uuid
)
from public, anon, service_role;

-- FIX 2: the app_private compat helper must not stay a dead contract. This is
-- its authenticated, member-ownership-scoped read surface. It returns the
-- helper result only for the caller's own shipment (memberId filter) and null
-- for any other member, and it carries no insert/update/delete capability.
create or replace function public.get_my_commerce_shipment_compat(
  p_shipment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  select app_private.get_commerce_shipment_compat(p_shipment_id) into v_result;
  if v_result is null or v_result ->> 'memberId' <> auth.uid()::text then
    return null;
  end if;
  return v_result;
end;
$$;

grant execute on function public.get_my_commerce_shipment_compat(uuid)
to authenticated;
revoke all on function public.get_my_commerce_shipment_compat(uuid)
from public, anon, service_role;

comment on function public.request_commerce_order_shipment(
  uuid, uuid, uuid, text, bigint, text, text, uuid
) is
  'Retired service-only legacy writer. inventory_shipments is the sole new shipment source.';
comment on function public.pack_commerce_shipment(uuid, bigint, uuid, text) is
  'Retired legacy pack writer. Use pack_inventory_shipment.';
comment on function public.ship_commerce_shipment(uuid, bigint, text, text, uuid, text) is
  'Retired legacy ship writer. Use ship_inventory_shipment.';
comment on function public.correct_commerce_shipment_tracking(
  uuid, bigint, text, text, text, uuid
) is
  'Retired legacy tracking correction writer. Use revise_inventory_shipment_tracking.';
comment on function app_private.get_commerce_shipment_compat(uuid) is
  'Read-only compatibility adapter for immutable commerce_shipments history.';
comment on function public.get_my_legacy_eligible_orders() is
  'Member-scoped read of legacy-only paid commerce orders that can still request shipping through request_legacy_order_shipment.';
comment on function public.request_legacy_order_shipment(uuid, uuid, boolean, uuid) is
  'Verified compatibility command: converts legacy-only paid order items to unified inventory and requests shipping through request_inventory_shipment.';
comment on function public.get_my_commerce_shipment_compat(uuid) is
  'Member-ownership-scoped read-only API for the immutable legacy shipment compat contract.';

commit;
