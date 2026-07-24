-- Direct-store fulfillment cutover.
--
-- The center columns remain as compatibility keys for historical rows and
-- foreign keys, but they are no longer an operator-facing routing concept.
-- A store release stores the item immediately, and one buyer shipment may
-- contain items from multiple stores in the same business.

create index if not exists customer_inventory_items_active_paid_kst_date_idx
  on public.customer_inventory_items (
    ((paid_at at time zone 'Asia/Seoul')::date),
    origin_store_id,
    member_id
  )
  where ownership_status = 'active';

create index if not exists inventory_shipments_created_kst_date_idx
  on public.inventory_shipments (
    ((created_at at time zone 'Asia/Seoul')::date),
    created_at desc,
    id desc
  );

create or replace function public.can_view_shared_fulfillment()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists(
    select 1
    from public.account_access_roles r
    where r.user_id = auth.uid()
      and r.role_code in ('owner', 'operator', 'employee')
  ), false);
$$;

revoke all on function public.can_view_shared_fulfillment() from public, anon;
grant execute on function public.can_view_shared_fulfillment() to authenticated;

create or replace function public.get_direct_store_fulfillment_groups(
  p_date date default null,
  p_limit integer default 24,
  p_offset integer default 0
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
  if not public.can_view_shared_fulfillment() then
    raise exception using errcode = '42501', message = '상품 보관·출고 조회 권한이 없습니다.';
  end if;

  with group_rows as (
    select
      'store_paid_items'::text as action,
      null::uuid as work_id,
      null::bigint as work_version,
      (i.paid_at at time zone 'Asia/Seoul')::date as activity_date,
      i.member_id,
      pf.display_name as buyer_name,
      i.origin_store_id,
      s.name as origin_store_name,
      (public.is_owner() or public.has_store_permission(i.origin_store_id, 'prepare_orders')) as can_process,
      jsonb_agg(jsonb_build_object(
        'inventoryItemId', i.id,
        'productId', i.product_id,
        'title', p.title,
        'imageUrl', coalesce(p.image_urls[1], ''),
        'version', f.version,
        'requestedForShipping', false,
        'isBlocked', f.is_blocked
      ) order by coalesce(i.paid_at, i.created_at), i.id) as items
    from public.customer_inventory_items i
    join public.inventory_item_fulfillments f on f.inventory_item_id = i.id
    join public.products p on p.id = i.product_id
    join public.profiles pf on pf.id = i.member_id
    join public.stores s on s.id = i.origin_store_id
    where i.ownership_status = 'active'
      and f.current_stage in ('entitled', 'preparing', 'center_received')
      and not f.outbound_released
      and not exists (
        select 1
        from public.inventory_shipment_items x
        where x.inventory_item_id = i.id
          and x.line_status in ('requested', 'held', 'ready', 'packed')
      )
      and (p_date is null or (i.paid_at at time zone 'Asia/Seoul')::date = p_date)
    group by (i.paid_at at time zone 'Asia/Seoul')::date, i.member_id, pf.display_name,
      i.origin_store_id, s.name

    union all

    select
      'store_requested_items'::text,
      w.id,
      w.version,
      (sh.created_at at time zone 'Asia/Seoul')::date,
      sh.member_id,
      pf.display_name,
      w.origin_store_id,
      s.name,
      (public.is_owner() or public.has_store_permission(w.origin_store_id, 'prepare_orders')),
      jsonb_agg(jsonb_build_object(
        'inventoryItemId', x.inventory_item_id,
        'productId', x.product_id,
        'title', p.title,
        'imageUrl', coalesce(p.image_urls[1], ''),
        'version', f.version,
        'requestedForShipping', true,
        'isBlocked', f.is_blocked
      ) order by x.created_at, x.inventory_item_id)
    from public.inventory_shipment_store_works w
    join public.inventory_shipments sh on sh.id = w.shipment_id
    join public.profiles pf on pf.id = sh.member_id
    join public.stores s on s.id = w.origin_store_id
    join public.inventory_shipment_items x
      on x.shipment_id = w.shipment_id
      and x.origin_store_id = w.origin_store_id
      and x.line_status in ('requested', 'held')
    join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
    join public.products p on p.id = x.product_id
    where w.status = 'collecting'
      and (p_date is null or (sh.created_at at time zone 'Asia/Seoul')::date = p_date)
    group by w.id, w.version, (sh.created_at at time zone 'Asia/Seoul')::date, sh.member_id, pf.display_name,
      w.origin_store_id, s.name
  ),
  paged as (
    select *
    from group_rows
    order by activity_date desc, buyer_name, origin_store_name, work_id nulls first
    limit greatest(1, least(coalesce(p_limit, 24), 100))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'groups', coalesce(jsonb_agg(jsonb_build_object(
      'groupId', action || ':' || activity_date::text || ':' || member_id::text || ':' ||
        origin_store_id::text || ':' || coalesce(work_id::text, 'paid'),
      'action', action,
      'workId', work_id,
      'workVersion', work_version,
      'activityDate', activity_date,
      'buyerId', member_id,
      'buyerName', buyer_name,
      'originStoreId', origin_store_id,
      'originStoreName', origin_store_name,
      'canProcess', can_process,
      'items', items
    ) order by activity_date desc, buyer_name, origin_store_name), '[]'::jsonb),
    'limit', greatest(1, least(coalesce(p_limit, 24), 100)),
    'offset', greatest(coalesce(p_offset, 0), 0),
    'hasMore', (select count(*) from group_rows) >
      greatest(coalesce(p_offset, 0), 0) + greatest(1, least(coalesce(p_limit, 24), 100))
  )
  into v_result
  from paged;

  return coalesce(v_result, jsonb_build_object(
    'groups', '[]'::jsonb,
    'limit', greatest(1, least(coalesce(p_limit, 24), 100)),
    'offset', greatest(coalesce(p_offset, 0), 0),
    'hasMore', false
  ));
end;
$$;

revoke all on function public.get_direct_store_fulfillment_groups(date, integer, integer) from public, anon;
grant execute on function public.get_direct_store_fulfillment_groups(date, integer, integer) to authenticated;

create or replace function public.release_paid_inventory_items(
  p_inventory_item_ids uuid[],
  p_expected_versions bigint[],
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
  v_now timestamptz := clock_timestamp();
  v_fp text;
  v_receipt public.inventory_command_receipts%rowtype;
  v_result jsonb;
begin
  if v_actor is null
    or p_idempotency_key is null
    or coalesce(cardinality(p_inventory_item_ids), 0) not between 1 and 100
    or cardinality(p_inventory_item_ids) <> cardinality(p_expected_versions)
    or p_inventory_item_ids is distinct from array(select x from unnest(p_inventory_item_ids) x order by x)
    or cardinality(p_inventory_item_ids) <> cardinality(array(select distinct x from unnest(p_inventory_item_ids) x))
  then
    raise exception using errcode = '22023', message = '상품 ID를 중복 없이 정렬해 최대 100개까지 요청해 주세요.';
  end if;

  v_fp := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'items', to_jsonb(p_inventory_item_ids),
    'versions', to_jsonb(p_expected_versions),
    'note', btrim(coalesce(p_note, '')),
    'flow', 'direct_store'
  ));
  select * into v_receipt
  from public.inventory_command_receipts
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'release_paid_items' or v_receipt.request_fingerprint <> v_fp then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  perform 1
  from public.inventory_item_fulfillments
  where inventory_item_id = any(p_inventory_item_ids)
  order by inventory_item_id
  for update;

  if (select count(distinct (i.origin_store_id, i.business_id))
      from public.customer_inventory_items i
      where i.id = any(p_inventory_item_ids)) <> 1 then
    raise exception using errcode = '22023', message = '한 매장의 상품만 함께 보관 처리할 수 있습니다.';
  end if;

  if exists(
    select 1
    from unnest(p_inventory_item_ids, p_expected_versions) z(id, ver)
    left join public.inventory_item_fulfillments f on f.inventory_item_id = z.id
    left join public.customer_inventory_items i on i.id = z.id
    where f.inventory_item_id is null
      or f.version <> z.ver
      or f.current_stage not in ('entitled', 'preparing', 'center_received')
      or f.outbound_released
      or f.is_blocked
      or i.ownership_status <> 'active'
      or (not public.is_owner() and not public.has_store_permission(i.origin_store_id, 'prepare_orders'))
  ) then
    raise exception using errcode = 'PT409', message = '보관 대상 상태 또는 권한이 변경되었습니다.';
  end if;

  insert into public.inventory_item_fulfillment_events(
    inventory_item_id, sequence_no, event_type, from_stage, to_stage,
    from_location_kind, to_location_kind, actor_kind, actor_user_id,
    idempotency_key, reason_code, note, metadata
  )
  select f.inventory_item_id,
    coalesce((select max(sequence_no) + 1 from public.inventory_item_fulfillment_events
      where inventory_item_id = f.inventory_item_id), 1),
    'onsite_handover', f.current_stage, 'center_stored', f.location_kind, 'center',
    'user', v_actor, p_idempotency_key, 'direct_store_release', p_note,
    jsonb_build_object('flow', 'direct_store')
  from public.inventory_item_fulfillments f
  where f.inventory_item_id = any(p_inventory_item_ids);

  update public.inventory_item_fulfillments
  set current_stage = 'center_stored',
    location_kind = 'center',
    storage_location_code = 'DIRECT_STORE',
    outbound_released = true,
    version = version + 1,
    last_event_at = v_now,
    updated_at = v_now
  where inventory_item_id = any(p_inventory_item_ids);

  update public.customer_inventory_items
  set storage_started_at = coalesce(storage_started_at, v_now),
    storage_expires_at = coalesce(storage_expires_at, v_now + make_interval(days => storage_duration_days)),
    updated_at = v_now,
    version = version + 1
  where id = any(p_inventory_item_ids);

  v_result := jsonb_build_object(
    'id', p_inventory_item_ids[1],
    'version', (select max(version) from public.inventory_item_fulfillments where inventory_item_id = any(p_inventory_item_ids)),
    'status', 'stored',
    'items', (select jsonb_agg(jsonb_build_object(
      'id', inventory_item_id, 'version', version, 'status', 'stored'
    ) order by inventory_item_id)
      from public.inventory_item_fulfillments where inventory_item_id = any(p_inventory_item_ids)),
    'idempotent_replay', false
  );
  insert into public.inventory_command_receipts
  values(v_actor, p_idempotency_key, 'release_paid_items', p_inventory_item_ids[1], v_fp, v_result, v_now);
  return v_result;
