begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';

alter table public.owner_ledger_repair_events
  drop constraint if exists owner_ledger_repair_events_action_check;
alter table public.owner_ledger_repair_events
  add constraint owner_ledger_repair_events_action_check check (action in (
    'cancel_bid', 'cancel_auction_payment', 'cancel_commerce_order',
    'cancel_legacy_payment', 'update_auction_due_at',
    'cancel_inventory_item', 'restore_inventory_item',
    'update_storage_duration', 'cancel_shipment',
    'correct_shipment_tracking', 'restore_audit_event',
    'force_request_shipment', 'force_complete_delivery'
  ));

create or replace function public.owner_force_request_inventory_shipment_service(
  p_actor_owner_id uuid,
  p_member_id uuid,
  p_inventory_item_ids uuid[],
  p_address_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_business_id uuid;
  v_product_id uuid;
  v_item_count integer;
  v_fingerprint text;
  v_existing public.owner_ledger_repair_events%rowtype;
  v_before jsonb;
  v_result jsonb;
  v_shipment_id uuid;
begin
  if auth.role() <> 'service_role'
    or p_actor_owner_id is null
    or not exists (
      select 1 from public.account_access_roles roles
      where roles.user_id = p_actor_owner_id
        and roles.role_code = 'owner'
        and roles.grade_level = 0
    )
  then
    raise exception using errcode='42501', message='신뢰된 소유자 서버 요청이 필요합니다.';
  end if;
  if p_member_id is null or p_address_id is null or p_idempotency_key is null
    or coalesce(cardinality(p_inventory_item_ids), 0) not between 1 and 100
    or cardinality(p_inventory_item_ids) <> cardinality(array(select distinct x from unnest(p_inventory_item_ids) x))
    or char_length(v_reason) not between 3 and 500
  then
    raise exception using errcode='22023', message='강제 배송 신청 입력값을 확인해 주세요.';
  end if;

  v_fingerprint := encode(digest(jsonb_build_object(
    'action', 'force_request_shipment',
    'memberId', p_member_id,
    'items', (select jsonb_agg(x order by x) from unnest(p_inventory_item_ids) x),
    'addressId', p_address_id,
    'reason', v_reason
  )::text, 'sha256'), 'hex');
  select events.* into v_existing
  from public.owner_ledger_repair_events events
  where events.actor_owner_id = p_actor_owner_id
    and events.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode='23505', message='같은 요청 키를 다른 강제 배송 신청에 재사용할 수 없습니다.';
    end if;
    return v_existing.result || jsonb_build_object('idempotentReplay', true);
  end if;

  perform items.id
  from public.customer_inventory_items items
  where items.id = any(p_inventory_item_ids)
  order by items.id
  for update;
  select count(*), min(items.business_id::text)::uuid, min(items.product_id::text)::uuid
  into v_item_count, v_business_id, v_product_id
  from public.customer_inventory_items items
  where items.id = any(p_inventory_item_ids)
    and items.member_id = p_member_id
    and items.ownership_status = 'active';
  if v_item_count <> cardinality(p_inventory_item_ids)
    or exists (
      select 1 from public.customer_inventory_items items
      where items.id = any(p_inventory_item_ids)
        and items.business_id <> v_business_id
    )
  then
    raise exception using errcode='55000', message='같은 회원·사업자의 활성 보관상품만 함께 배송 신청할 수 있습니다.';
  end if;
  if not exists (
    select 1 from public.shipping_addresses addresses
    where addresses.id = p_address_id and addresses.member_id = p_member_id
  ) then
    raise exception using errcode='P0002', message='회원 배송지를 찾지 못했습니다.';
  end if;

  v_before := jsonb_build_object(
    'inventoryItems', (select jsonb_agg(to_jsonb(items) order by items.id)
      from public.customer_inventory_items items where items.id = any(p_inventory_item_ids)),
    'addressId', p_address_id
  );

  -- The Owner explicitly waives the shipping fee for this exceptional recovery
  -- action. The canonical request command consumes this one-use entitlement and
  -- still performs all inventory, fulfillment, event, and idempotency checks.
  insert into public.shipping_fee_waiver_entitlements(member_id, business_id)
  values (p_member_id, v_business_id);

  perform set_config('request.jwt.claim.sub', p_member_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_result := public.request_inventory_shipment(
    p_inventory_item_ids,
    p_address_id,
    'waiver',
    null,
    null,
    null,
    p_idempotency_key
  );
  v_shipment_id := (v_result ->> 'shipment_id')::uuid;
  if v_shipment_id is null then
    raise exception using errcode='55000', message='강제 배송 신청 결과를 확인하지 못했습니다.';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into public.owner_ledger_repair_events(
    actor_owner_id, member_id, action, entity_type, entity_id, product_id,
    reason, idempotency_key, request_fingerprint,
    before_state, after_state, result
  ) values (
    p_actor_owner_id, p_member_id, 'force_request_shipment', 'shipment',
    v_shipment_id, v_product_id, v_reason, p_idempotency_key, v_fingerprint,
    v_before,
    jsonb_build_object('shipment', (select to_jsonb(shipments) from public.inventory_shipments shipments where shipments.id=v_shipment_id)),
    v_result || jsonb_build_object('shippingFeeWaivedByOwner', true, 'idempotentReplay', false)
  );
  return v_result || jsonb_build_object('shippingFeeWaivedByOwner', true, 'idempotentReplay', false);
end;
$$;

create or replace function public.owner_force_complete_inventory_delivery_service(
  p_actor_owner_id uuid,
  p_shipment_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_fingerprint text;
  v_existing public.owner_ledger_repair_events%rowtype;
  v_shipment public.inventory_shipments%rowtype;
  v_product_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if auth.role() <> 'service_role'
    or p_actor_owner_id is null
    or not exists (
      select 1 from public.account_access_roles roles
      where roles.user_id = p_actor_owner_id
        and roles.role_code = 'owner'
        and roles.grade_level = 0
    )
  then
    raise exception using errcode='42501', message='신뢰된 소유자 서버 요청이 필요합니다.';
  end if;
  if p_shipment_id is null or p_expected_version is null or p_expected_version < 0
    or p_idempotency_key is null or char_length(v_reason) not between 3 and 500
  then
    raise exception using errcode='22023', message='강제 배송완료 입력값을 확인해 주세요.';
  end if;

  v_fingerprint := encode(digest(jsonb_build_object(
    'action', 'force_complete_delivery',
    'shipmentId', p_shipment_id,
    'expectedVersion', p_expected_version,
    'reason', v_reason
  )::text, 'sha256'), 'hex');
  select events.* into v_existing
  from public.owner_ledger_repair_events events
  where events.actor_owner_id = p_actor_owner_id
    and events.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode='23505', message='같은 요청 키를 다른 강제 배송완료에 재사용할 수 없습니다.';
    end if;
    return v_existing.result || jsonb_build_object('idempotentReplay', true);
  end if;

  select shipments.* into v_shipment
  from public.inventory_shipments shipments
  where shipments.id = p_shipment_id
  for update;
  if not found then
    raise exception using errcode='P0002', message='배송 신청을 찾지 못했습니다.';
  end if;
  if v_shipment.version <> p_expected_version
    or v_shipment.status <> 'shipped'
    or nullif(btrim(coalesce(v_shipment.tracking_number, '')), '') is null
    or v_shipment.delivery_status = 'delivered'
  then
    raise exception using errcode='PT409', message='발송 완료 상태와 현재 버전을 다시 확인해 주세요.';
  end if;

  select shipment_items.product_id into v_product_id
  from public.inventory_shipment_items shipment_items
  where shipment_items.shipment_id = p_shipment_id
    and shipment_items.line_status not in ('excluded', 'cancelled')
  order by shipment_items.product_id
  limit 1;
  v_before := to_jsonb(v_shipment);

  v_result := public.record_inventory_delivery_tracking(
    p_shipment_id,
    v_shipment.tracking_number,
    v_shipment.tracker_carrier_id,
    '배송완료 (소유자 강제 처리)',
    clock_timestamp(),
    null
  );
  select to_jsonb(shipments) into v_after
  from public.inventory_shipments shipments
  where shipments.id = p_shipment_id;

  insert into public.owner_ledger_repair_events(
    actor_owner_id, member_id, action, entity_type, entity_id, product_id,
    reason, idempotency_key, request_fingerprint,
    before_state, after_state, result
  ) values (
    p_actor_owner_id, v_shipment.member_id, 'force_complete_delivery', 'shipment',
    p_shipment_id, v_product_id, v_reason, p_idempotency_key, v_fingerprint,
    v_before, v_after,
    v_result || jsonb_build_object('forcedByOwner', true, 'idempotentReplay', false)
  );
  return v_result || jsonb_build_object('forcedByOwner', true, 'idempotentReplay', false);
end;
$$;

revoke all on function public.owner_force_request_inventory_shipment_service(uuid,uuid,uuid[],uuid,text,uuid)
from public, anon, authenticated, service_role;
revoke all on function public.owner_force_complete_inventory_delivery_service(uuid,uuid,bigint,text,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.owner_force_request_inventory_shipment_service(uuid,uuid,uuid[],uuid,text,uuid)
to service_role;
grant execute on function public.owner_force_complete_inventory_delivery_service(uuid,uuid,bigint,text,uuid)
to service_role;

comment on function public.owner_force_request_inventory_shipment_service(uuid,uuid,uuid[],uuid,text,uuid) is
  'Trusted-server Owner recovery: creates a canonical shipment request with an explicitly audited one-use fee waiver.';
comment on function public.owner_force_complete_inventory_delivery_service(uuid,uuid,bigint,text,uuid) is
  'Trusted-server Owner recovery: records delivery completion for an already shipped canonical shipment.';

commit;
