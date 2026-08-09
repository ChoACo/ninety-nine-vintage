begin;

insert into public.shipping_fee_payments(
  id, member_id, expected_amount, status, bank_name_snapshot,
  account_number_snapshot, business_id, payment_context
) values (
  '75000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  3000,
  'awaiting_transfer',
  '테스트은행',
  '000-000',
  '99000000-0000-4000-8000-000000000001',
  'shipping_credit'
);

insert into public.inventory_shipments(
  id, member_id, business_id, fulfillment_center_id, status,
  settlement_method, shipping_fee_payment_id, address_snapshot
) values (
  '76000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000002',
  'collecting',
  'manual_transfer',
  '75000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'label', '집',
    'recipientName', '홍길동',
    'phone', '010-1234-5678',
    'postalCode', '01234',
    'address', '서울시 실제 주소'
  )
);

update public.shipping_fee_payments
set inventory_shipment_id = '76000000-0000-4000-8000-000000000001'
where id = '75000000-0000-4000-8000-000000000001';

insert into public.inventory_shipment_items(
  shipment_id, inventory_item_id, member_id, business_id,
  fulfillment_center_id, product_id, origin_store_id, line_status
) values (
  '76000000-0000-4000-8000-000000000001',
  '3ea39fe6-e6b8-4efd-b17c-045aa6a08d72',
  '10000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'requested'
);

do $$
begin
  if app_private.can_access_inventory_shipment(
    '76000000-0000-4000-8000-000000000001',
    'create_shipments',
    '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'
  ) then
    raise exception 'prepare_orders must not imply create_shipments';
  end if;
end;
$$;

update public.store_memberships
set create_shipments = true
where user_id = '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'
  and store_id = '20000000-0000-4000-8000-000000000001';

do $$
begin
  if not app_private.can_access_inventory_shipment(
    '76000000-0000-4000-8000-000000000001',
    'create_shipments',
    '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'
  ) then
    raise exception 'direct store shipment permission was not accepted';
  end if;
  if app_private.can_access_inventory_shipment(
    '76000000-0000-4000-8000-000000000001',
    'create_shipments',
    '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'
  ) then
    raise exception 'unrelated store must not access shipment';
  end if;
end;
$$;

insert into public.store_fulfillment_groups(
  id, business_id, name, representative_store_id, is_active, version
) values (
  '77000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  '테스트 통합 물류',
  '20000000-0000-4000-8000-000000000001',
  true,
  0
);

insert into public.store_fulfillment_group_members(group_id, store_id, business_id)
values
  ('77000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001'),
  ('77000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '99000000-0000-4000-8000-000000000001');

do $$
begin
  if not app_private.can_access_inventory_shipment(
    '76000000-0000-4000-8000-000000000001',
    'create_shipments',
    '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'
  ) then
    raise exception 'active fulfillment group proxy permission was not accepted';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $$
declare
  v_queue jsonb := public.get_inventory_shipment_queue(false, 10, 0);
  v_shipment jsonb;
begin
  if jsonb_array_length(v_queue -> 'shipments') <> 1 then
    raise exception 'scoped queue must return exactly one authorized shipment';
  end if;
  v_shipment := v_queue -> 'shipments' -> 0;
  if v_shipment -> 'addressSnapshot' ->> 'recipientName' <> '작업 시 확인'
    or v_shipment -> 'addressSnapshot' ->> 'phone' <> '***-****-****'
    or v_shipment -> 'addressSnapshot' ->> 'address' <> '작업 시 확인'
  then
    raise exception 'shipment queue exposed unmasked delivery data';
  end if;
end;
$$;

reset role;
rollback;