end;
$$;

create or replace function public.release_inventory_shipment_items(
  p_work_id uuid,
  p_inventory_item_ids uuid[],
  p_expected_work_version bigint,
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
  v_now timestamptz := clock_timestamp();
  v_work public.inventory_shipment_store_works%rowtype;
  v_fp text;
  v_receipt public.inventory_command_receipts%rowtype;
  v_result jsonb;
begin
  if v_actor is null
    or p_idempotency_key is null
    or coalesce(cardinality(p_inventory_item_ids), 0) not between 1 and 100
    or cardinality(p_inventory_item_ids) <> cardinality(array(select distinct x from unnest(p_inventory_item_ids) x))
  then
    raise exception using errcode = '22023', message = '보관 상품 입력값을 확인해 주세요.';
  end if;

  v_fp := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'work', p_work_id,
    'items', (select jsonb_agg(x order by x) from unnest(p_inventory_item_ids) x),
    'version', p_expected_work_version,
    'note', btrim(coalesce(p_note, '')),
    'flow', 'direct_store'
  ));
  select * into v_receipt
  from public.inventory_command_receipts
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'release_store_items' or v_receipt.request_fingerprint <> v_fp then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select * into v_work
  from public.inventory_shipment_store_works
  where id = p_work_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '매장 보관 작업을 찾지 못했습니다.';
  end if;
  if not public.is_owner() and not public.has_store_permission(v_work.origin_store_id, 'prepare_orders') then
    raise exception using errcode = '42501', message = '이 매장의 보관 처리를 할 권한이 없습니다.';
  end if;
  if v_work.status <> 'collecting' or v_work.version <> p_expected_work_version then
    raise exception using errcode = 'PT409', message = '보관 작업 상태가 변경되었습니다.';
  end if;

  perform app_private.lock_inventory_shipment(v_work.shipment_id);
  perform 1
  from public.inventory_item_fulfillments f
  join public.inventory_shipment_items x
    on x.inventory_item_id = f.inventory_item_id
    and x.shipment_id = v_work.shipment_id
    and x.origin_store_id = v_work.origin_store_id
  where x.inventory_item_id = any(p_inventory_item_ids)
  order by f.inventory_item_id
  for update of f, x;

  if (select count(*)
      from public.inventory_shipment_items x
      join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
      where x.shipment_id = v_work.shipment_id
        and x.origin_store_id = v_work.origin_store_id
        and x.inventory_item_id = any(p_inventory_item_ids)
        and x.line_status in ('requested', 'held')
        and not f.is_blocked
        and f.current_stage in ('entitled', 'preparing', 'center_received')) <> cardinality(p_inventory_item_ids)
  then
    raise exception using errcode = '55000', message = '선택한 상품 중 보관 처리할 수 없는 상품이 있습니다.';
  end if;

  insert into public.inventory_item_fulfillment_events(
    inventory_item_id, sequence_no, event_type, from_stage, to_stage,
    from_location_kind, to_location_kind, actor_kind, actor_user_id,
    idempotency_key, reason_code, note, metadata
  )
  select f.inventory_item_id,
    coalesce((select max(sequence_no) + 1 from public.inventory_item_fulfillment_events
      where inventory_item_id = f.inventory_item_id), 1),
    'onsite_handover', f.current_stage, 'center_stored', f.location_kind, 'center',
    'user', v_actor, p_idempotency_key, 'direct_store_release', p_note,
    jsonb_build_object('shipmentId', v_work.shipment_id, 'flow', 'direct_store')
  from public.inventory_item_fulfillments f
  where f.inventory_item_id = any(p_inventory_item_ids);

  update public.inventory_item_fulfillments
  set current_stage = 'center_stored',
    location_kind = 'center',
    storage_location_code = 'DIRECT_STORE',
    outbound_released = true,
    version = version + 1,
    last_event_at = v_now,
    updated_at = v_now
  where inventory_item_id = any(p_inventory_item_ids);

  update public.customer_inventory_items
  set storage_started_at = coalesce(storage_started_at, v_now),
    storage_expires_at = coalesce(storage_expires_at, v_now + make_interval(days => storage_duration_days)),
    updated_at = v_now,
    version = version + 1
  where id = any(p_inventory_item_ids);

  update public.inventory_shipment_items
  set line_status = 'ready', updated_at = v_now
  where shipment_id = v_work.shipment_id
    and inventory_item_id = any(p_inventory_item_ids);

  update public.inventory_shipment_store_works
  set status = case when not exists(
      select 1
      from public.inventory_shipment_items x
      join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
      where x.shipment_id = v_work.shipment_id
        and x.origin_store_id = v_work.origin_store_id
        and x.line_status not in ('excluded', 'cancelled')
        and not f.outbound_released
    ) then 'outbound_complete' else 'collecting' end,
    completed_at = case when not exists(
      select 1
      from public.inventory_shipment_items x
      join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
      where x.shipment_id = v_work.shipment_id
        and x.origin_store_id = v_work.origin_store_id
        and x.line_status not in ('excluded', 'cancelled')
        and not f.outbound_released
    ) then v_now end,
    completed_by = case when not exists(
      select 1
      from public.inventory_shipment_items x
      join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
      where x.shipment_id = v_work.shipment_id
        and x.origin_store_id = v_work.origin_store_id
        and x.line_status not in ('excluded', 'cancelled')
        and not f.outbound_released
    ) then v_actor end,
    version = version + 1,
    updated_at = v_now
  where id = p_work_id
  returning * into v_work;

  perform app_private.refresh_inventory_shipment_status(v_work.shipment_id, gen_random_uuid());
  insert into public.inventory_shipment_events(
    shipment_id, sequence_no, event_type, from_status, to_status,
    actor_kind, actor_user_id, idempotency_key, reason, metadata
  )
  values(
    v_work.shipment_id,
    coalesce((select max(sequence_no) + 1 from public.inventory_shipment_events
      where shipment_id = v_work.shipment_id), 1),
    'store_items_released',
    (select status from public.inventory_shipments where id = v_work.shipment_id),
    (select status from public.inventory_shipments where id = v_work.shipment_id),
    'user', v_actor, p_idempotency_key, p_note,
    jsonb_build_object('workId', p_work_id, 'itemIds', to_jsonb(p_inventory_item_ids), 'flow', 'direct_store')
  );

  v_result := jsonb_build_object(
    'id', v_work.id,
    'version', v_work.version,
    'status', v_work.status,
    'idempotent_replay', false
  );
  insert into public.inventory_command_receipts
  values(v_actor, p_idempotency_key, 'release_store_items', v_work.id, v_fp, v_result, v_now);
  return v_result;
