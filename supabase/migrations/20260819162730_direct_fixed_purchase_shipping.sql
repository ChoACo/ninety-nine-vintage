begin;

alter table public.commerce_orders
  add column if not exists shipping_address_id uuid references public.shipping_addresses(id) on delete set null,
  add column if not exists shipping_address_snapshot jsonb,
  add column if not exists direct_ship boolean not null default false,
  add column if not exists payment_due_at timestamptz;

alter table public.commerce_order_transfers
  add column if not exists payment_due_at timestamptz;

alter table public.inventory_shipments
  drop constraint if exists inventory_shipments_settlement_method_check,
  add constraint inventory_shipments_settlement_method_check
    check (settlement_method = any (array['shipping_credit','manual_transfer','waiver','purchase_included']));
alter table public.inventory_shipments
  drop constraint if exists inventory_shipments_settlement_check,
  add constraint inventory_shipments_settlement_check
    check (
      (settlement_method = 'purchase_included' and num_nonnulls(shipping_fee_payment_id, shipping_credit_ledger_id, shipping_fee_waiver_id) = 0)
      or (num_nonnulls(shipping_fee_payment_id, shipping_credit_ledger_id, shipping_fee_waiver_id) = 1)
    );

create index if not exists commerce_orders_direct_payment_due_idx
  on public.commerce_orders (payment_due_at, id)
  where direct_ship and status in ('awaiting_payment','partially_paid');

