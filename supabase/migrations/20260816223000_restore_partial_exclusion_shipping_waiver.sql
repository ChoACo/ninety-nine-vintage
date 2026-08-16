-- Restore the later-shipment waiver that was accidentally dropped when the
-- direct-store shipment function replaced the original unified-v2 function.

create or replace function public.ship_inventory_shipment(
  p_shipment_id uuid,
  p_expected_version bigint,
  p_courier text,
  p_tracking_number text,
  p_idempotency_key uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_sh public.inventory_shipments%rowtype;
  v_fp text;
  v_receipt public.inventory_command_receipts%rowtype;
  v_result jsonb;
begin
  if v_actor is null
    or not public.can_view_shared_fulfillment()
    or p_idempotency_key is null
    or char_length(btrim(coalesce(p_courier, ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_tracking_number, ''))) not between 3 and 120
  then
    raise exception using errcode = '22023', message = '택배사와 송장번호를 확인해 주세요.';
  end if;

  v_fp := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'shipment', p_shipment_id,
    'version', p_expected_version,
    'courier', btrim(p_courier),
    'tracking', btrim(p_tracking_number),
    'note', btrim(coalesce(p_note, '')),
    'flow', 'direct_store'
  ));

  select * into v_receipt
  from public.inventory_command_receipts
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;

  if found then
    if v_receipt.command_name <> 'ship_shipment'
      or v_receipt.request_fingerprint <> v_fp
    then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  perform app_private.lock_inventory_shipment(p_shipment_id);
  select * into v_sh
  from public.inventory_shipments
  where id = p_shipment_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '배송 신청을 찾지 못했습니다.';
  end if;
  if v_sh.version <> p_expected_version or v_sh.status <> 'packed' then
    raise exception using errcode = 'PT409', message = '포장 상태가 변경되었습니다.';
  end if;
  if exists(
    select 1
    from public.inventory_shipment_items as shipment_items
    join public.inventory_item_fulfillments as fulfillments
      on fulfillments.inventory_item_id = shipment_items.inventory_item_id
    where shipment_items.shipment_id = v_sh.id
      and shipment_items.line_status = 'packed'
      and (
        fulfillments.is_blocked
        or exists(
          select 1
          from public.inventory_exception_cases as exception_cases
          where exception_cases.inventory_item_id = shipment_items.inventory_item_id
            and exception_cases.status = 'open'
        )
      )
  ) then
    raise exception using errcode = '55000', message = '미 출고된 상품이 존재합니다';
  end if;

  update public.inventory_shipment_items
  set line_status = 'shipped', updated_at = clock_timestamp()
  where shipment_id = v_sh.id and line_status = 'packed';

  update public.inventory_item_fulfillments as fulfillments
  set current_stage = 'shipped',
      location_kind = 'transit',
      version = version + 1,
      last_event_at = clock_timestamp(),
      updated_at = clock_timestamp()
  from public.inventory_shipment_items as shipment_items
  where shipment_items.shipment_id = v_sh.id
    and shipment_items.inventory_item_id = fulfillments.inventory_item_id
    and shipment_items.line_status = 'shipped';

  update public.inventory_shipments
  set status = 'shipped',
      courier = btrim(p_courier),
      tracking_number = btrim(p_tracking_number),
      shipped_at = clock_timestamp(),
      shipped_by = v_actor,
      version = version + 1,
      updated_at = clock_timestamp()
  where id = v_sh.id
  returning * into v_sh;

  insert into public.shipping_fee_waiver_entitlements (
    member_id,
    business_id,
    exception_case_id
  )
  select inventory.member_id, inventory.business_id, exception_cases.id
  from public.inventory_exception_cases as exception_cases
  join public.customer_inventory_items as inventory
    on inventory.id = exception_cases.inventory_item_id
  where exception_cases.shipment_id = v_sh.id
    and exception_cases.status = 'resolved'
    and exception_cases.resolution = 'exclude_for_later'
  on conflict (exception_case_id) do nothing;

  insert into public.inventory_shipment_events (
    shipment_id,
    sequence_no,
    event_type,
    from_status,
    to_status,
    actor_kind,
    actor_user_id,
    idempotency_key,
    reason
  ) values (
    v_sh.id,
    coalesce((
      select max(sequence_no) + 1
      from public.inventory_shipment_events
      where shipment_id = v_sh.id
    ), 1),
    'shipped',
    'packed',
    'shipped',
    'user',
    v_actor,
    p_idempotency_key,
    p_note
  );

  v_result := jsonb_build_object(
    'id', v_sh.id,
    'version', v_sh.version,
    'status', v_sh.status,
    'idempotent_replay', false
  );

  insert into public.inventory_command_receipts
  values (
    v_actor,
    p_idempotency_key,
    'ship_shipment',
    v_sh.id,
    v_fp,
    v_result,
    clock_timestamp()
  );

  return v_result;