end;
$$;

create or replace function public.get_my_inventory_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'rolloutEnabled', coalesce(bool_or(rs.unified_inventory_reads_enabled), false),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'productId', i.product_id,
      'title', p.title,
      'imageUrl', coalesce(p.image_urls[1], ''),
      'sourceKind', i.source_kind,
      'sourceReference', coalesce(i.commerce_order_item_id, i.manual_transfer_order_id, i.legacy_payment_order_id),
      'originStoreId', i.origin_store_id,
      'originStoreName', s.name,
      'ownershipStatus', i.ownership_status,
      'rolloutEnabled', rs.unified_inventory_reads_enabled,
      'itemSelectedShipmentsEnabled', rs.item_selected_shipments_enabled,
      'requestEligible', (
        rs.item_selected_shipments_enabled
        and i.ownership_status = 'active'
        and f.current_stage in ('entitled', 'preparing', 'in_transit_to_center', 'center_received', 'center_stored')
        and not f.is_blocked
        and si.shipment_id is null
        and i.legacy_commerce_shipment_id is null
      ),
      'requestBlockReason', case
        when si.shipment_id is not null or i.legacy_commerce_shipment_id is not null then 'active_shipment'
        when not rs.item_selected_shipments_enabled or i.ownership_status <> 'active' or f.is_blocked
          or f.current_stage not in ('entitled', 'preparing', 'in_transit_to_center', 'center_received', 'center_stored')
          then 'unavailable'
      end,
      'storageStartedAt', i.storage_started_at,
      'storageExpiresAt', i.storage_expires_at,
      'activeShipmentId', si.shipment_id
    ) order by i.paid_at desc, i.id), '[]'::jsonb),
    'serverTime', clock_timestamp()
  )
  from public.customer_inventory_items i
  join public.products p on p.id = i.product_id
  join public.stores s on s.id = i.origin_store_id
  join public.inventory_item_fulfillments f on f.inventory_item_id = i.id
  join public.inventory_fulfillment_rollout_settings rs on rs.business_id = i.business_id
  left join lateral (
    select x.shipment_id
    from public.inventory_shipment_items x
    where x.inventory_item_id = i.id
      and x.line_status in ('requested', 'held', 'ready', 'packed')
    limit 1
  ) si on true
  where i.member_id = auth.uid()
    and rs.unified_inventory_reads_enabled;
