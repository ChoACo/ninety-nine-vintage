begin;

set local lock_timeout = '5s';

lock table
  public.commerce_orders,
  public.commerce_order_items,
  public.commerce_order_transfers,
  public.manual_transfer_payment_ledger,
  public.shipping_requests,
  public.shipping_request_items,
  public.shipping_fee_payments,
  public.shipping_credit_ledger,
  public.store_fulfillment_works,
  public.order_item_fulfillments,
  public.fulfillment_events,
  public.fulfillment_command_receipts,
  public.commerce_shipments,
  public.commerce_shipment_orders,
  public.commerce_shipment_items,
  public.commerce_shipment_events
in share row exclusive mode;

-- Store work is complete after central receipt. Later packing and dispatch are
-- central shipment facts and must never make the store projection regress.
create or replace function app_private.fulfillment_work_status(
  p_work_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with item_state as (
    select
      count(*) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as active_count,
      bool_or(
        fulfillment.current_stage = 'reconciliation_required'
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as has_reconciliation,
      bool_or(fulfillment.is_blocked) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as has_block,
      bool_and(
        fulfillment.current_stage in (
          'center_received', 'center_stored', 'packed', 'shipped'
        )
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as all_center_complete,
      bool_or(
        fulfillment.current_stage in (
          'center_received', 'center_stored', 'packed', 'shipped'
        )
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as any_center_complete,
      bool_and(
        fulfillment.current_stage = 'in_transit_to_center'
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as all_transit,
      bool_and(
        fulfillment.current_stage = 'ready_for_transfer'
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as all_ready,
      bool_and(
        fulfillment.current_stage = 'waiting_payment'
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as all_waiting
    from public.order_item_fulfillments as fulfillment
    where fulfillment.work_id = p_work_id
  )
  select case
    when active_count = 0 then 'cancelled'
    when coalesce(has_reconciliation, false) then 'reconciliation_required'
    when coalesce(has_block, false) then 'issue'
    when coalesce(all_center_complete, false) then 'center_received'
    when coalesce(any_center_complete, false) then 'partially_received'
    when coalesce(all_transit, false) then 'in_transit_to_center'
    when coalesce(all_ready, false) then 'ready_for_transfer'
    when coalesce(all_waiting, false) then 'waiting_payment'
    else 'preparing'
  end
  from item_state;
$$;

revoke all on function app_private.fulfillment_work_status(uuid)
from public, anon, authenticated, service_role;

create or replace function app_private.commerce_shipment_gate(
  p_shipment_id uuid,
  p_expected_item_stage text
)
returns table (
  gate_status text,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shipment public.commerce_shipments%rowtype;
  v_payment public.shipping_fee_payments%rowtype;
  v_received bigint;
begin
  if p_shipment_id is null
    or p_expected_item_stage is null
    or p_expected_item_stage not in ('center_stored', 'packed')
  then
    return query select 'reconciliation_required', 'invalid_gate_request';
    return;
  end if;

  select shipments.* into v_shipment
  from public.commerce_shipments as shipments
  where shipments.id = p_shipment_id;
  if not found then
    return query select 'reconciliation_required', 'shipment_missing';
    return;
  end if;

  if v_shipment.status = 'shipped' then
    begin
      perform app_private.validate_commerce_shipment_manifest(p_shipment_id);
    exception when integrity_constraint_violation then
      return query select 'reconciliation_required', 'manifest_mismatch';
      return;
    end;
    return query select 'shipped', null::text;
    return;
  elsif v_shipment.status = 'cancelled' then
    return query select 'cancelled', 'shipment_cancelled';
    return;
  elsif v_shipment.status = 'reconciliation_required' then
    return query select 'reconciliation_required', 'shipment_reconciliation_required';
    return;
  elsif p_expected_item_stage = 'center_stored'
    and v_shipment.status <> 'requested'
  then
    return query select 'reconciliation_required', 'shipment_not_requestable';
    return;
  elsif p_expected_item_stage = 'packed'
    and v_shipment.status <> 'packed'
  then
    return query select 'reconciliation_required', 'shipment_not_packed';
    return;
  end if;

  if (select count(*) from public.commerce_shipment_orders as shipment_orders
      where shipment_orders.shipment_id = p_shipment_id) <> 1
    or not exists (
      select 1
      from public.commerce_shipment_items as shipment_items
      where shipment_items.shipment_id = p_shipment_id
    )
  then
    return query select 'reconciliation_required', 'manifest_missing';
    return;
  end if;

  begin
    perform app_private.validate_commerce_shipment_manifest(p_shipment_id);
  exception when integrity_constraint_violation then
    return query select 'reconciliation_required', 'manifest_mismatch';
    return;
  end;

  if exists (
    select 1
    from public.commerce_shipment_orders as shipment_orders
    join public.commerce_orders as orders
      on orders.id = shipment_orders.order_id
    where shipment_orders.shipment_id = p_shipment_id
      and (
        orders.member_id <> v_shipment.member_id
        or orders.status <> 'paid'
        or not exists (
          select 1
          from public.commerce_order_transfers as transfers
          where transfers.order_id = orders.id
            and transfers.member_id = orders.member_id
            and transfers.expected_amount = orders.total
            and transfers.status = 'confirmed'
            and (
              select coalesce(sum(
                case
                  when ledger.entry_type = 'receipt' then ledger.amount
                  else -ledger.amount
                end
              ), 0)::bigint
              from public.manual_transfer_payment_ledger as ledger
              where ledger.commerce_order_transfer_id = transfers.id
            ) = transfers.expected_amount
        )
      )
  ) or exists (
    select 1
    from public.commerce_shipment_items as shipment_items
    join public.commerce_order_items as order_items
      on order_items.id = shipment_items.order_item_id
    where shipment_items.shipment_id = p_shipment_id
      and order_items.payment_status <> 'paid'
  ) then
    return query select 'awaiting_payment', 'order_payment_not_confirmed';
    return;
  end if;

  if v_shipment.settlement_method = 'shipping_credit' then
    if not exists (
      select 1
      from public.shipping_credit_ledger as credits
      where credits.id = v_shipment.shipping_credit_ledger_id
        and credits.member_id = v_shipment.member_id
        and credits.shipping_request_id = v_shipment.shipping_request_id
        and credits.reason = 'used'
        and credits.delta = -1
    ) or (
      select count(*)
      from public.shipping_credit_ledger as credits
      where credits.member_id = v_shipment.member_id
        and credits.shipping_request_id = v_shipment.shipping_request_id
        and credits.reason = 'used'
        and credits.delta = -1
    ) <> 1 or exists (
      select 1
      from public.shipping_fee_payments as payments
      where payments.member_id = v_shipment.member_id
        and payments.shipping_request_id = v_shipment.shipping_request_id
    ) then
      return query select 'awaiting_payment', 'shipping_credit_not_settled';
      return;
    end if;
  else
    select payments.* into v_payment
    from public.shipping_fee_payments as payments
    where payments.id = v_shipment.shipping_fee_payment_id
      and payments.member_id = v_shipment.member_id
      and payments.shipping_request_id = v_shipment.shipping_request_id;

    if not found
      or v_payment.status <> 'confirmed'
      or v_payment.confirmed_at is null
      or v_payment.confirmed_by is null
      or (
        select count(*)
        from public.shipping_fee_payments as payments
        where payments.member_id = v_shipment.member_id
          and payments.shipping_request_id = v_shipment.shipping_request_id
      ) <> 1
      or exists (
        select 1
        from public.shipping_credit_ledger as credits
        where credits.member_id = v_shipment.member_id
          and credits.shipping_request_id = v_shipment.shipping_request_id
      )
    then
      return query select 'awaiting_payment', 'shipping_fee_not_confirmed';
      return;
    end if;

    select coalesce(sum(
      case
        when ledger.entry_type = 'receipt' then ledger.amount
        else -ledger.amount
      end
    ), 0)::bigint
    into v_received
    from public.manual_transfer_payment_ledger as ledger
    where ledger.shipping_fee_payment_id = v_payment.id;
    if v_received <> v_payment.expected_amount then
      return query select 'awaiting_payment', 'shipping_fee_ledger_mismatch';
      return;
    end if;
  end if;

  if not exists (
    select 1
    from public.fulfillment_centers as centers
    where centers.id = v_shipment.fulfillment_center_id
      and centers.business_id = v_shipment.business_id
      and centers.status = 'active'
  ) or not exists (
    select 1
    from public.businesses as businesses
    where businesses.id = v_shipment.business_id
      and businesses.status = 'active'
  ) then
    return query select 'awaiting_center', 'fulfillment_center_not_active';
    return;
  end if;

  if exists (
    select 1
    from public.commerce_shipment_items as shipment_items
    join public.order_item_fulfillments as fulfillment
      on fulfillment.order_item_id = shipment_items.order_item_id
    where shipment_items.shipment_id = p_shipment_id
      and (
        fulfillment.business_id <> v_shipment.business_id
        or fulfillment.fulfillment_center_id <> v_shipment.fulfillment_center_id
        or fulfillment.current_stage <> p_expected_item_stage
        or fulfillment.location_kind <> 'center'
        or fulfillment.is_blocked
        or (
          p_expected_item_stage = 'center_stored'
          and fulfillment.storage_location_code is null
        )
        or (
          p_expected_item_stage = 'packed'
          and fulfillment.storage_location_code is not null
        )
      )
  ) then
    return query select 'awaiting_center', case
      when p_expected_item_stage = 'packed' then 'packed_manifest_changed'
      else 'all_items_not_stored_at_center'
    end;
    return;
  end if;

  if exists (
    select 1
    from public.commerce_shipment_orders as shipment_orders
    join public.store_fulfillment_works as works
      on works.order_id = shipment_orders.order_id
    where shipment_orders.shipment_id = p_shipment_id
      and (
        works.business_id <> v_shipment.business_id
        or works.fulfillment_center_id <> v_shipment.fulfillment_center_id
        or works.status <> 'center_received'
      )
  ) then
    return query select 'awaiting_center', 'store_work_not_center_complete';
    return;
  end if;

  return query select case
    when p_expected_item_stage = 'packed' then 'ready_to_ship'
    else 'ready_to_pack'
  end, null::text;
end;
$$;

revoke all on function app_private.commerce_shipment_gate(uuid, text)
from public, anon, authenticated, service_role;

create or replace function public.request_commerce_order_shipment(
  p_member_id uuid,
  p_order_id uuid,
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
  v_method text := lower(nullif(btrim(p_settlement_method), ''));
  v_bank_name text := nullif(btrim(p_bank_name_snapshot), '');
  v_account_number text := nullif(btrim(p_account_number_snapshot), '');
  v_order public.commerce_orders%rowtype;
  v_transfer public.commerce_order_transfers%rowtype;
  v_address public.shipping_addresses%rowtype;
  v_center public.fulfillment_centers%rowtype;
  v_business_id uuid;
  v_center_id uuid;
  v_item_count integer;
  v_received bigint;
  v_request_id uuid := gen_random_uuid();
  v_shipment_id uuid := gen_random_uuid();
  v_fee_payment_id uuid;
  v_credit_ledger_id uuid;
  v_credit_count integer;
  v_receipt public.fulfillment_command_receipts%rowtype;
  v_fingerprint text;
  v_gate_status text;
  v_block_reason text;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(
      pg_catalog.current_setting('request.jwt.claims', true),
      ''
    )::jsonb ->> 'role'
  ) is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = '서버 배송 요청 경계가 필요합니다.';
  end if;
  if p_member_id is null
    or p_order_id is null
    or p_address_id is null
    or p_idempotency_key is null
    or v_method is null
    or v_method not in ('shipping_credit', 'manual_transfer')
  then
    raise exception using
      errcode = '22023',
      message = '통합 주문 배송 요청이 올바르지 않습니다.';
  end if;
  if v_method = 'shipping_credit' and (
      p_shipping_fee_amount is not null
      or v_bank_name is not null
      or v_account_number is not null
    )
  then
    raise exception using
      errcode = '22023',
      message = '배송 이용권 요청에는 별도 입금 정보를 사용할 수 없습니다.';
  elsif v_method = 'manual_transfer' and (
      p_shipping_fee_amount is null
      or p_shipping_fee_amount not between 1 and 1000000000
      or v_bank_name is null
      or char_length(v_bank_name) > 80
      or v_account_number is null
      or char_length(v_account_number) > 120
    )
  then
    raise exception using
      errcode = '22023',
      message = '배송비 계좌이체 설정이 올바르지 않습니다.';
  end if;

  v_fingerprint := app_private.fulfillment_command_fingerprint(
    jsonb_build_object(
      'member_id', p_member_id,
      'order_id', p_order_id,
      'address_id', p_address_id,
      'settlement_method', v_method,
      'shipping_fee_amount', p_shipping_fee_amount,
      'bank_name_snapshot', v_bank_name,
      'account_number_snapshot', v_account_number
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_member_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select receipts.* into v_receipt
  from public.fulfillment_command_receipts as receipts
  where receipts.actor_user_id = p_member_id
    and receipts.idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'request_shipment'
      or v_receipt.target_id <> p_order_id
      or v_receipt.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22000',
        message = '같은 배송 요청 키에 다른 주문 또는 결제 방식을 사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select orders.* into v_order
  from public.commerce_orders as orders
  where orders.id = p_order_id
  for update;
  if not found or v_order.member_id <> p_member_id then
    raise exception using
      errcode = 'P0002',
      message = '배송 요청할 통합 주문을 찾을 수 없습니다.';
  end if;
  if v_order.status <> 'paid' then
    raise exception using
      errcode = '55000',
      message = '통합 입금이 확정된 주문만 배송 요청할 수 있습니다.';
  end if;
  if exists (
    select 1
    from public.commerce_shipment_orders as shipment_orders
    where shipment_orders.order_id = v_order.id
  ) then
    raise exception using
      errcode = '23505',
      message = '이 통합 주문에는 이미 정식 배송이 있습니다.';
  end if;

  select transfers.* into v_transfer
  from public.commerce_order_transfers as transfers
  where transfers.order_id = v_order.id
  for update;
  if not found
    or v_transfer.member_id <> v_order.member_id
    or v_transfer.expected_amount <> v_order.total
    or v_transfer.status <> 'confirmed'
  then
    raise exception using
      errcode = '55000',
      message = '통합 주문의 수동 계좌이체 원장을 확인할 수 없습니다.';
  end if;
  select coalesce(sum(
    case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
  ), 0)::bigint
  into v_received
  from public.manual_transfer_payment_ledger as ledger
  where ledger.commerce_order_transfer_id = v_transfer.id;
  if v_received <> v_transfer.expected_amount then
    raise exception using
      errcode = '55000',
      message = '통합 주문 입금 원장 누적액이 예정액과 일치하지 않습니다.';
  end if;

  perform order_items.id
  from public.commerce_order_items as order_items
  where order_items.order_id = v_order.id
  order by order_items.id
  for update;

  perform fulfillment.order_item_id
  from public.commerce_order_items as order_items
  join public.order_item_fulfillments as fulfillment
    on fulfillment.order_item_id = order_items.id
  where order_items.order_id = v_order.id
  order by fulfillment.order_item_id
  for update of fulfillment;

  select
    count(*)::integer,
    min(fulfillment.business_id::text)::uuid,
    min(fulfillment.fulfillment_center_id::text)::uuid
  into v_item_count, v_business_id, v_center_id
  from public.commerce_order_items as order_items
  join public.order_item_fulfillments as fulfillment
    on fulfillment.order_item_id = order_items.id
  where order_items.order_id = v_order.id;

  if v_item_count < 1
    or v_item_count <> (
      select count(*)
      from public.commerce_order_items as order_items
      where order_items.order_id = v_order.id
    )
    or (
      select count(distinct fulfillment.business_id)
      from public.commerce_order_items as order_items
      join public.order_item_fulfillments as fulfillment
        on fulfillment.order_item_id = order_items.id
      where order_items.order_id = v_order.id
    ) <> 1
    or (
      select count(distinct fulfillment.fulfillment_center_id)
      from public.commerce_order_items as order_items
      join public.order_item_fulfillments as fulfillment
        on fulfillment.order_item_id = order_items.id
      where order_items.order_id = v_order.id
    ) <> 1
    or exists (
      select 1
      from public.commerce_order_items as order_items
      join public.order_item_fulfillments as fulfillment
        on fulfillment.order_item_id = order_items.id
      where order_items.order_id = v_order.id
        and (
          order_items.payment_status <> 'paid'
          or order_items.storage_expires_at is null
          or order_items.storage_expires_at <= v_now
          or fulfillment.current_stage in (
            'waiting_payment',
            'reconciliation_required',
            'cancelled',
            'legacy_terminal',
            'packed',
            'shipped'
          )
        )
    )
  then
    raise exception using
      errcode = '55000',
      message = '주문 전체 상품의 결제·보관·중앙 물류 연결을 확인할 수 없습니다.';
  end if;

  select centers.* into v_center
  from public.fulfillment_centers as centers
  where centers.id = v_center_id
    and centers.business_id = v_business_id;
  if not found or v_center.status <> 'active' then
    raise exception using
      errcode = '55000',
      message = '활성 중앙 출고지를 찾을 수 없습니다.';
  end if;

  select addresses.* into v_address
  from public.shipping_addresses as addresses
  where addresses.id = p_address_id
    and addresses.member_id = p_member_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '선택한 배송지를 찾을 수 없습니다.';
  end if;

  insert into public.shipping_requests (
    id,
    member_id,
    address_id,
    address_snapshot,
    idempotency_key
  ) values (
    v_request_id,
    p_member_id,
    v_address.id,
    jsonb_build_object(
      'label', v_address.label,
      'recipientName', v_address.recipient_name,
      'phone', v_address.phone,
      'postalCode', v_address.postal_code,
      'address', v_address.address
    ),
    p_idempotency_key::text
  );

  insert into public.shipping_request_items (request_id, product_id)
  select v_request_id, order_items.product_id
  from public.commerce_order_items as order_items
  where order_items.order_id = v_order.id
  order by order_items.id;

  if v_method = 'shipping_credit' then
    update public.member_accounts as accounts
    set shipping_credit_count = accounts.shipping_credit_count - 1
    where accounts.member_id = p_member_id
      and accounts.account_status = 'active'
      and accounts.shipping_credit_count > 0
    returning accounts.shipping_credit_count into v_credit_count;
    if v_credit_count is null then
      raise exception using
        errcode = '55000',
        message = '사용할 수 있는 배송 이용권이 없습니다.';
    end if;

    insert into public.shipping_credit_ledger (
      member_id,
      delta,
      reason,
      shipping_request_id,
      created_by
    ) values (
      p_member_id,
      -1,
      'used',
      v_request_id,
      p_member_id
    ) returning id into v_credit_ledger_id;
  else
    insert into public.shipping_fee_payments (
      member_id,
      shipping_request_id,
      expected_amount,
      bank_name_snapshot,
      account_number_snapshot,
      idempotency_key
    ) values (
      p_member_id,
      v_request_id,
      p_shipping_fee_amount,
      v_bank_name,
      v_account_number,
      p_idempotency_key::text
    ) returning id into v_fee_payment_id;
  end if;

  insert into public.commerce_shipments (
    id,
    shipping_request_id,
    member_id,
    business_id,
    fulfillment_center_id,
    settlement_method,
    shipping_fee_payment_id,
    shipping_credit_ledger_id,
    address_snapshot,
    created_at,
    updated_at
  ) values (
    v_shipment_id,
    v_request_id,
    p_member_id,
    v_business_id,
    v_center_id,
    v_method,
    v_fee_payment_id,
    v_credit_ledger_id,
    jsonb_build_object(
      'label', v_address.label,
      'recipientName', v_address.recipient_name,
      'phone', v_address.phone,
      'postalCode', v_address.postal_code,
      'address', v_address.address
    ),
    v_now,
    v_now
  );

  insert into public.commerce_shipment_orders (
    shipment_id,
    order_id,
    member_id,
    business_id,
    fulfillment_center_id,
    created_at
  ) values (
    v_shipment_id,
    v_order.id,
    p_member_id,
    v_business_id,
    v_center_id,
    v_now
  );

  insert into public.commerce_shipment_items (
    shipment_id,
    order_id,
    order_item_id,
    product_id,
    store_id,
    member_id,
    business_id,
    fulfillment_center_id,
    manifest_fulfillment_version,
    created_at
  )
  select
    v_shipment_id,
    order_items.order_id,
    order_items.id,
    order_items.product_id,
    order_items.store_id,
    p_member_id,
    fulfillment.business_id,
    fulfillment.fulfillment_center_id,
    fulfillment.version,
    v_now
  from public.commerce_order_items as order_items
  join public.order_item_fulfillments as fulfillment
    on fulfillment.order_item_id = order_items.id
  where order_items.order_id = v_order.id
  order by order_items.id;

  insert into public.commerce_shipment_events (
    shipment_id,
    sequence_no,
    event_type,
    from_status,
    to_status,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    reason,
    metadata,
    occurred_at
  ) values (
    v_shipment_id,
    1,
    'requested',
    null,
    'requested',
    'system',
    null,
    'service_role',
    p_idempotency_key,
    'member_requested_complete_order_shipment',
    jsonb_build_object(
      'order_id', v_order.id,
      'shipping_request_id', v_request_id,
      'requested_by_member_id', p_member_id,
      'settlement_method', v_method,
      'item_count', v_item_count
    ),
    v_now
  );

  select gate.gate_status, gate.block_reason
  into v_gate_status, v_block_reason
  from app_private.commerce_shipment_gate(
    v_shipment_id,
    'center_stored'
  ) as gate;

  v_result := jsonb_build_object(
    'shipment_id', v_shipment_id,
    'shipping_request_id', v_request_id,
    'order_id', v_order.id,
    'status', 'requested',
    'readiness_status', v_gate_status,
    'block_reason', v_block_reason,
    'settlement_method', v_method,
    'version', 0,
    'payment', case
      when v_method = 'manual_transfer' then jsonb_build_object(
        'id', v_fee_payment_id,
        'expected_amount', p_shipping_fee_amount,
        'status', 'awaiting_transfer',
        'bank_name_snapshot', v_bank_name,
        'account_number_snapshot', v_account_number
      )
      else null
    end,
    'idempotent_replay', false
  );

  insert into public.fulfillment_command_receipts (
    actor_user_id,
    idempotency_key,
    command_name,
    target_id,
    request_fingerprint,
    result,
    created_at
  ) values (
    p_member_id,
    p_idempotency_key,
    'request_shipment',
    v_order.id,
    v_fingerprint,
    v_result,
    v_now
  );
  return v_result;
end;
$$;

revoke all on function public.request_commerce_order_shipment(
  uuid, uuid, uuid, text, bigint, text, text, uuid
)
from public, anon, authenticated, service_role;
grant execute on function public.request_commerce_order_shipment(
  uuid, uuid, uuid, text, bigint, text, text, uuid
)
to service_role;

create or replace function public.pack_commerce_shipment(
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
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_note text := nullif(btrim(p_note), '');
  v_shipment public.commerce_shipments%rowtype;
  v_receipt public.fulfillment_command_receipts%rowtype;
  v_fingerprint text;
  v_gate_status text;
  v_block_reason text;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null
    or p_shipment_id is null
    or p_expected_version is null
    or p_expected_version < 0
    or p_idempotency_key is null
    or (
      v_note is not null
      and (
        char_length(v_note) > 500
        or v_note ~ '[[:cntrl:]]'
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = '합포장 확인 요청이 올바르지 않습니다.';
  end if;

  v_fingerprint := app_private.fulfillment_command_fingerprint(
    jsonb_build_object(
      'shipment_id', p_shipment_id,
      'expected_version', p_expected_version,
      'note', v_note
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select receipts.* into v_receipt
  from public.fulfillment_command_receipts as receipts
  where receipts.actor_user_id = v_actor
    and receipts.idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'pack_shipment'
      or v_receipt.target_id <> p_shipment_id
      or v_receipt.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22000',
        message = '같은 물류 요청 키에 다른 합포장 작업을 사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select shipments.* into v_shipment
  from public.commerce_shipments as shipments
  where shipments.id = p_shipment_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '정식 배송을 찾을 수 없습니다.';
  end if;

  perform orders.id
  from public.commerce_shipment_orders as shipment_orders
  join public.commerce_orders as orders
    on orders.id = shipment_orders.order_id
  where shipment_orders.shipment_id = p_shipment_id
  order by orders.id
  for update of orders;

  select shipments.* into v_shipment
  from public.commerce_shipments as shipments
  where shipments.id = p_shipment_id
  for update;

  if not public.has_business_permission(
    v_shipment.business_id,
    'create_shipments'
  ) then
    raise exception using
      errcode = '42501',
      message = '합포장과 송장 처리 권한이 없습니다.';
  end if;
  if v_shipment.version <> p_expected_version then
    raise exception using
      errcode = '55000',
      message = '정식 배송 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if v_shipment.status <> 'requested' then
    raise exception using
      errcode = '55000',
      message = '배송 요청 상태인 주문만 합포장할 수 있습니다.';
  end if;

  perform works.id
  from public.commerce_shipment_orders as shipment_orders
  join public.store_fulfillment_works as works
    on works.order_id = shipment_orders.order_id
  where shipment_orders.shipment_id = p_shipment_id
  order by works.id
  for update of works;

  perform fulfillment.order_item_id
  from public.commerce_shipment_items as shipment_items
  join public.order_item_fulfillments as fulfillment
    on fulfillment.order_item_id = shipment_items.order_item_id
  where shipment_items.shipment_id = p_shipment_id
  order by fulfillment.order_item_id
  for update of fulfillment;

  perform transfers.id
  from public.commerce_shipment_orders as shipment_orders
  join public.commerce_order_transfers as transfers
    on transfers.order_id = shipment_orders.order_id
  where shipment_orders.shipment_id = p_shipment_id
  order by transfers.id
  for update of transfers;

  if v_shipment.shipping_fee_payment_id is not null then
    perform payments.id
    from public.shipping_fee_payments as payments
    where payments.id = v_shipment.shipping_fee_payment_id
    for update;
  end if;
  perform ledger.id
  from public.manual_transfer_payment_ledger as ledger
  where ledger.shipping_fee_payment_id = v_shipment.shipping_fee_payment_id
    or ledger.commerce_order_transfer_id in (
      select transfers.id
      from public.commerce_shipment_orders as shipment_orders
      join public.commerce_order_transfers as transfers
        on transfers.order_id = shipment_orders.order_id
      where shipment_orders.shipment_id = p_shipment_id
    )
  order by ledger.id
  for update;

  select gate.gate_status, gate.block_reason
  into v_gate_status, v_block_reason
  from app_private.commerce_shipment_gate(
    p_shipment_id,
    'center_stored'
  ) as gate;
  if v_gate_status <> 'ready_to_pack' then
    raise exception using
      errcode = '55000',
      message = case v_gate_status
        when 'awaiting_payment' then '배송비와 주문 입금이 모두 확정되어야 합포장할 수 있습니다.'
        when 'awaiting_center' then '모든 주문 상품이 중앙 보관 위치에 도착해야 합포장할 수 있습니다.'
        else '정식 배송 manifest를 확인할 수 없어 합포장할 수 없습니다.'
      end,
      detail = v_block_reason;
  end if;

  update public.commerce_shipments as shipments
  set
    status = 'packed',
    packed_at = v_now,
    packed_by = v_actor,
    version = shipments.version + 1,
    updated_at = v_now
  where shipments.id = p_shipment_id
  returning shipments.* into v_shipment;

  with current_items as materialized (
    select
      fulfillment.order_item_id,
      fulfillment.current_stage,
      fulfillment.location_kind,
      fulfillment.storage_location_code,
      fulfillment.is_blocked,
      fulfillment.version
    from public.commerce_shipment_items as shipment_items
    join public.order_item_fulfillments as fulfillment
      on fulfillment.order_item_id = shipment_items.order_item_id
    where shipment_items.shipment_id = p_shipment_id
    order by fulfillment.order_item_id
  ), updated as (
    update public.order_item_fulfillments as fulfillment
    set
      current_stage = 'packed',
      location_kind = 'center',
      storage_location_code = null,
      version = fulfillment.version + 1,
      last_event_at = v_now,
      updated_at = v_now
    from current_items
    where fulfillment.order_item_id = current_items.order_item_id
    returning fulfillment.order_item_id, fulfillment.version
  )
  insert into public.fulfillment_events (
    order_item_id,
    sequence_no,
    event_type,
    from_stage,
    to_stage,
    from_location_kind,
    to_location_kind,
    from_location_code,
    to_location_code,
    from_blocked,
    to_blocked,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    reason_code,
    note,
    metadata,
    occurred_at,
    recorded_at
  )
  select
    current_items.order_item_id,
    coalesce((
      select max(events.sequence_no) + 1
      from public.fulfillment_events as events
      where events.order_item_id = current_items.order_item_id
    ), 1),
    'packed',
    current_items.current_stage,
    'packed',
    current_items.location_kind,
    'center',
    current_items.storage_location_code,
    null,
    current_items.is_blocked,
    false,
    'user',
    v_actor,
    v_actor_role,
    p_idempotency_key,
    'final_combined_pack_confirmed',
    v_note,
    jsonb_build_object(
      'shipment_id', p_shipment_id,
      'from_fulfillment_version', current_items.version,
      'to_fulfillment_version', updated.version
    ),
    v_now,
    v_now
  from current_items
  join updated using (order_item_id);

  update public.commerce_shipment_items as shipment_items
  set packed_fulfillment_version = fulfillment.version
  from public.order_item_fulfillments as fulfillment
  where shipment_items.shipment_id = p_shipment_id
    and fulfillment.order_item_id = shipment_items.order_item_id;

  insert into public.commerce_shipment_events (
    shipment_id,
    sequence_no,
    event_type,
    from_status,
    to_status,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    reason,
    metadata,
    occurred_at
  ) values (
    p_shipment_id,
    coalesce((
      select max(events.sequence_no) + 1
      from public.commerce_shipment_events as events
      where events.shipment_id = p_shipment_id
    ), 1),
    'packed',
    'requested',
    'packed',
    'user',
    v_actor,
    v_actor_role,
    p_idempotency_key,
    v_note,
    jsonb_build_object('gate_status', v_gate_status),
    v_now
  );

  v_result := jsonb_build_object(
    'shipment_id', v_shipment.id,
    'status', v_shipment.status,
    'version', v_shipment.version,
    'packed_at', v_shipment.packed_at,
    'idempotent_replay', false
  );
  insert into public.fulfillment_command_receipts (
    actor_user_id,
    idempotency_key,
    command_name,
    target_id,
    request_fingerprint,
    result,
    created_at
  ) values (
    v_actor,
    p_idempotency_key,
    'pack_shipment',
    p_shipment_id,
    v_fingerprint,
    v_result,
    v_now
  );
  return v_result;
end;
$$;

revoke all on function public.pack_commerce_shipment(
  uuid, bigint, uuid, text
)
from public, anon, authenticated, service_role;
grant execute on function public.pack_commerce_shipment(
  uuid, bigint, uuid, text
)
to authenticated;

create or replace function public.ship_commerce_shipment(
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
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_courier text := btrim(coalesce(p_courier, ''));
  v_tracking_number text := btrim(coalesce(p_tracking_number, ''));
  v_note text := nullif(btrim(p_note), '');
  v_tracking_key text;
  v_shipment public.commerce_shipments%rowtype;
  v_receipt public.fulfillment_command_receipts%rowtype;
  v_fingerprint text;
  v_gate_status text;
  v_block_reason text;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null
    or p_shipment_id is null
    or p_expected_version is null
    or p_expected_version < 0
    or p_idempotency_key is null
    or char_length(v_courier) not between 1 and 80
    or char_length(v_tracking_number) not between 1 and 120
    or v_courier ~ '[[:cntrl:]]'
    or v_tracking_number ~ '[[:cntrl:]]'
    or (
      v_note is not null
      and (
        char_length(v_note) > 500
        or v_note ~ '[[:cntrl:]]'
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = '정식 배송 출고 요청이 올바르지 않습니다.';
  end if;

  v_fingerprint := app_private.fulfillment_command_fingerprint(
    jsonb_build_object(
      'shipment_id', p_shipment_id,
      'expected_version', p_expected_version,
      'courier', v_courier,
      'tracking_number', v_tracking_number,
      'note', v_note
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select receipts.* into v_receipt
  from public.fulfillment_command_receipts as receipts
  where receipts.actor_user_id = v_actor
    and receipts.idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'ship_shipment'
      or v_receipt.target_id <> p_shipment_id
      or v_receipt.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22000',
        message = '같은 물류 요청 키에 다른 출고 작업을 사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select shipments.* into v_shipment
  from public.commerce_shipments as shipments
  where shipments.id = p_shipment_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '정식 배송을 찾을 수 없습니다.';
  end if;

  perform orders.id
  from public.commerce_shipment_orders as shipment_orders
  join public.commerce_orders as orders
    on orders.id = shipment_orders.order_id
  where shipment_orders.shipment_id = p_shipment_id
  order by orders.id
  for update of orders;

  select shipments.* into v_shipment
  from public.commerce_shipments as shipments
  where shipments.id = p_shipment_id
  for update;
  if not public.has_business_permission(
    v_shipment.business_id,
    'create_shipments'
  ) then
    raise exception using
      errcode = '42501',
      message = '합포장과 송장 처리 권한이 없습니다.';
  end if;
  if v_shipment.version <> p_expected_version then
    raise exception using
      errcode = '55000',
      message = '정식 배송 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if v_shipment.status <> 'packed' then
    raise exception using
      errcode = '55000',
      message = '최종 합포장이 확인된 주문만 출고할 수 있습니다.';
  end if;

  perform works.id
  from public.commerce_shipment_orders as shipment_orders
  join public.store_fulfillment_works as works
    on works.order_id = shipment_orders.order_id
  where shipment_orders.shipment_id = p_shipment_id
  order by works.id
  for update of works;

  perform fulfillment.order_item_id
  from public.commerce_shipment_items as shipment_items
  join public.order_item_fulfillments as fulfillment
    on fulfillment.order_item_id = shipment_items.order_item_id
  where shipment_items.shipment_id = p_shipment_id
  order by fulfillment.order_item_id
  for update of fulfillment;

  perform transfers.id
  from public.commerce_shipment_orders as shipment_orders
  join public.commerce_order_transfers as transfers
    on transfers.order_id = shipment_orders.order_id
  where shipment_orders.shipment_id = p_shipment_id
  order by transfers.id
  for update of transfers;

  if v_shipment.shipping_fee_payment_id is not null then
    perform payments.id
    from public.shipping_fee_payments as payments
    where payments.id = v_shipment.shipping_fee_payment_id
    for update;
  end if;
  perform ledger.id
  from public.manual_transfer_payment_ledger as ledger
  where ledger.shipping_fee_payment_id = v_shipment.shipping_fee_payment_id
    or ledger.commerce_order_transfer_id in (
      select transfers.id
      from public.commerce_shipment_orders as shipment_orders
      join public.commerce_order_transfers as transfers
        on transfers.order_id = shipment_orders.order_id
      where shipment_orders.shipment_id = p_shipment_id
    )
  order by ledger.id
  for update;

  select gate.gate_status, gate.block_reason
  into v_gate_status, v_block_reason
  from app_private.commerce_shipment_gate(
    p_shipment_id,
    'packed'
  ) as gate;
  if v_gate_status <> 'ready_to_ship' then
    raise exception using
      errcode = '55000',
      message = case v_gate_status
        when 'awaiting_payment' then '배송비와 주문 입금이 현재도 확정되어 있어야 출고할 수 있습니다.'
        when 'awaiting_center' then '합포장 manifest가 변경되어 출고할 수 없습니다.'
        else '정식 배송 manifest를 확인할 수 없어 출고할 수 없습니다.'
      end,
      detail = v_block_reason;
  end if;

  v_tracking_key := lower(v_courier) || pg_catalog.chr(31) || v_tracking_number;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tracking_key, 0)
  );
  if exists (
    select 1
    from public.commerce_shipments as shipments
    where shipments.status = 'shipped'
      and lower(btrim(shipments.courier)) = lower(v_courier)
      and btrim(shipments.tracking_number) = v_tracking_number
      and shipments.id <> p_shipment_id
  ) then
    raise exception using
      errcode = '23505',
      constraint = 'commerce_shipments_tracking_key',
      message = '동일한 택배사와 운송장 번호가 다른 정식 배송에 이미 등록되어 있습니다.';
  end if;

  update public.commerce_shipments as shipments
  set
    status = 'shipped',
    courier = v_courier,
    tracking_number = v_tracking_number,
    shipped_at = v_now,
    shipped_by = v_actor,
    version = shipments.version + 1,
    updated_at = v_now
  where shipments.id = p_shipment_id
  returning shipments.* into v_shipment;

  with current_items as materialized (
    select
      fulfillment.order_item_id,
      fulfillment.current_stage,
      fulfillment.location_kind,
      fulfillment.storage_location_code,
      fulfillment.is_blocked,
      fulfillment.version
    from public.commerce_shipment_items as shipment_items
    join public.order_item_fulfillments as fulfillment
      on fulfillment.order_item_id = shipment_items.order_item_id
    where shipment_items.shipment_id = p_shipment_id
    order by fulfillment.order_item_id
  ), updated as (
    update public.order_item_fulfillments as fulfillment
    set
      current_stage = 'shipped',
      location_kind = 'transit',
      storage_location_code = null,
      version = fulfillment.version + 1,
      last_event_at = v_now,
      updated_at = v_now
    from current_items
    where fulfillment.order_item_id = current_items.order_item_id
    returning fulfillment.order_item_id, fulfillment.version
  )
  insert into public.fulfillment_events (
    order_item_id,
    sequence_no,
    event_type,
    from_stage,
    to_stage,
    from_location_kind,
    to_location_kind,
    from_location_code,
    to_location_code,
    from_blocked,
    to_blocked,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    reason_code,
    note,
    metadata,
    occurred_at,
    recorded_at
  )
  select
    current_items.order_item_id,
    coalesce((
      select max(events.sequence_no) + 1
      from public.fulfillment_events as events
      where events.order_item_id = current_items.order_item_id
    ), 1),
    'shipped',
    current_items.current_stage,
    'shipped',
    current_items.location_kind,
    'transit',
    current_items.storage_location_code,
    null,
    current_items.is_blocked,
    false,
    'user',
    v_actor,
    v_actor_role,
    p_idempotency_key,
    'single_tracking_dispatched',
    v_note,
    jsonb_build_object(
      'shipment_id', p_shipment_id,
      'courier', v_courier,
      'tracking_number', v_tracking_number,
      'from_fulfillment_version', current_items.version,
      'to_fulfillment_version', updated.version
    ),
    v_now,
    v_now
  from current_items
  join updated using (order_item_id);

  update public.commerce_shipment_items as shipment_items
  set shipped_fulfillment_version = fulfillment.version
  from public.order_item_fulfillments as fulfillment
  where shipment_items.shipment_id = p_shipment_id
    and fulfillment.order_item_id = shipment_items.order_item_id;

  update public.commerce_orders as orders
  set status = 'shipped', updated_at = v_now
  where orders.id in (
    select shipment_orders.order_id
    from public.commerce_shipment_orders as shipment_orders
    where shipment_orders.shipment_id = p_shipment_id
  )
    and orders.status = 'paid';
  if not found then
    raise exception using
      errcode = '55000',
      message = '출고할 통합 주문 상태가 변경되었습니다.';
  end if;

  update public.shipping_requests as requests
  set
    status = 'shipped',
    courier = v_courier,
    tracking_number = v_tracking_number,
    shipped_at = v_now
  where requests.id = v_shipment.shipping_request_id
    and requests.status = 'requested';
  if not found then
    raise exception using
      errcode = '55000',
      message = '호환 배송 요청 상태가 변경되었습니다.';
  end if;

  insert into public.commerce_shipment_events (
    shipment_id,
    sequence_no,
    event_type,
    from_status,
    to_status,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    reason,
    metadata,
    occurred_at
  ) values (
    p_shipment_id,
    coalesce((
      select max(events.sequence_no) + 1
      from public.commerce_shipment_events as events
      where events.shipment_id = p_shipment_id
    ), 1),
    'shipped',
    'packed',
    'shipped',
    'user',
    v_actor,
    v_actor_role,
    p_idempotency_key,
    v_note,
    jsonb_build_object(
      'courier', v_courier,
      'tracking_number', v_tracking_number
    ),
    v_now
  );

  v_result := jsonb_build_object(
    'shipment_id', v_shipment.id,
    'status', v_shipment.status,
    'courier', v_shipment.courier,
    'tracking_number', v_shipment.tracking_number,
    'shipped_at', v_shipment.shipped_at,
    'version', v_shipment.version,
    'idempotent_replay', false
  );
  insert into public.fulfillment_command_receipts (
    actor_user_id,
    idempotency_key,
    command_name,
    target_id,
    request_fingerprint,
    result,
    created_at
  ) values (
    v_actor,
    p_idempotency_key,
    'ship_shipment',
    p_shipment_id,
    v_fingerprint,
    v_result,
    v_now
  );
  return v_result;
end;
$$;

revoke all on function public.ship_commerce_shipment(
  uuid, bigint, text, text, uuid, text
)
from public, anon, authenticated, service_role;
grant execute on function public.ship_commerce_shipment(
  uuid, bigint, text, text, uuid, text
)
to authenticated;

create or replace function public.correct_commerce_shipment_tracking(
  p_shipment_id uuid,
  p_expected_version bigint,
  p_courier text,
  p_tracking_number text,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_courier text := btrim(coalesce(p_courier, ''));
  v_tracking_number text := btrim(coalesce(p_tracking_number, ''));
  v_reason text := nullif(btrim(p_reason), '');
  v_tracking_key text;
  v_old_tracking_key text;
  v_new_tracking_lock bigint;
  v_old_tracking_lock bigint;
  v_shipment public.commerce_shipments%rowtype;
  v_receipt public.fulfillment_command_receipts%rowtype;
  v_fingerprint text;
  v_from_courier text;
  v_from_tracking text;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null
    or not public.is_owner()
    or v_actor_role <> 'owner'
  then
    raise exception using
      errcode = '42501',
      message = '출고 후 운송장 정정은 시스템 관리자만 할 수 있습니다.';
  end if;
  if p_shipment_id is null
    or p_expected_version is null
    or p_expected_version < 0
    or p_idempotency_key is null
    or char_length(v_courier) not between 1 and 80
    or char_length(v_tracking_number) not between 1 and 120
    or v_courier ~ '[[:cntrl:]]'
    or v_tracking_number ~ '[[:cntrl:]]'
    or v_reason is null
    or char_length(v_reason) not between 3 and 500
    or v_reason ~ '[[:cntrl:]]'
  then
    raise exception using
      errcode = '22023',
      message = '운송장 정정 요청과 사유를 확인해 주세요.';
  end if;

  v_fingerprint := app_private.fulfillment_command_fingerprint(
    jsonb_build_object(
      'shipment_id', p_shipment_id,
      'expected_version', p_expected_version,
      'courier', v_courier,
      'tracking_number', v_tracking_number,
      'reason', v_reason
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select receipts.* into v_receipt
  from public.fulfillment_command_receipts as receipts
  where receipts.actor_user_id = v_actor
    and receipts.idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'correct_tracking'
      or v_receipt.target_id <> p_shipment_id
      or v_receipt.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22000',
        message = '같은 물류 요청 키에 다른 운송장 정정을 사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select shipments.* into v_shipment
  from public.commerce_shipments as shipments
  where shipments.id = p_shipment_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '정식 배송을 찾을 수 없습니다.';
  end if;
  if v_shipment.version <> p_expected_version then
    raise exception using
      errcode = '55000',
      message = '정식 배송 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if v_shipment.status <> 'shipped' then
    raise exception using
      errcode = '55000',
      message = '출고 완료된 정식 배송의 운송장만 정정할 수 있습니다.';
  end if;
  if lower(btrim(v_shipment.courier)) = lower(v_courier)
    and btrim(v_shipment.tracking_number) = v_tracking_number
  then
    raise exception using
      errcode = '22023',
      message = '기존 운송장과 다른 값을 입력해 주세요.';
  end if;

  v_from_courier := v_shipment.courier;
  v_from_tracking := v_shipment.tracking_number;
  v_tracking_key := lower(v_courier) || pg_catalog.chr(31) || v_tracking_number;
  v_old_tracking_key := lower(btrim(v_from_courier))
    || pg_catalog.chr(31)
    || btrim(v_from_tracking);
  v_new_tracking_lock := pg_catalog.hashtextextended(v_tracking_key, 0);
  v_old_tracking_lock := pg_catalog.hashtextextended(v_old_tracking_key, 0);
  perform pg_catalog.pg_advisory_xact_lock(
    least(v_new_tracking_lock, v_old_tracking_lock)
  );
  if v_new_tracking_lock <> v_old_tracking_lock then
    perform pg_catalog.pg_advisory_xact_lock(
      greatest(v_new_tracking_lock, v_old_tracking_lock)
    );
  end if;
  if exists (
    select 1
    from public.commerce_shipments as shipments
    where shipments.status = 'shipped'
      and lower(btrim(shipments.courier)) = lower(v_courier)
      and btrim(shipments.tracking_number) = v_tracking_number
      and shipments.id <> p_shipment_id
  ) then
    raise exception using
      errcode = '23505',
      constraint = 'commerce_shipments_tracking_key',
      message = '동일한 택배사와 운송장 번호가 다른 정식 배송에 이미 등록되어 있습니다.';
  end if;

  update public.commerce_shipments as shipments
  set
    courier = v_courier,
    tracking_number = v_tracking_number,
    version = shipments.version + 1,
    updated_at = v_now
  where shipments.id = p_shipment_id
  returning shipments.* into v_shipment;

  update public.shipping_requests as requests
  set courier = v_courier, tracking_number = v_tracking_number
  where requests.id = v_shipment.shipping_request_id
    and requests.status = 'shipped';
  if not found then
    raise exception using
      errcode = '55000',
      message = '호환 배송 요청의 운송장 투영을 찾을 수 없습니다.';
  end if;

  insert into public.commerce_shipment_events (
    shipment_id,
    sequence_no,
    event_type,
    from_status,
    to_status,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    reason,
    metadata,
    occurred_at
  ) values (
    p_shipment_id,
    coalesce((
      select max(events.sequence_no) + 1
      from public.commerce_shipment_events as events
      where events.shipment_id = p_shipment_id
    ), 1),
    'tracking_corrected',
    'shipped',
    'shipped',
    'user',
    v_actor,
    v_actor_role,
    p_idempotency_key,
    v_reason,
    jsonb_build_object(
      'from_courier', v_from_courier,
      'from_tracking_number', v_from_tracking,
      'to_courier', v_courier,
      'to_tracking_number', v_tracking_number
    ),
    v_now
  );

  v_result := jsonb_build_object(
    'shipment_id', v_shipment.id,
    'status', v_shipment.status,
    'courier', v_shipment.courier,
    'tracking_number', v_shipment.tracking_number,
    'shipped_at', v_shipment.shipped_at,
    'version', v_shipment.version,
    'idempotent_replay', false
  );
  insert into public.fulfillment_command_receipts (
    actor_user_id,
    idempotency_key,
    command_name,
    target_id,
    request_fingerprint,
    result,
    created_at
  ) values (
    v_actor,
    p_idempotency_key,
    'correct_tracking',
    p_shipment_id,
    v_fingerprint,
    v_result,
    v_now
  );
  return v_result;
end;
$$;

revoke all on function public.correct_commerce_shipment_tracking(
  uuid, bigint, text, text, text, uuid
)
from public, anon, authenticated, service_role;
grant execute on function public.correct_commerce_shipment_tracking(
  uuid, bigint, text, text, text, uuid
)
to authenticated;

create or replace function public.get_commerce_shipment_queue(
  p_include_shipped boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  shipment_id uuid,
  shipping_request_id uuid,
  member_id uuid,
  business_id uuid,
  fulfillment_center_id uuid,
  order_ids uuid[],
  address_snapshot jsonb,
  status text,
  readiness_status text,
  block_reason text,
  settlement_method text,
  version bigint,
  item_count integer,
  center_stored_count integer,
  packed_item_count integer,
  courier text,
  tracking_number text,
  requested_at timestamptz,
  packed_at timestamptz,
  shipped_at timestamptz,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = '정식 배송 업무 조회 권한이 없습니다.';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using
      errcode = '22023',
      message = '배송 업무 조회 건수는 1건 이상 500건 이하여야 합니다.';
  end if;
  if p_offset is null or p_offset not between 0 and 1000000 then
    raise exception using
      errcode = '22023',
      message = '배송 업무 조회 시작 위치가 올바르지 않습니다.';
  end if;

  return query
  select
    shipments.id,
    shipments.shipping_request_id,
    shipments.member_id,
    shipments.business_id,
    shipments.fulfillment_center_id,
    order_summary.order_ids,
    shipments.address_snapshot,
    shipments.status,
    gate.gate_status,
    gate.block_reason,
    shipments.settlement_method,
    shipments.version,
    item_summary.item_count,
    item_summary.center_stored_count,
    item_summary.packed_item_count,
    shipments.courier,
    shipments.tracking_number,
    shipments.created_at,
    shipments.packed_at,
    shipments.shipped_at,
    item_summary.items
  from public.commerce_shipments as shipments
  cross join lateral app_private.commerce_shipment_gate(
    shipments.id,
    case when shipments.status = 'packed' then 'packed' else 'center_stored' end
  ) as gate
  cross join lateral (
    select array_agg(shipment_orders.order_id order by shipment_orders.order_id) as order_ids
    from public.commerce_shipment_orders as shipment_orders
    where shipment_orders.shipment_id = shipments.id
  ) as order_summary
  cross join lateral (
    select
      count(*)::integer as item_count,
      count(*) filter (
        where fulfillment.current_stage = 'center_stored'
      )::integer as center_stored_count,
      count(*) filter (
        where fulfillment.current_stage = 'packed'
      )::integer as packed_item_count,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'orderId', shipment_items.order_id,
          'orderItemId', shipment_items.order_item_id,
          'productId', shipment_items.product_id,
          'storeId', shipment_items.store_id,
          'title', products.title,
          'stage', fulfillment.current_stage,
          'locationKind', fulfillment.location_kind,
          'storageLocationCode', fulfillment.storage_location_code,
          'isBlocked', fulfillment.is_blocked,
          'blockReason', fulfillment.block_reason,
          'fulfillmentVersion', fulfillment.version
        ) order by shipment_items.order_id, shipment_items.order_item_id
      ), '[]'::jsonb) as items
    from public.commerce_shipment_items as shipment_items
    join public.order_item_fulfillments as fulfillment
      on fulfillment.order_item_id = shipment_items.order_item_id
    join public.products as products
      on products.id = shipment_items.product_id
    where shipment_items.shipment_id = shipments.id
  ) as item_summary
  where public.has_business_permission(
      shipments.business_id,
      'create_shipments'
    )
    and (
      coalesce(p_include_shipped, false)
      or shipments.status <> 'shipped'
    )
  order by shipments.updated_at, shipments.id
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.get_commerce_shipment_queue(
  boolean, integer, integer
)
from public, anon, authenticated, service_role;
grant execute on function public.get_commerce_shipment_queue(
  boolean, integer, integer
)
to authenticated;

-- The legacy row is now a compatibility projection. Even a future accidental
-- service-role grant cannot move it to shipped without the canonical aggregate
-- already containing the exact same immutable dispatch fact.
create or replace function app_private.guard_shipping_request_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.commerce_shipments%rowtype;
  v_expected_status text;
begin
  select shipments.* into v_shipment
  from public.commerce_shipments as shipments
  where shipments.shipping_request_id = new.id;

  if found then
    v_expected_status := case
      when v_shipment.status = 'shipped' then 'shipped'
      when v_shipment.status = 'cancelled' then 'cancelled'
      else 'requested'
    end;
    if new.status is distinct from v_expected_status
      or new.courier is distinct from v_shipment.courier
      or new.tracking_number is distinct from v_shipment.tracking_number
      or new.shipped_at is distinct from v_shipment.shipped_at
    then
      raise exception using
        errcode = '55000',
        message = '호환 배송 요청은 정식 배송 상태와 동일한 투영으로만 변경할 수 있습니다.';
    end if;
  elsif (
    new.status is distinct from old.status
    or new.courier is distinct from old.courier
    or new.tracking_number is distinct from old.tracking_number
    or new.shipped_at is distinct from old.shipped_at
  ) and (new.status = 'shipped' or old.status = 'shipped') then
    raise exception using
      errcode = '55000',
      message = '레거시 배송 기록은 정식 중앙 집하 증거 없이 출고하거나 수정할 수 없습니다.';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_shipping_request_projection()
from public, anon, authenticated, service_role;

drop trigger if exists shipping_requests_guard_canonical_projection
on public.shipping_requests;
create trigger shipping_requests_guard_canonical_projection
before update of status, courier, tracking_number, shipped_at
on public.shipping_requests
for each row execute function app_private.guard_shipping_request_projection();

create or replace function app_private.guard_commerce_order_shipped_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'shipped' and old.status <> 'shipped' and not exists (
    select 1
    from public.commerce_shipment_orders as shipment_orders
    join public.commerce_shipments as shipments
      on shipments.id = shipment_orders.shipment_id
    where shipment_orders.order_id = new.id
      and shipments.status = 'shipped'
  ) then
    raise exception using
      errcode = '55000',
      message = '통합 주문은 정식 합포장 배송이 출고된 뒤에만 배송 완료로 바꿀 수 있습니다.';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_commerce_order_shipped_projection()
from public, anon, authenticated, service_role;

drop trigger if exists commerce_orders_guard_canonical_shipped
on public.commerce_orders;
create trigger commerce_orders_guard_canonical_shipped
before update of status
on public.commerce_orders
for each row execute function app_private.guard_commerce_order_shipped_projection();

create or replace function app_private.guard_packed_fulfillment_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment_status text;
begin
  select shipments.status into v_shipment_status
  from public.commerce_shipment_items as shipment_items
  join public.commerce_shipments as shipments
    on shipments.id = shipment_items.shipment_id
  where shipment_items.order_item_id = new.order_item_id;

  if new.current_stage in ('packed', 'shipped') then
    if v_shipment_status is distinct from new.current_stage
      or (
        new.current_stage = 'packed'
        and (
          new.location_kind <> 'center'
          or new.storage_location_code is not null
          or new.is_blocked
        )
      )
      or (
        new.current_stage = 'shipped'
        and (
          new.location_kind <> 'transit'
          or new.storage_location_code is not null
          or new.is_blocked
        )
      )
    then
      raise exception using
        errcode = '55000',
        message = '주문 상품의 포장·출고 상태는 정식 배송 명령으로만 변경할 수 있습니다.';
    end if;
  elsif old.current_stage in ('packed', 'shipped') then
    raise exception using
      errcode = '55000',
      message = '합포장 또는 출고된 상품은 일반 입고 작업으로 되돌릴 수 없습니다.';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_packed_fulfillment_projection()
from public, anon, authenticated, service_role;

drop trigger if exists order_item_fulfillments_guard_canonical_shipment
on public.order_item_fulfillments;
create trigger order_item_fulfillments_guard_canonical_shipment
before update of current_stage, location_kind, storage_location_code, is_blocked
on public.order_item_fulfillments
for each row execute function app_private.guard_packed_fulfillment_projection();

-- Remove every browser/service entry point that could set a legacy request to
-- shipped without the canonical order, settlement, center, and packing gate.
revoke all on function public.request_product_shipping(uuid[], uuid, boolean, text)
from public, anon, authenticated, service_role;
revoke all on function public.request_product_shipping(uuid[], uuid, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.request_product_shipping(uuid[], uuid)
from public, anon, authenticated, service_role;
revoke all on function public.mark_shipping_request_shipped(uuid, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.upsert_shipping_tracking_batch(jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.get_shipping_work(boolean, integer, integer)
from public, anon, authenticated, service_role;
revoke all on function public.get_pending_shipping_work()
from public, anon, authenticated, service_role;
revoke all on function public.count_shipping_work(boolean)
from public, anon, authenticated, service_role;
revoke all on function public.owner_mark_hidden_test_shipping_shipped(uuid, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.owner_request_hidden_test_shipping(uuid[], uuid)
from public, anon, authenticated, service_role;

revoke update on table public.shipping_requests from service_role;

do $$
declare
  v_shipment_id uuid;
begin
  for v_shipment_id in
    select shipments.id
    from public.commerce_shipments as shipments
    order by shipments.id
  loop
    perform app_private.validate_commerce_shipment_manifest(v_shipment_id);
  end loop;

  if exists (
    select 1
    from public.commerce_shipments as shipments
    left join public.shipping_requests as requests
      on requests.id = shipments.shipping_request_id
    where requests.id is null
      or requests.member_id <> shipments.member_id
  ) then
    raise exception using
      errcode = '23514',
      message = '정식 배송과 호환 배송 요청의 회원 경계가 일치하지 않습니다.';
  end if;
end;
$$;

comment on function public.request_commerce_order_shipment(
  uuid, uuid, uuid, text, bigint, text, text, uuid
) is
  'Service-only atomic request for exactly one complete paid commerce order. Creates compatibility intent and fee-or-credit settlement in the same transaction.';
comment on function public.pack_commerce_shipment(
  uuid, bigint, uuid, text
) is
  'CAS/idempotent final combined-pack confirmation after payment and every item center_stored.';
comment on function public.ship_commerce_shipment(
  uuid, bigint, text, text, uuid, text
) is
  'CAS/idempotent single-tracking dispatch after explicit combined packing and a final settlement/manifest recheck.';
comment on function public.correct_commerce_shipment_tracking(
  uuid, bigint, text, text, text, uuid
) is
  'Owner-only shipped-to-shipped tracking correction with mandatory reason and append-only audit.';

commit;