end;
$$;

-- Excluded lines return to the member's stored-inventory list. Keep the
-- resolved exception visible so the UI can explain why the item returned.
create or replace function public.get_my_inventory_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'rolloutEnabled', coalesce(bool_or(settings.unified_inventory_reads_enabled), false),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', inventory.id,
      'productId', inventory.product_id,
      'title', products.title,
      'imageUrl', coalesce(products.image_urls[1], ''),
      'sourceKind', inventory.source_kind,
      'sourceReference', coalesce(
        inventory.commerce_order_item_id,
        inventory.manual_transfer_order_id,
        inventory.legacy_payment_order_id
      ),
      'originStoreId', inventory.origin_store_id,
      'originStoreName', stores.name,
      'ownershipStatus', inventory.ownership_status,
      'rolloutEnabled', settings.unified_inventory_reads_enabled,
      'itemSelectedShipmentsEnabled', settings.item_selected_shipments_enabled,
      'requestEligible', (
        settings.item_selected_shipments_enabled
        and inventory.ownership_status = 'active'
        and fulfillments.current_stage in (
          'entitled', 'preparing', 'in_transit_to_center',
          'center_received', 'center_stored'
        )
        and not fulfillments.is_blocked
      ),
      'requestBlockReason', case
        when not settings.item_selected_shipments_enabled
          or inventory.ownership_status <> 'active'
          or fulfillments.is_blocked
          or fulfillments.current_stage not in (
            'entitled', 'preparing', 'in_transit_to_center',
            'center_received', 'center_stored'
          )
        then 'unavailable'
      end,
      'storageStartedAt', inventory.storage_started_at,
      'storageExpiresAt', inventory.storage_expires_at,
      'activeShipmentId', null,
      'exceptionKind', latest_exception.kind,
      'exceptionStatus', latest_exception.status,
      'exceptionResolution', latest_exception.resolution,
      'exceptionPublicReason', latest_exception.public_reason
    ) order by inventory.paid_at desc, inventory.id), '[]'::jsonb),
    'serverTime', clock_timestamp()
  )
  from public.customer_inventory_items as inventory
  join public.products as products on products.id = inventory.product_id
  join public.stores as stores on stores.id = inventory.origin_store_id
  join public.inventory_item_fulfillments as fulfillments
    on fulfillments.inventory_item_id = inventory.id
  join public.inventory_fulfillment_rollout_settings as settings
    on settings.business_id = inventory.business_id
  left join lateral (
    select
      exception_cases.kind,
      exception_cases.status,
      exception_cases.resolution,
      exception_cases.public_reason
    from public.inventory_exception_cases as exception_cases
    where exception_cases.inventory_item_id = inventory.id
    order by (exception_cases.status = 'open') desc,
      exception_cases.created_at desc,
      exception_cases.id desc
    limit 1
  ) as latest_exception on true
  where inventory.member_id = auth.uid()
    and settings.unified_inventory_reads_enabled
    and inventory.legacy_commerce_shipment_id is null
    and not exists (
      select 1
      from public.inventory_shipment_items as shipment_items
      where shipment_items.inventory_item_id = inventory.id
        and shipment_items.line_status not in ('excluded', 'cancelled')
    );
$$;