$$;

create or replace function public.request_inventory_shipment(
  p_inventory_item_ids uuid[],
  p_address_id uuid,
  p_settlement_method text,
  p_shipping_fee_amount bigint,
  p_bank_name_snapshot text,
  p_account_number_snapshot text,
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
  v_compatibility_center uuid;
  v_count integer;
  v_shipment uuid := gen_random_uuid();
  v_payment uuid;
  v_credit uuid;
  v_waiver uuid;
  v_method text := p_settlement_method;
  v_address jsonb;
  v_fp text;
  v_receipt public.inventory_command_receipts%rowtype;
  v_status text := 'collecting';
  v_shipment_version bigint;
  v_result jsonb;
  v_config_fee bigint;
  v_config_bank text;
  v_config_account text;
begin
  if v_actor is null or not public.is_member() then
    raise exception using errcode = '42501', message = '구매자 로그인이 필요합니다.';
  end if;
  if p_idempotency_key is null
    or coalesce(cardinality(p_inventory_item_ids), 0) not between 1 and 100
    or p_settlement_method not in ('shipping_credit', 'manual_transfer', 'waiver')
  then
    raise exception using errcode = '22023', message = '배송 신청 입력값을 확인해 주세요.';
  end if;
  if cardinality(p_inventory_item_ids) <> cardinality(array(select distinct x from unnest(p_inventory_item_ids) x)) then
    raise exception using errcode = '22023', message = '중복 상품을 선택할 수 없습니다.';
  end if;

  v_fp := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'items', (select jsonb_agg(x order by x) from unnest(p_inventory_item_ids) x),
    'address', p_address_id,
    'method', p_settlement_method,
    'flow', 'direct_store'
  ));
  select * into v_receipt
  from public.inventory_command_receipts
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'request_shipment' or v_receipt.request_fingerprint <> v_fp then
      raise exception using errcode = '23505', message = '동일한 요청 키를 다른 배송 신청에 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  perform 1
  from public.customer_inventory_items
  where id = any(p_inventory_item_ids)
  order by id
  for update;

  select member_id, business_id, fulfillment_center_id
  into v_member, v_business, v_compatibility_center
  from public.customer_inventory_items
  where id = any(p_inventory_item_ids)
  order by id
  limit 1;
  select count(*) into v_count
  from public.customer_inventory_items
  where id = any(p_inventory_item_ids);

  if v_count <> cardinality(p_inventory_item_ids)
    or v_member is distinct from v_actor
    or exists(
      select 1
      from public.customer_inventory_items
      where id = any(p_inventory_item_ids)
        and (member_id <> v_actor or business_id <> v_business or ownership_status <> 'active')
    )
  then
    raise exception using errcode = '42501', message = '선택한 상품의 소유권이 일치하지 않습니다.';
  end if;

  if exists(
    select 1
    from public.customer_inventory_items i
    where i.id = any(p_inventory_item_ids)
      and (i.legacy_commerce_shipment_id is not null or exists(
        select 1 from public.commerce_shipment_items csi where csi.order_item_id = i.commerce_order_item_id
      ))
  ) then
    raise exception using errcode = '55000', message = '기존 배송에 포함된 상품은 다시 신청할 수 없습니다.';
  end if;
  if not exists(
    select 1
    from public.inventory_fulfillment_rollout_settings
    where business_id = v_business and item_selected_shipments_enabled
  ) then
    raise exception using errcode = '55000', message = '선택 배송 기능이 아직 활성화되지 않았습니다.';
  end if;
  if v_compatibility_center is null or exists(
    select 1
    from public.inventory_item_fulfillments
    where inventory_item_id = any(p_inventory_item_ids)
      and (current_stage not in ('entitled', 'preparing', 'in_transit_to_center', 'center_received', 'center_stored') or is_blocked)
  ) then
    raise exception using errcode = '55000', message = '현재 배송을 신청할 수 없는 상품이 포함되어 있습니다.';
  end if;

  select jsonb_build_object(
    'recipientName', recipient_name,
    'phone', phone,
    'postalCode', postal_code,
    'address', address,
    'label', label
  )
  into v_address
  from public.shipping_addresses
  where id = p_address_id and member_id = v_actor;
  if v_address is null then
    raise exception using errcode = 'P0002', message = '배송지를 찾지 못했습니다.';
  end if;

  select id into v_waiver
  from public.shipping_fee_waiver_entitlements
  where member_id = v_actor and business_id = v_business and status = 'available'
  order by created_at, id
  limit 1
  for update skip locked;
  if v_waiver is not null then v_method := 'waiver'; end if;

  if v_method = 'manual_transfer' then
    select shipping_fee_amount into v_config_fee
    from public.inventory_fulfillment_rollout_settings
    where business_id = v_business;
    select bank_name, account_number into v_config_bank, v_config_account
    from public.payment_runtime_settings
    where singleton and active_mode = 'manual_transfer';
    if v_config_fee is null
      or nullif(btrim(coalesce(v_config_bank, '')), '') is null
      or nullif(btrim(coalesce(v_config_account, '')), '') is null
    then
      raise exception using errcode = '55000', message = '현재 운영 배송비 또는 입금 계좌가 설정되지 않았습니다.';
    end if;
    insert into public.shipping_fee_payments(
      member_id, business_id, expected_amount, bank_name_snapshot, account_number_snapshot
    ) values(v_actor, v_business, v_config_fee, btrim(v_config_bank), btrim(v_config_account))
    returning id into v_payment;
  elsif v_method = 'shipping_credit' then
    update public.member_accounts
    set shipping_credit_count = shipping_credit_count - 1, updated_at = clock_timestamp()
    where member_id = v_actor and shipping_credit_count > 0;
    if not found then
      raise exception using errcode = '55000', message = '사용 가능한 배송권이 없습니다.';
    end if;
    insert into public.shipping_credit_ledger(member_id, business_id, delta, reason, created_by)
    values(v_actor, v_business, -1, 'used', v_actor)
    returning id into v_credit;
  else
    if v_waiver is null then
      raise exception using errcode = '55000', message = '사용 가능한 무료 배송 권한이 없습니다.';
    end if;
  end if;

  insert into public.inventory_shipments(
    id, member_id, business_id, fulfillment_center_id, status, settlement_method,
    shipping_fee_payment_id, shipping_credit_ledger_id, shipping_fee_waiver_id,
    address_id, address_snapshot
  ) values(
    v_shipment, v_actor, v_business, v_compatibility_center, 'collecting', v_method,
    v_payment, v_credit, v_waiver, p_address_id, v_address
  );
  if v_payment is not null then
    update public.shipping_fee_payments set inventory_shipment_id = v_shipment where id = v_payment;
  end if;
  if v_credit is not null then
    update public.shipping_credit_ledger set inventory_shipment_id = v_shipment where id = v_credit;
  end if;
  if v_waiver is not null then
    update public.shipping_fee_waiver_entitlements
    set status = 'consumed', consumed_shipment_id = v_shipment, consumed_at = clock_timestamp()
    where id = v_waiver;
  end if;

  insert into public.inventory_shipment_items(
    shipment_id, inventory_item_id, member_id, business_id, fulfillment_center_id,
    product_id, origin_store_id, line_status
  )
  select v_shipment, i.id, i.member_id, i.business_id, v_compatibility_center,
    i.product_id, i.origin_store_id,
    case when f.outbound_released and not f.is_blocked then 'ready' else 'requested' end
  from public.customer_inventory_items i
  join public.inventory_item_fulfillments f on f.inventory_item_id = i.id
  where i.id = any(p_inventory_item_ids)
  order by i.id;

  insert into public.inventory_shipment_store_works(
    shipment_id, business_id, origin_store_id, fulfillment_center_id, route_mode,
    status, completed_at, completed_by
  )
  select v_shipment, i.business_id, i.origin_store_id, v_compatibility_center, 'co_located',
    case when bool_and(f.outbound_released and not f.is_blocked) then 'outbound_complete' else 'collecting' end,
    case when bool_and(f.outbound_released and not f.is_blocked) then clock_timestamp() end,
    case when bool_and(f.outbound_released and not f.is_blocked) then v_actor end
  from public.customer_inventory_items i
  join public.inventory_item_fulfillments f on f.inventory_item_id = i.id
  where i.id = any(p_inventory_item_ids)
  group by i.business_id, i.origin_store_id;

  insert into public.inventory_shipment_events(
    shipment_id, sequence_no, event_type, to_status, actor_kind,
    actor_user_id, idempotency_key, metadata
  ) values(
    v_shipment, 1, 'requested', 'collecting', 'user',
    v_actor, p_idempotency_key,
    jsonb_build_object(
      'itemCount', v_count,
      'storeCount', (select count(distinct origin_store_id)
        from public.customer_inventory_items where id = any(p_inventory_item_ids)),
      'flow', 'direct_store'
    )
  );
  perform app_private.lock_inventory_shipment(v_shipment);
  perform app_private.refresh_inventory_shipment_status(v_shipment, gen_random_uuid());
  select status, version into v_status, v_shipment_version
  from public.inventory_shipments
  where id = v_shipment;

  v_result := jsonb_build_object(
    'shipment_id', v_shipment,
    'status', v_status,
    'version', v_shipment_version,
    'settlement_method', v_method,
    'payment', case when v_payment is null then null else jsonb_build_object(
      'id', v_payment,
      'expected_amount', v_config_fee,
      'status', 'awaiting_transfer',
      'bank_name_snapshot', v_config_bank,
      'account_number_snapshot', v_config_account
    ) end,
    'idempotent_replay', false
  );
  insert into public.inventory_command_receipts
  values(v_actor, p_idempotency_key, 'request_shipment', v_shipment, v_fp, v_result, clock_timestamp());
  return v_result;
