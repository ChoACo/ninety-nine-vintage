create or replace function public.complete_inventory_shipment_with_tracking(
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
  v_now timestamptz := clock_timestamp();
  v_from_status text;
begin
  if v_actor is null
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
    'flow', 'one_step_dispatch'
  ));

  select * into v_receipt
  from public.inventory_command_receipts
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;

  if found then
    if v_receipt.command_name <> 'complete_shipment_with_tracking'
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
  if not app_private.has_center_permission(v_sh.fulfillment_center_id, 'create_shipments') then
    raise exception using errcode = '42501', message = '택배 발송을 처리할 권한이 없습니다.';
  end if;
  if v_sh.version <> p_expected_version
    or v_sh.status not in ('requested', 'collecting', 'ready_to_pack', 'packed')
  then
    raise exception using errcode = 'PT409', message = '배송 상태가 변경되었습니다.';
  end if;
  if v_sh.settlement_method = 'manual_transfer' and not exists (
    select 1 from public.shipping_fee_payments
    where id = v_sh.shipping_fee_payment_id and status = 'confirmed'
  ) then
    raise exception using errcode = '55000', message = '배송비 입금 확인이 필요합니다.';
  end if;

  perform 1
  from public.inventory_item_fulfillments as fulfillments
  join public.inventory_shipment_items as shipment_items
    on shipment_items.inventory_item_id = fulfillments.inventory_item_id
  where shipment_items.shipment_id = v_sh.id
  order by fulfillments.inventory_item_id
  for update of fulfillments, shipment_items;

  if not exists (
    select 1 from public.inventory_shipment_items
    where shipment_id = v_sh.id and line_status not in ('excluded', 'cancelled')
  ) or exists (
    select 1
    from public.inventory_shipment_items as shipment_items
    join public.customer_inventory_items as inventory
      on inventory.id = shipment_items.inventory_item_id
    join public.inventory_item_fulfillments as fulfillments
      on fulfillments.inventory_item_id = shipment_items.inventory_item_id
    where shipment_items.shipment_id = v_sh.id
      and shipment_items.line_status not in ('excluded', 'cancelled')
      and (
        inventory.ownership_status <> 'active'
        or shipment_items.line_status = 'held'
        or fulfillments.current_stage in ('reconciliation_required', 'cancelled', 'shipped')
        or fulfillments.is_blocked
        or exists (
          select 1 from public.inventory_exception_cases as exception_cases
          where exception_cases.inventory_item_id = shipment_items.inventory_item_id
            and exception_cases.status = 'open'
        )
      )
  ) then
    raise exception using errcode = '55000', message = '출고할 수 없는 상품 상태를 확인해 주세요.';
  end if;

  v_from_status := v_sh.status;

  insert into public.inventory_item_fulfillment_events (
    inventory_item_id, sequence_no, event_type, from_stage, to_stage,
    from_location_kind, to_location_kind, actor_kind, actor_user_id,
    idempotency_key, note, metadata
  )
  select
    fulfillments.inventory_item_id,
    coalesce((select max(events.sequence_no) + 1
      from public.inventory_item_fulfillment_events as events
      where events.inventory_item_id = fulfillments.inventory_item_id), 1),
    'shipped', fulfillments.current_stage, 'shipped',
    fulfillments.location_kind, 'transit', 'user', v_actor,
    p_idempotency_key, p_note, jsonb_build_object('oneStepDispatch', true)
  from public.inventory_item_fulfillments as fulfillments
  join public.inventory_shipment_items as shipment_items
    on shipment_items.inventory_item_id = fulfillments.inventory_item_id
  where shipment_items.shipment_id = v_sh.id
    and shipment_items.line_status not in ('excluded', 'cancelled');

  update public.inventory_item_fulfillments as fulfillments
  set current_stage = 'shipped',
      location_kind = 'transit',
      storage_location_code = null,
      outbound_released = true,
      version = fulfillments.version + 1,
      last_event_at = v_now,
      updated_at = v_now
  from public.inventory_shipment_items as shipment_items
  where shipment_items.shipment_id = v_sh.id
    and shipment_items.inventory_item_id = fulfillments.inventory_item_id
    and shipment_items.line_status not in ('excluded', 'cancelled');

  update public.inventory_shipment_items
  set line_status = 'shipped', updated_at = v_now
  where shipment_id = v_sh.id and line_status not in ('excluded', 'cancelled');

  update public.inventory_shipment_store_works
  set status = 'outbound_complete',
      completed_at = coalesce(completed_at, v_now),
      completed_by = coalesce(completed_by, v_actor),
      version = version + 1,
      updated_at = v_now
  where shipment_id = v_sh.id and status <> 'cancelled';

  update public.inventory_shipments
  set status = 'shipped',
      courier = btrim(p_courier),
      tracking_number = btrim(p_tracking_number),
      packed_at = coalesce(packed_at, v_now),
      packed_by = coalesce(packed_by, v_actor),
      shipped_at = v_now,
      shipped_by = v_actor,
      version = version + 1,
      updated_at = v_now
  where id = v_sh.id
  returning * into v_sh;

  insert into public.shipping_fee_waiver_entitlements (
    member_id, business_id, exception_case_id
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
    shipment_id, sequence_no, event_type, from_status, to_status,
    actor_kind, actor_user_id, idempotency_key, reason, metadata
  ) values (
    v_sh.id,
    coalesce((select max(sequence_no) + 1 from public.inventory_shipment_events where shipment_id = v_sh.id), 1),
    'shipped', v_from_status, 'shipped', 'user', v_actor,
    p_idempotency_key, p_note, jsonb_build_object('oneStepDispatch', true)
  );

  v_result := jsonb_build_object(
    'id', v_sh.id,
    'version', v_sh.version,
    'status', v_sh.status,
    'idempotent_replay', false
  );

  insert into public.inventory_command_receipts
  values (
    v_actor, p_idempotency_key, 'complete_shipment_with_tracking',
    v_sh.id, v_fp, v_result, v_now
  );

  return v_result;
end;
$$;

revoke all on function public.complete_inventory_shipment_with_tracking(
  uuid, bigint, text, text, uuid, text
) from public, anon;
grant execute on function public.complete_inventory_shipment_with_tracking(
  uuid, bigint, text, text, uuid, text
) to authenticated;