create or replace function app_private.auto_direct_purchase_shipments(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.commerce_orders%rowtype;
  v_item record;
  v_shipment uuid;
  v_sequence integer;
begin
  select * into v_order from public.commerce_orders where id = p_order_id for update;
  if not found or not v_order.direct_ship or v_order.shipping_address_id is null then return; end if;
  for v_item in
    select min(i.id) as inventory_item_id, i.member_id, i.business_id, i.origin_store_id,
           i.fulfillment_center_id
    from public.customer_inventory_items i
    join public.commerce_order_items oi on oi.id = i.commerce_order_item_id
    where oi.order_id = p_order_id and oi.payment_status = 'paid'
      and not exists (select 1 from public.inventory_shipment_items si where si.inventory_item_id = i.id)
    group by i.member_id, i.business_id, i.origin_store_id, i.fulfillment_center_id
  loop
    v_shipment := gen_random_uuid();
    insert into public.inventory_shipments(
      id, member_id, business_id, fulfillment_center_id, status,
      settlement_method, address_id, address_snapshot, unit_kind,
      unit_store_id, processing_store_id, unit_snapshot
    ) values (
      v_shipment, v_item.member_id, v_item.business_id, v_item.fulfillment_center_id,
      'collecting', 'purchase_included', v_order.shipping_address_id,
      v_order.shipping_address_snapshot, 'store', v_item.origin_store_id,
      v_item.origin_store_id, jsonb_build_object('unitKind','store','storeId',v_item.origin_store_id)
    );
    insert into public.inventory_shipment_items(
      shipment_id, inventory_item_id, member_id, business_id,
      fulfillment_center_id, product_id, origin_store_id, line_status
    ) select v_shipment, i.id, i.member_id, i.business_id, i.fulfillment_center_id,
      i.product_id, i.origin_store_id, 'requested'
      from public.customer_inventory_items i
      join public.commerce_order_items oi on oi.id = i.commerce_order_item_id
      where oi.order_id = p_order_id and oi.payment_status = 'paid'
        and i.origin_store_id = v_item.origin_store_id
        and i.fulfillment_center_id = v_item.fulfillment_center_id
        and not exists (select 1 from public.inventory_shipment_items si where si.inventory_item_id = i.id);
    insert into public.inventory_shipment_store_works(
      shipment_id, business_id, origin_store_id, fulfillment_center_id,
      route_mode, status
    ) values (
      v_shipment, v_item.business_id, v_item.origin_store_id,
      v_item.fulfillment_center_id, 'co_located', 'collecting'
    );
    select coalesce(max(sequence_no), 0) + 1 into v_sequence
    from public.inventory_shipment_events where shipment_id = v_shipment;
    insert into public.inventory_shipment_events(
      shipment_id, sequence_no, event_type, to_status, actor_kind,
      actor_user_id, idempotency_key, metadata
    ) values (
      v_shipment, v_sequence, 'direct_purchase_shipping_requested', 'collecting',
      'system', null, gen_random_uuid(), jsonb_build_object('orderId', p_order_id, 'storeId', v_item.origin_store_id)
    );
    perform app_private.lock_inventory_shipment(v_shipment);
    perform app_private.refresh_inventory_shipment_status(v_shipment, gen_random_uuid());
  end loop;
end;
$$;
revoke all on function app_private.auto_direct_purchase_shipments(uuid) from public, anon, authenticated, service_role;

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
  if not found then raise exception using errcode='P0002', message='선택한 배송지를 찾을 수 없습니다.'; end if;
  v_checkout := public.create_commerce_manual_transfer_checkout(
    p_product_ids, p_idempotency_key, p_apply_shipping_credit, p_include_shipping_fee
  );
  v_order_id := (v_checkout->'order'->>'id')::uuid;
  select coalesce(payment_due_at, v_due) into v_due
  from public.commerce_orders
  where id = v_order_id and member_id = auth.uid()
  for update;
  update public.commerce_orders set
    shipping_address_id = v_address.id,
    shipping_address_snapshot = jsonb_build_object('label',v_address.label,'recipientName',v_address.recipient_name,'phone',v_address.phone,'postalCode',v_address.postal_code,'address',v_address.address),
    direct_ship = true, payment_due_at = v_due, updated_at = clock_timestamp()
  where id = v_order_id and member_id = auth.uid();
  update public.commerce_order_transfers set payment_due_at = v_due where order_id = v_order_id;
  v_checkout := jsonb_set(v_checkout, '{transfer,payment_due_at}', to_jsonb(v_due), true);
  return jsonb_set(v_checkout, '{order,payment_due_at}', to_jsonb(v_due), true);
end;
$$;
revoke all on function public.create_commerce_manual_transfer_checkout(uuid[],text,boolean,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_commerce_manual_transfer_checkout(uuid[],text,boolean,boolean,uuid) to authenticated;

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
  if p_shipping_region not in ('regular', 'remote_area') then raise exception using errcode='22023', message='배송 지역 구분을 확인해 주세요.'; end if;
  select * into v_address from public.shipping_addresses where id = p_shipping_address_id and member_id = auth.uid();
  if not found then raise exception using errcode='P0002', message='선택한 배송지를 찾을 수 없습니다.'; end if;
  v_checkout := public.create_commerce_manual_transfer_checkout(p_product_ids, p_idempotency_key, p_apply_shipping_credit, p_include_shipping_fee, p_shipping_region);
  v_order_id := (v_checkout->'order'->>'id')::uuid;
  select coalesce(payment_due_at, v_due) into v_due from public.commerce_orders where id = v_order_id and member_id = auth.uid() for update;
  update public.commerce_orders set shipping_address_id = v_address.id, shipping_address_snapshot = jsonb_build_object('label',v_address.label,'recipientName',v_address.recipient_name,'phone',v_address.phone,'postalCode',v_address.postal_code,'address',v_address.address), direct_ship = true, payment_due_at = v_due, updated_at = clock_timestamp() where id = v_order_id and member_id = auth.uid();
  update public.commerce_order_transfers set payment_due_at = v_due where order_id = v_order_id;
  v_checkout := jsonb_set(v_checkout, '{transfer,payment_due_at}', to_jsonb(v_due), true);
  return jsonb_set(v_checkout, '{order,payment_due_at}', to_jsonb(v_due), true);
end;
$$;
revoke all on function public.create_commerce_manual_transfer_checkout(uuid[],text,boolean,boolean,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_commerce_manual_transfer_checkout(uuid[],text,boolean,boolean,text,uuid) to authenticated;

create or replace function public.confirm_commerce_order_transfer(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_order public.commerce_orders%rowtype;
  v_transfer public.commerce_order_transfers%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if not public.is_staff() then raise exception using errcode='42501',message='운영자 권한이 필요합니다.'; end if;
  select * into v_order from public.commerce_orders where id=p_order_id for update;
  select * into v_transfer from public.commerce_order_transfers where order_id=p_order_id for update;
  if not found or v_transfer.status='cancelled' then raise exception using errcode='22023',message='입금 대기 내역을 찾을 수 없습니다.'; end if;
  if (select coalesce(sum(case when entry_type='receipt' then amount else -amount end),0) from public.manual_transfer_payment_ledger where commerce_order_transfer_id=v_transfer.id) <> v_transfer.expected_amount then raise exception using errcode='55000',message='입금 원장 누적액이 주문 예정액과 일치하지 않습니다.'; end if;
  if v_transfer.payment_due_at is not null and v_now >= v_transfer.payment_due_at then raise exception using errcode='55000',message='입금 기한이 지나 자동 취소된 주문입니다.'; end if;
  if v_transfer.status='confirmed' then return true; end if;
  update public.commerce_order_transfers set status='confirmed',confirmed_at=v_now,confirmed_by=auth.uid() where id=v_transfer.id;
  update public.commerce_order_items set payment_status='paid',paid_at=v_now,storage_expires_at=null where order_id=p_order_id;
  update public.commerce_orders set status='paid',updated_at=v_now where id=p_order_id;
  perform app_private.auto_direct_purchase_shipments(p_order_id);
  insert into public.notifications(member_id,audience_role,kind,title,body,href) values(v_order.member_id,'member','payment_confirmed','입금이 확인되었습니다.','선택한 배송지로 배송 접수가 완료되었습니다.','/account#shipping');
  return true;
end;
$$;
revoke all on function public.confirm_commerce_order_transfer(uuid) from public,anon,authenticated,service_role;
grant execute on function public.confirm_commerce_order_transfer(uuid) to authenticated;

create or replace function app_private.expire_direct_purchase_transfers()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_order record; v_count integer := 0; v_warning integer;
begin
  for v_order in select o.id,o.member_id from public.commerce_orders o join public.commerce_order_transfers t on t.order_id=o.id where o.direct_ship and o.status in ('awaiting_payment','partially_paid') and t.status in ('awaiting_transfer','partially_paid') and coalesce(t.payment_due_at,o.created_at+interval '6 hours') <= clock_timestamp() for update of o,t loop
    update public.commerce_order_transfers set status='cancelled',cancelled_at=clock_timestamp(),cancellation_reason='direct_purchase_payment_timeout' where order_id=v_order.id;
    update public.commerce_order_items set payment_status='cancelled' where order_id=v_order.id;
    update public.commerce_orders set status='cancelled',updated_at=clock_timestamp() where id=v_order.id;
    update public.products set status='active',updated_at=clock_timestamp() where id in (select product_id from public.commerce_order_items where order_id=v_order.id);
    select count(*)+1 into v_warning from public.member_warnings where member_id=v_order.member_id;
    insert into public.member_warnings(member_id,category,reason,warning_number,created_by) values(v_order.member_id,'late_payment','즉시구매 주문 6시간 입금 기한 초과',v_warning,null);
    insert into public.notifications(member_id,audience_role,kind,title,body,href) values(v_order.member_id,'member','payment_cancelled','입금 기한 초과로 주문이 취소되었습니다.','즉시구매는 주문 후 6시간 이내 입금해야 하며 반복 미입금 시 구매·입찰이 제한될 수 있습니다.','/account#orders');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function app_private.expire_direct_purchase_transfers() from public,anon,authenticated,service_role;
do $$ begin
  if exists(select 1 from cron.job where jobname='expire-direct-purchase-transfers') then perform cron.unschedule((select jobid from cron.job where jobname='expire-direct-purchase-transfers' limit 1)); end if;
  perform cron.schedule('expire-direct-purchase-transfers','*/5 * * * *', $job$select app_private.expire_direct_purchase_transfers()$job$);
exception when undefined_table then null; end $$;

commit;