end;
$$;

create or replace function public.get_inventory_shipment_queue(
  p_include_shipped boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
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
  if not public.can_view_shared_fulfillment() then
    raise exception using errcode = '42501', message = '택배 신청 조회 권한이 없습니다.';
  end if;

  select jsonb_build_object('shipments', coalesce(jsonb_agg(jsonb_build_object(
    'id', sh.id,
    'memberId', sh.member_id,
    'memberName', pf.display_name,
    'businessId', sh.business_id,
    'status', sh.status,
    'version', sh.version,
    'settlementMethod', sh.settlement_method,
    'shippingFeeStatus', case when sh.settlement_method = 'manual_transfer' then fp.status else 'confirmed' end,
    'requestedAt', sh.created_at,
    'packedAt', sh.packed_at,
    'shippedAt', sh.shipped_at,
    'courier', sh.courier,
    'trackingNumber', sh.tracking_number,
    'addressSnapshot', sh.address_snapshot,
    'itemCount', (select count(*) from public.inventory_shipment_items x where x.shipment_id = sh.id),
    'activeItemCount', (select count(*) from public.inventory_shipment_items x
      where x.shipment_id = sh.id and x.line_status not in ('excluded', 'cancelled')),
    'releasedItemCount', (select count(*) from public.inventory_shipment_items x
      join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
      where x.shipment_id = sh.id and x.line_status not in ('excluded', 'cancelled') and f.outbound_released),
    'unreleasedItemCount', (select count(*) from public.inventory_shipment_items x
      join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
      where x.shipment_id = sh.id and x.line_status not in ('excluded', 'cancelled') and not f.outbound_released),
    'heldItemCount', (select count(*) from public.inventory_shipment_items x
      where x.shipment_id = sh.id and x.line_status = 'held'),
    'storeWorks', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'storeId', w.origin_store_id, 'storeName', s.name,
      'status', w.status, 'version', w.version
    ) order by s.name, w.origin_store_id), '[]'::jsonb)
      from public.inventory_shipment_store_works w
      join public.stores s on s.id = w.origin_store_id
      where w.shipment_id = sh.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', x.inventory_item_id,
      'productId', x.product_id,
      'title', p.title,
      'imageUrl', coalesce(p.image_urls[1], ''),
      'lineStatus', x.line_status,
      'released', f.outbound_released,
      'originStoreId', x.origin_store_id,
      'originStoreName', s.name,
      'isBlocked', f.is_blocked
    ) order by s.name, x.created_at, x.inventory_item_id), '[]'::jsonb)
      from public.inventory_shipment_items x
      join public.products p on p.id = x.product_id
      join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
      join public.stores s on s.id = x.origin_store_id
      where x.shipment_id = sh.id)
  ) order by sh.created_at desc, sh.id desc), '[]'::jsonb))
  into v_result
  from (
    select *
    from public.inventory_shipments
    where p_include_shipped or status <> 'shipped'
    order by created_at desc, id desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(coalesce(p_offset, 0), 0)
  ) sh
  join public.profiles pf on pf.id = sh.member_id
  left join public.shipping_fee_payments fp on fp.id = sh.shipping_fee_payment_id;

  return coalesce(v_result, jsonb_build_object('shipments', '[]'::jsonb));