-- Generate a tracking link for the courier that was actually recorded.
create or replace function public.get_my_inventory_shipments()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with v2 as (
  select shipments.created_at as requested_at, jsonb_build_object(
    'id', shipments.id,
    'sourceKind', 'inventory_v2',
    'sourceId', shipments.id,
    'settlementMethod', shipments.settlement_method,
    'shippingFeeStatus', case
      when shipments.settlement_method = 'manual_transfer' then payments.status
      else 'confirmed'
    end,
    'publicStatus', case when shipments.tracking_number is null then 'preparing' else 'shipped' end,
    'itemCount', (select count(*) from public.inventory_shipment_items where shipment_id = shipments.id),
    'activeItemCount', (select count(*) from public.inventory_shipment_items
      where shipment_id = shipments.id and line_status not in ('excluded', 'cancelled')),
    'courier', shipments.courier,
    'trackingNumber', shipments.tracking_number,
    'trackingUrl', case
      when shipments.tracking_number !~ '^[0-9-]+$' then null
      when lower(coalesce(shipments.courier, '')) like '%cj%'
        then 'https://trace.cjlogistics.com/next/tracking.html?wblNo=' || shipments.tracking_number
      when lower(coalesce(shipments.courier, '')) like '%한진%'
        or lower(coalesce(shipments.courier, '')) like '%hanjin%'
        then 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=' || shipments.tracking_number
    end,
    'requestedAt', shipments.created_at,
    'addressSnapshot', shipments.address_snapshot,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', shipment_items.inventory_item_id,
      'productId', shipment_items.product_id,
      'title', products.title,
      'imageUrl', coalesce(products.image_urls[1], '')
    ) order by shipment_items.created_at, shipment_items.inventory_item_id), '[]'::jsonb)
      from public.inventory_shipment_items as shipment_items
      join public.products as products on products.id = shipment_items.product_id
      where shipment_items.shipment_id = shipments.id)
  ) as payload
  from public.inventory_shipments as shipments
  left join public.shipping_fee_payments as payments
    on payments.id = shipments.shipping_fee_payment_id
  where shipments.member_id = auth.uid()
    and exists (
      select 1
      from public.inventory_fulfillment_rollout_settings as settings
      where settings.business_id = shipments.business_id
        and settings.unified_inventory_reads_enabled
    )
),
legacy as (
  select shipments.created_at as requested_at, jsonb_build_object(
    'id', shipments.id,
    'sourceKind', 'canonical_commerce',
    'sourceId', shipments.id,
    'settlementMethod', shipments.settlement_method,
    'shippingFeeStatus', case
      when shipments.settlement_method = 'manual_transfer' then payments.status
      else 'confirmed'
    end,
    'publicStatus', case when shipments.tracking_number is null then 'preparing' else 'shipped' end,
    'itemCount', (select count(*) from public.commerce_shipment_items where shipment_id = shipments.id),
    'activeItemCount', (select count(*) from public.commerce_shipment_items where shipment_id = shipments.id),
    'courier', shipments.courier,
    'trackingNumber', shipments.tracking_number,
    'trackingUrl', case
      when shipments.tracking_number !~ '^[0-9-]+$' then null
      when lower(coalesce(shipments.courier, '')) like '%cj%'
        then 'https://trace.cjlogistics.com/next/tracking.html?wblNo=' || shipments.tracking_number
      when lower(coalesce(shipments.courier, '')) like '%한진%'
        or lower(coalesce(shipments.courier, '')) like '%hanjin%'
        then 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=' || shipments.tracking_number
    end,
    'requestedAt', shipments.created_at,
    'addressSnapshot', shipments.address_snapshot,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', inventory.id,
      'productId', shipment_items.product_id,
      'title', products.title,
      'imageUrl', coalesce(products.image_urls[1], '')
    ) order by shipment_items.order_item_id), '[]'::jsonb)
      from public.commerce_shipment_items as shipment_items
      join public.products as products on products.id = shipment_items.product_id
      left join public.customer_inventory_items as inventory
        on inventory.commerce_order_item_id = shipment_items.order_item_id
      where shipment_items.shipment_id = shipments.id)
  ) as payload
  from public.commerce_shipments as shipments
  left join public.shipping_fee_payments as payments
    on payments.id = shipments.shipping_fee_payment_id
  where shipments.member_id = auth.uid()
)
select jsonb_build_object(
  'shipments', coalesce(jsonb_agg(payload order by requested_at desc), '[]'::jsonb)
)
from (select * from v2 union all select * from legacy) as all_shipments;
$$;

revoke all on function public.ship_inventory_shipment(
  uuid, bigint, text, text, uuid, text
) from public, anon, service_role;
grant execute on function public.ship_inventory_shipment(
  uuid, bigint, text, text, uuid, text
) to authenticated;

revoke all on function public.get_my_inventory_overview()
from public, anon, service_role;
grant execute on function public.get_my_inventory_overview()
to authenticated;

revoke all on function public.get_my_inventory_shipments()
from public, anon, service_role;
grant execute on function public.get_my_inventory_shipments()
to authenticated;