end;
$$;

create or replace function public.pack_inventory_shipment(
  p_shipment_id uuid,
  p_expected_version bigint,
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
  v_blocked jsonb;
begin
  if v_actor is null or p_idempotency_key is null or not public.can_view_shared_fulfillment() then
    raise exception using errcode = '42501', message = '택배 포장 권한이 필요합니다.';
  end if;
  v_fp := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'shipment', p_shipment_id, 'version', p_expected_version,
    'note', btrim(coalesce(p_note, '')), 'flow', 'direct_store'
  ));
  select * into v_receipt
  from public.inventory_command_receipts
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'pack_shipment' or v_receipt.request_fingerprint <> v_fp then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  perform app_private.lock_inventory_shipment(p_shipment_id);
  select * into v_sh from public.inventory_shipments where id = p_shipment_id for update;
  if not found then raise exception using errcode = 'P0002', message = '배송 신청을 찾지 못했습니다.'; end if;
  if v_sh.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = '배송 상태가 변경되었습니다.';
  end if;

  perform 1
  from public.inventory_item_fulfillments f
  join public.inventory_shipment_items x on x.inventory_item_id = f.inventory_item_id
  where x.shipment_id = v_sh.id
  order by f.inventory_item_id
  for update of f, x;

  select coalesce(jsonb_agg(inventory_item_id order by inventory_item_id), '[]'::jsonb)
  into v_blocked
  from (
    select distinct x.inventory_item_id
    from public.inventory_shipment_items x
    join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
    where x.shipment_id = v_sh.id
      and x.line_status not in ('excluded', 'cancelled')
      and (x.line_status <> 'ready' or not f.outbound_released or f.is_blocked
        or exists(select 1 from public.inventory_exception_cases e
          where e.inventory_item_id = x.inventory_item_id and e.status = 'open')
        or exists(select 1 from public.inventory_shipment_store_works w
          where w.shipment_id = x.shipment_id and w.origin_store_id = x.origin_store_id
            and w.status <> 'outbound_complete'))
  ) blocked;

  if v_sh.status <> 'ready_to_pack'
    or (v_sh.settlement_method = 'manual_transfer' and not exists(
      select 1 from public.shipping_fee_payments
      where id = v_sh.shipping_fee_payment_id and status = 'confirmed'
    ))
    or not exists(select 1 from public.inventory_shipment_items
      where shipment_id = v_sh.id and line_status not in ('excluded', 'cancelled'))
    or jsonb_array_length(v_blocked) > 0
    or exists(select 1 from public.inventory_shipment_store_works
      where shipment_id = v_sh.id and status <> 'outbound_complete')
  then
    raise exception using errcode = '55000', message = '미 출고된 상품이 존재합니다',
      detail = jsonb_build_object('code', 'UNRELEASED_ITEMS', 'blockedItemIds', v_blocked)::text;
  end if;

  update public.inventory_shipment_items
  set line_status = 'packed', updated_at = clock_timestamp()
  where shipment_id = v_sh.id and line_status = 'ready';
  update public.inventory_item_fulfillments f
  set current_stage = 'packed', storage_location_code = null, version = version + 1,
    last_event_at = clock_timestamp(), updated_at = clock_timestamp()
  from public.inventory_shipment_items x
  where x.shipment_id = v_sh.id and x.inventory_item_id = f.inventory_item_id and x.line_status = 'packed';
  update public.inventory_shipments
  set status = 'packed', packed_at = clock_timestamp(), packed_by = v_actor,
    version = version + 1, updated_at = clock_timestamp()
  where id = v_sh.id
  returning * into v_sh;
  insert into public.inventory_shipment_events(
    shipment_id, sequence_no, event_type, from_status, to_status,
    actor_kind, actor_user_id, idempotency_key, reason
  ) values(
    v_sh.id,
    coalesce((select max(sequence_no) + 1 from public.inventory_shipment_events where shipment_id = v_sh.id), 1),
    'packed', 'ready_to_pack', 'packed', 'user', v_actor, p_idempotency_key, p_note
  );
  v_result := jsonb_build_object(
    'id', v_sh.id, 'version', v_sh.version, 'status', v_sh.status, 'idempotent_replay', false
  );
  insert into public.inventory_command_receipts
  values(v_actor, p_idempotency_key, 'pack_shipment', v_sh.id, v_fp, v_result, clock_timestamp());
  return v_result;
end;
$$;

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
    'shipment', p_shipment_id, 'version', p_expected_version,
    'courier', btrim(p_courier), 'tracking', btrim(p_tracking_number),
    'note', btrim(coalesce(p_note, '')), 'flow', 'direct_store'
  ));
  select * into v_receipt
  from public.inventory_command_receipts
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'ship_shipment' or v_receipt.request_fingerprint <> v_fp then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  perform app_private.lock_inventory_shipment(p_shipment_id);
  select * into v_sh from public.inventory_shipments where id = p_shipment_id for update;
  if not found then raise exception using errcode = 'P0002', message = '배송 신청을 찾지 못했습니다.'; end if;
  if v_sh.version <> p_expected_version or v_sh.status <> 'packed' then
    raise exception using errcode = 'PT409', message = '포장 상태가 변경되었습니다.';
  end if;
  if exists(
    select 1
    from public.inventory_shipment_items x
    join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
    where x.shipment_id = v_sh.id and x.line_status = 'packed'
      and (f.is_blocked or exists(select 1 from public.inventory_exception_cases e
        where e.inventory_item_id = x.inventory_item_id and e.status = 'open'))
  ) then
    raise exception using errcode = '55000', message = '미 출고된 상품이 존재합니다';
  end if;

  update public.inventory_shipment_items
  set line_status = 'shipped', updated_at = clock_timestamp()
  where shipment_id = v_sh.id and line_status = 'packed';
  update public.inventory_item_fulfillments f
  set current_stage = 'shipped', location_kind = 'transit', version = version + 1,
    last_event_at = clock_timestamp(), updated_at = clock_timestamp()
  from public.inventory_shipment_items x
  where x.shipment_id = v_sh.id and x.inventory_item_id = f.inventory_item_id and x.line_status = 'shipped';
  update public.inventory_shipments
  set status = 'shipped', courier = btrim(p_courier), tracking_number = btrim(p_tracking_number),
    shipped_at = clock_timestamp(), shipped_by = v_actor, version = version + 1,
    updated_at = clock_timestamp()
  where id = v_sh.id
  returning * into v_sh;
  insert into public.inventory_shipment_events(
    shipment_id, sequence_no, event_type, from_status, to_status,
    actor_kind, actor_user_id, idempotency_key, reason
  ) values(
    v_sh.id,
    coalesce((select max(sequence_no) + 1 from public.inventory_shipment_events where shipment_id = v_sh.id), 1),
    'shipped', 'packed', 'shipped', 'user', v_actor, p_idempotency_key, p_note
  );
  v_result := jsonb_build_object(
    'id', v_sh.id, 'version', v_sh.version, 'status', v_sh.status, 'idempotent_replay', false
  );
  insert into public.inventory_command_receipts
  values(v_actor, p_idempotency_key, 'ship_shipment', v_sh.id, v_fp, v_result, clock_timestamp());
  return v_result;
end;
$$;

create or replace function public.get_my_inventory_shipments()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with v2 as (
  select sh.created_at as requested_at, jsonb_build_object(
    'id', sh.id,
    'sourceKind', 'inventory_v2',
    'sourceId', sh.id,
    'settlementMethod', sh.settlement_method,
    'shippingFeeStatus', case when sh.settlement_method = 'manual_transfer' then fp.status else 'confirmed' end,
    'itemCount', (select count(*) from public.inventory_shipment_items where shipment_id = sh.id),
    'activeItemCount', (select count(*) from public.inventory_shipment_items
      where shipment_id = sh.id and line_status not in ('excluded', 'cancelled')),
    'courier', sh.courier,
    'trackingNumber', sh.tracking_number,
    'trackingUrl', case when lower(coalesce(sh.courier, '')) like '%cj%'
      and sh.tracking_number ~ '^[0-9-]+$'
      then 'https://trace.cjlogistics.com/next/tracking.html?wblNo=' || sh.tracking_number end,
    'requestedAt', sh.created_at,
    'addressSnapshot', sh.address_snapshot,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', x.inventory_item_id,
      'productId', x.product_id,
      'title', p.title,
      'imageUrl', coalesce(p.image_urls[1], '')
    ) order by x.created_at, x.inventory_item_id), '[]'::jsonb)
      from public.inventory_shipment_items x
      join public.products p on p.id = x.product_id
      where x.shipment_id = sh.id)
  ) as payload
  from public.inventory_shipments sh
  left join public.shipping_fee_payments fp on fp.id = sh.shipping_fee_payment_id
  where sh.member_id = auth.uid()
    and exists(select 1 from public.inventory_fulfillment_rollout_settings rs
      where rs.business_id = sh.business_id and rs.unified_inventory_reads_enabled)
),
legacy as (
  select sh.created_at as requested_at, jsonb_build_object(
    'id', sh.id,
    'sourceKind', 'canonical_commerce',
    'sourceId', sh.id,
    'settlementMethod', sh.settlement_method,
    'shippingFeeStatus', case when sh.settlement_method = 'manual_transfer' then fp.status else 'confirmed' end,
    'itemCount', (select count(*) from public.commerce_shipment_items where shipment_id = sh.id),
    'activeItemCount', (select count(*) from public.commerce_shipment_items where shipment_id = sh.id),
    'courier', sh.courier,
    'trackingNumber', sh.tracking_number,
    'trackingUrl', case when lower(coalesce(sh.courier, '')) like '%cj%'
      and sh.tracking_number ~ '^[0-9-]+$'
      then 'https://trace.cjlogistics.com/next/tracking.html?wblNo=' || sh.tracking_number end,
    'requestedAt', sh.created_at,
    'addressSnapshot', sh.address_snapshot,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', ci.id,
      'productId', x.product_id,
      'title', p.title,
      'imageUrl', coalesce(p.image_urls[1], '')
    ) order by x.order_item_id), '[]'::jsonb)
      from public.commerce_shipment_items x
      join public.products p on p.id = x.product_id
      left join public.customer_inventory_items ci on ci.commerce_order_item_id = x.order_item_id
      where x.shipment_id = sh.id)
  ) as payload
  from public.commerce_shipments sh
  left join public.shipping_fee_payments fp on fp.id = sh.shipping_fee_payment_id
  where sh.member_id = auth.uid()
)
select jsonb_build_object(
  'shipments', coalesce(jsonb_agg(payload order by requested_at desc), '[]'::jsonb)
)
from (select * from v2 union all select * from legacy) all_shipments;
$$;

-- Normalize already-released rows created by the retired center intake flow.
-- This is a one-time cutover: released store goods become stored goods and any
-- waiting shipment line becomes ready without requiring a center confirmation.
do $$
declare
  v_now timestamptz := clock_timestamp();
  v_owner uuid;
  v_shipment uuid;
begin
  select r.user_id into v_owner
  from public.account_access_roles r
  where r.role_code = 'owner'
  order by r.created_at, r.user_id
  limit 1;

  insert into public.inventory_item_fulfillment_events(
    inventory_item_id, sequence_no, event_type, from_stage, to_stage,
    from_location_kind, to_location_kind, actor_kind, idempotency_key,
    reason_code, metadata
  )
  select f.inventory_item_id,
    coalesce((select max(sequence_no) + 1 from public.inventory_item_fulfillment_events
      where inventory_item_id = f.inventory_item_id), 1),
    'onsite_handover', f.current_stage, 'center_stored', f.location_kind, 'center',
    'migration', gen_random_uuid(), 'direct_store_cutover',
    jsonb_build_object('flow', 'direct_store')
  from public.inventory_item_fulfillments f
  where f.outbound_released
    and f.current_stage in ('in_transit_to_center', 'center_received');

  update public.inventory_item_fulfillments
  set current_stage = 'center_stored',
    location_kind = 'center',
    storage_location_code = 'DIRECT_STORE',
    version = version + 1,
    last_event_at = v_now,
    updated_at = v_now
  where outbound_released
    and current_stage in ('in_transit_to_center', 'center_received');

  update public.customer_inventory_items i
  set storage_started_at = v_now,
    storage_expires_at = v_now + make_interval(days => i.storage_duration_days),
    version = version + 1,
    updated_at = v_now
  where i.storage_started_at is null
    and exists(
      select 1
      from public.inventory_item_fulfillments f
      where f.inventory_item_id = i.id
        and f.current_stage = 'center_stored'
        and f.outbound_released
    );

  update public.inventory_shipment_items x
  set line_status = 'ready', updated_at = v_now
  from public.inventory_item_fulfillments f
  where f.inventory_item_id = x.inventory_item_id
    and x.line_status = 'requested'
    and f.outbound_released
    and not f.is_blocked;

  if v_owner is not null then
    update public.inventory_shipment_store_works w
    set status = 'outbound_complete',
      completed_at = v_now,
      completed_by = v_owner,
      version = version + 1,
      updated_at = v_now
    where w.status = 'collecting'
      and not exists(
        select 1
        from public.inventory_shipment_items x
        join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
        where x.shipment_id = w.shipment_id
          and x.origin_store_id = w.origin_store_id
          and x.line_status not in ('excluded', 'cancelled')
          and not f.outbound_released
      );
  end if;

  for v_shipment in
    select id
    from public.inventory_shipments
    where status in ('requested', 'collecting', 'ready_to_pack', 'reconciliation_required')
    order by id
  loop
    perform app_private.lock_inventory_shipment(v_shipment);
    perform app_private.refresh_inventory_shipment_status(v_shipment, gen_random_uuid());
  end loop;
end;
$$;

revoke all on function public.release_paid_inventory_items(uuid[], bigint[], uuid, text) from public, anon, authenticated;
revoke all on function public.release_inventory_shipment_items(uuid, uuid[], bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.get_my_inventory_overview() from public, anon;
revoke all on function public.request_inventory_shipment(uuid[], uuid, text, bigint, text, text, uuid) from public, anon;
revoke all on function public.get_inventory_shipment_queue(boolean, integer, integer) from public, anon;
revoke all on function public.pack_inventory_shipment(uuid, bigint, uuid, text) from public, anon;
revoke all on function public.ship_inventory_shipment(uuid, bigint, text, text, uuid, text) from public, anon;
revoke all on function public.get_my_inventory_shipments() from public, anon;

grant execute on function public.get_my_inventory_overview() to authenticated;
grant execute on function public.request_inventory_shipment(uuid[], uuid, text, bigint, text, text, uuid) to authenticated;
grant execute on function public.get_inventory_shipment_queue(boolean, integer, integer) to authenticated;
grant execute on function public.pack_inventory_shipment(uuid, bigint, uuid, text) to authenticated;
grant execute on function public.ship_inventory_shipment(uuid, bigint, text, text, uuid, text) to authenticated;
grant execute on function public.get_my_inventory_shipments() to authenticated;

-- Public mutation entry points remain buyer-grouped wrappers. They now invoke
-- the direct-store implementations above; center intake/storage RPCs are no
-- longer granted to application users.
grant execute on function public.release_buyer_paid_inventory_items(uuid[], bigint[], uuid, text) to authenticated;
grant execute on function public.release_buyer_inventory_shipment_items(uuid, uuid[], bigint, uuid, text) to authenticated;
revoke all on function public.record_buyer_inventory_center_items(text, uuid[], bigint[], text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_inventory_center_items(text, uuid[], bigint[], text, uuid, text)
  from public, anon, authenticated;

-- Retire the old center topology administration surface. Compatibility tables
-- remain service-maintained until historical rows can be migrated away.
revoke all on function public.get_my_center_management() from public, anon, authenticated;
revoke all on function public.get_owner_inventory_fulfillment_configuration() from public, anon, authenticated;
revoke all on function public.configure_managed_fulfillment_center(
  text, uuid, text, text, boolean, text, text, text, text, text, bigint, uuid
) from public, anon, authenticated;
revoke all on function public.configure_assigned_fulfillment_center(
  text, uuid, text, text, boolean, text, text, text, text, text, bigint
) from public, anon, authenticated;
revoke all on function public.configure_fulfillment_center_staff_assignment(
  uuid, uuid, boolean, boolean, text, bigint, uuid
) from public, anon, authenticated;
revoke all on function public.delete_fulfillment_center_staff_assignment(
  uuid, uuid, bigint, uuid
) from public, anon, authenticated;
revoke all on function public.configure_store_fulfillment_route(
  uuid, uuid, text, bigint, uuid, text
) from public, anon, authenticated;
