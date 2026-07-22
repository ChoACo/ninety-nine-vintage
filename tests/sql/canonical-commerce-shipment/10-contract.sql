-- All fixture rows are created after the real canonical migrations.  The
-- helper uses only pre-existing commerce facts and lets the 50000 projection
-- trigger create its work rows; it then models completed central storage.
select test_support.assert_true(
  (
    select count(*) = 5 and bool_and(classes.relrowsecurity and classes.relforcerowsecurity)
    from pg_catalog.pg_class as classes
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'public'
      and classes.relname in (
        'commerce_shipments',
        'commerce_shipment_orders',
        'commerce_shipment_items',
        'commerce_shipment_events',
        'commerce_shipment_reconciliation_cases'
      )
  ),
  'every canonical shipment table must have forced RLS'
);
select test_support.assert_true(
  not pg_catalog.has_table_privilege('anon', 'public.commerce_shipments', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.commerce_shipments', 'UPDATE')
  and not pg_catalog.has_table_privilege('service_role', 'public.commerce_shipments', 'UPDATE'),
  'canonical shipment tables must not expose direct role grants'
);
select test_support.assert_true(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.request_commerce_order_shipment(uuid,uuid,uuid,text,bigint,text,text,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.request_commerce_order_shipment(uuid,uuid,uuid,text,bigint,text,text,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.pack_commerce_shipment(uuid,bigint,uuid,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.ship_commerce_shipment(uuid,bigint,text,text,uuid,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.correct_commerce_shipment_tracking(uuid,bigint,text,text,text,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_commerce_shipment_queue(boolean,integer,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.ship_commerce_shipment(uuid,bigint,text,text,uuid,text)',
    'EXECUTE'
  ),
  'canonical RPC execute grants must match the server and user boundaries'
);
select test_support.assert_true(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.mark_shipping_request_shipped(uuid,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.mark_shipping_request_shipped(uuid,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.mark_shipping_request_shipped(uuid,text,text)',
    'EXECUTE'
  ),
  'legacy dispatch RPC must be unreachable from every API role'
);

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000001', false);
select public.configure_fulfillment_center(
  '99000000-0000-4000-8000-000000000002', 0, '04524',
  '99 Eulji-ro, Jung-gu, Seoul', null, 'Central Intake', '+82-2-9900-9900',
  '70000000-0000-4000-8000-000000000001'
);
reset role;
select set_config('app.test_user_id', '', false);

insert into public.member_accounts (member_id, account_status, shipping_credit_count)
values ('10000000-0000-4000-8000-000000000006', 'active', 1);
insert into public.shipping_addresses (id, member_id, label, recipient_name, phone, postal_code, address)
values ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006', 'Home', 'Member Six', '+82-10-9900-0006', '04524', '99 Eulji-ro, Seoul');

do $$
begin
  begin
    insert into public.shipping_requests (
      id, member_id, address_id, address_snapshot, idempotency_key
    ) values (
      '61000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000006',
      '60000000-0000-4000-8000-000000000001',
      '{}'::jsonb,
      'unclassified-contract'
    );
    set constraints all immediate;
    raise exception using errcode = 'P0001', message = 'unclassified shipping request unexpectedly committed';
  exception when sqlstate '23514' then
    null;
  end;
end;
$$;
select test_support.assert_true(
  not exists (
    select 1 from public.shipping_requests
    where id = '61000000-0000-4000-8000-000000000001'
  ),
  'unclassified shipping request must roll back atomically'
);

create or replace function test_support.create_paid_center_stored_order(p_number integer)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_order_id uuid := ('40000000-0000-4000-8000-' || lpad(p_number::text, 12, '0'))::uuid;
  v_item_id uuid := ('50000000-0000-4000-8000-' || lpad(p_number::text, 12, '0'))::uuid;
  v_product_id uuid := ('30000000-0000-4000-8000-' || lpad(p_number::text, 12, '0'))::uuid;
  v_transfer_id uuid := ('90000000-0000-4000-8000-' || lpad(p_number::text, 12, '0'))::uuid;
  v_work_id uuid;
begin
  insert into public.products (id, store_id, title) values (v_product_id, '20000000-0000-4000-8000-000000000001', 'Canonical fixture ' || p_number);
  insert into public.commerce_orders (id, member_id, status, total) values (v_order_id, '10000000-0000-4000-8000-000000000006', 'paid', 10000);
  insert into public.commerce_order_items (id, order_id, product_id, store_id, unit_price, payment_status, paid_at, storage_expires_at)
  values (v_item_id, v_order_id, v_product_id, '20000000-0000-4000-8000-000000000001', 10000, 'paid', clock_timestamp(), clock_timestamp() + interval '7 days');
  insert into public.commerce_order_transfers (id, order_id, member_id, expected_amount, status, confirmed_at, confirmed_by)
  values (v_transfer_id, v_order_id, '10000000-0000-4000-8000-000000000006', 10000, 'confirmed', clock_timestamp(), '10000000-0000-4000-8000-000000000001');
  insert into public.manual_transfer_payment_ledger (transfer_kind, commerce_order_transfer_id, entry_type, amount, depositor_name, recorded_by)
  values ('commerce', v_transfer_id, 'receipt', 10000, 'Member Six', '10000000-0000-4000-8000-000000000001');
  update public.order_item_fulfillments
  set current_stage = 'center_stored', location_kind = 'center', storage_location_code = 'RACK-' || p_number, version = version + 1
  where order_item_id = v_item_id;
  select work_id into v_work_id from public.order_item_fulfillments where order_item_id = v_item_id;
  perform app_private.refresh_fulfillment_work_status(v_work_id, null, clock_timestamp());
  return v_order_id;
end;
$$;

select test_support.create_paid_center_stored_order(number) from generate_series(1, 5) as number;
create table test_support.shipment_fixture (
  fixture text primary key, order_id uuid not null, shipment_id uuid not null, payment_id uuid
);
grant select on test_support.shipment_fixture to authenticated;
grant select, insert on test_support.shipment_fixture to service_role;

set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
do $$
declare v_result jsonb;
begin
  v_result := public.request_commerce_order_shipment('10000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'manual_transfer', 3000, 'Ninety Nine', '110-99-0001', '80000000-0000-4000-8000-000000000001');
  insert into test_support.shipment_fixture values ('manual', '40000000-0000-4000-8000-000000000001', (v_result ->> 'shipment_id')::uuid, ((v_result -> 'payment' ->> 'id')::uuid));
  perform test_support.assert_true(not (v_result ->> 'idempotent_replay')::boolean and v_result ->> 'settlement_method' = 'manual_transfer', 'manual request must create canonical settlement XOR');
  v_result := public.request_commerce_order_shipment('10000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'manual_transfer', 3000, 'Ninety Nine', '110-99-0001', '80000000-0000-4000-8000-000000000001');
  perform test_support.assert_true((v_result ->> 'idempotent_replay')::boolean, 'request exact replay must be idempotent');
end;
$$;
select test_support.expect_sqlstate($$select public.request_commerce_order_shipment('10000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','manual_transfer',4000,'Ninety Nine','110-99-0001','80000000-0000-4000-8000-000000000001')$$, '22000', 'request replay key must reject a different payload');

do $$ declare v_result jsonb; begin
  v_result := public.request_commerce_order_shipment('10000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','shipping_credit',null,null,null,'80000000-0000-4000-8000-000000000002');
  insert into test_support.shipment_fixture values ('credit','40000000-0000-4000-8000-000000000002',(v_result ->> 'shipment_id')::uuid,null);
  perform test_support.assert_true(v_result ->> 'settlement_method' = 'shipping_credit', 'credit request must atomically consume a credit');
end $$;
do $$ declare v_result jsonb; begin
  for i in 3..5 loop
    v_result := public.request_commerce_order_shipment('10000000-0000-4000-8000-000000000006', ('40000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, '60000000-0000-4000-8000-000000000001', 'manual_transfer', 3000, 'Ninety Nine', '110-99-0001', ('80000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid);
    insert into test_support.shipment_fixture values ('concurrent' || i, ('40000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, (v_result ->> 'shipment_id')::uuid, ((v_result -> 'payment' ->> 'id')::uuid));
  end loop;
end $$;
reset role;
select set_config('request.jwt.claim.role', '', false);

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000001', false);
select test_support.expect_sqlstate($$select public.pack_commerce_shipment((select shipment_id from test_support.shipment_fixture where fixture='manual'),0,'81000000-0000-4000-8000-000000000001','must wait for fee')$$, '55000', 'unpaid manual shipment must not pack');
reset role;
insert into public.manual_transfer_payment_ledger (transfer_kind, shipping_fee_payment_id, entry_type, amount, depositor_name, recorded_by)
select 'shipping', payment_id, 'receipt', 3000, 'Member Six', '10000000-0000-4000-8000-000000000001' from test_support.shipment_fixture where payment_id is not null;
update public.shipping_fee_payments set status='confirmed', confirmed_at=clock_timestamp(), confirmed_by='10000000-0000-4000-8000-000000000001' where id in (select payment_id from test_support.shipment_fixture where payment_id is not null);

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000001', false);
do $$ declare v_result jsonb; begin
  v_result := public.pack_commerce_shipment((select shipment_id from test_support.shipment_fixture where fixture='manual'),0,'81000000-0000-4000-8000-000000000002','manual packed');
  perform test_support.assert_true(v_result ->> 'status' = 'packed' and not (v_result ->> 'idempotent_replay')::boolean, 'paid manual shipment must pack');
  v_result := public.pack_commerce_shipment((select shipment_id from test_support.shipment_fixture where fixture='manual'),0,'81000000-0000-4000-8000-000000000002','manual packed');
  perform test_support.assert_true((v_result ->> 'idempotent_replay')::boolean, 'pack exact replay must be idempotent');
end $$;
select test_support.expect_sqlstate($$select public.pack_commerce_shipment((select shipment_id from test_support.shipment_fixture where fixture='manual'),0,'81000000-0000-4000-8000-000000000003','stale')$$, '55000', 'stale pack version must fail');
select test_support.expect_sqlstate($$select public.pack_commerce_shipment((select shipment_id from test_support.shipment_fixture where fixture='manual'),1,'81000000-0000-4000-8000-000000000002','different')$$, '22000', 'pack replay key must reject a different payload');
do $$ declare v_result jsonb; begin
  v_result := public.ship_commerce_shipment((select shipment_id from test_support.shipment_fixture where fixture='manual'),1,'CJ','MANUAL-1','82000000-0000-4000-8000-000000000001','manual dispatch');
  perform test_support.assert_true(v_result ->> 'status' = 'shipped' and not (v_result ->> 'idempotent_replay')::boolean, 'manual packed shipment must ship');
  v_result := public.ship_commerce_shipment((select shipment_id from test_support.shipment_fixture where fixture='manual'),1,'CJ','MANUAL-1','82000000-0000-4000-8000-000000000001','manual dispatch');
  perform test_support.assert_true((v_result ->> 'idempotent_replay')::boolean, 'ship exact replay must be idempotent');
end $$;
select test_support.expect_sqlstate($$select public.ship_commerce_shipment((select shipment_id from test_support.shipment_fixture where fixture='manual'),1,'CJ','OTHER','82000000-0000-4000-8000-000000000001','manual dispatch')$$, '22000', 'ship replay key must reject a different payload');
select test_support.expect_sqlstate($$select public.ship_commerce_shipment((select shipment_id from test_support.shipment_fixture where fixture='manual'),1,'CJ','OTHER','82000000-0000-4000-8000-000000000002','stale')$$, '55000', 'stale ship version must fail');
do $$ declare v_result jsonb; begin
  v_result := public.correct_commerce_shipment_tracking((select shipment_id from test_support.shipment_fixture where fixture='manual'),2,'CJ','MANUAL-1-CORRECTED','carrier label correction','83000000-0000-4000-8000-000000000001');
  perform test_support.assert_true(v_result ->> 'tracking_number' = 'MANUAL-1-CORRECTED', 'owner must correct shipped tracking');
end $$;
reset role;
select test_support.expect_sqlstate($$update public.commerce_shipment_events set reason='tamper' where false$$, '55000', 'shipment events must be append-only');
select test_support.expect_sqlstate($$update public.commerce_order_items set store_id='20000000-0000-4000-8000-000000000002' where order_id='40000000-0000-4000-8000-000000000001'$$, '55000', 'canonical shipment source identity must be immutable');
select test_support.expect_sqlstate($$delete from public.shipping_request_items where request_id=(select shipping_request_id from public.commerce_shipments where id=(select shipment_id from test_support.shipment_fixture where fixture='manual'))$$, '55000', 'canonical request manifest must be immutable');

do $$
begin
  begin
    insert into public.shipping_credit_ledger (
      member_id, delta, reason, shipping_request_id, created_by
    )
    select
      shipments.member_id,
      -1,
      'used',
      shipments.shipping_request_id,
      shipments.member_id
    from public.commerce_shipments as shipments
    where shipments.id = (
      select shipment_id from test_support.shipment_fixture where fixture = 'manual'
    );
    set constraints all immediate;
    raise exception using errcode = 'P0001', message = 'manual shipment accepted a credit settlement';
  exception when sqlstate '23514' then
    null;
  end;
end;
$$;
select test_support.assert_true(
  not exists (
    select 1
    from public.shipping_credit_ledger as credits
    join public.commerce_shipments as shipments
      on shipments.shipping_request_id = credits.shipping_request_id
    where shipments.id = (
      select shipment_id from test_support.shipment_fixture where fixture = 'manual'
    )
  ),
  'manual shipment must retain fee-only settlement after a rejected credit insert'
);

do $$
begin
  begin
    insert into public.shipping_fee_payments (
      member_id,
      shipping_request_id,
      expected_amount,
      bank_name_snapshot,
      account_number_snapshot,
      idempotency_key
    )
    select
      shipments.member_id,
      shipments.shipping_request_id,
      3000,
      'Ninety Nine',
      '110-99-0001',
      'credit-opposite-settlement'
    from public.commerce_shipments as shipments
    where shipments.id = (
      select shipment_id from test_support.shipment_fixture where fixture = 'credit'
    );
    set constraints all immediate;
    raise exception using errcode = 'P0001', message = 'credit shipment accepted a fee settlement';
  exception when sqlstate '23514' then
    null;
  end;
end;
$$;
select test_support.assert_true(
  not exists (
    select 1
    from public.shipping_fee_payments as payments
    join public.commerce_shipments as shipments
      on shipments.shipping_request_id = payments.shipping_request_id
    where shipments.id = (
      select shipment_id from test_support.shipment_fixture where fixture = 'credit'
    )
  ),
  'credit shipment must retain credit-only settlement after a rejected fee insert'
);

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000002', false);
select test_support.expect_sqlstate($$select public.correct_commerce_shipment_tracking((select shipment_id from test_support.shipment_fixture where fixture='manual'),3,'CJ','NOPE','not allowed','83000000-0000-4000-8000-000000000002')$$, '42501', 'only owner may correct tracking');
select test_support.expect_sqlstate($$update public.commerce_shipments set version=version+1 where false$$, '42501', 'authenticated users must not directly mutate canonical shipments');
select test_support.expect_sqlstate($$select public.mark_shipping_request_shipped('00000000-0000-4000-8000-000000000001','CJ','legacy')$$, '42501', 'legacy shipment RPC must have no authenticated execute grant');
reset role;

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000001', false);
select public.pack_commerce_shipment((select shipment_id from test_support.shipment_fixture where fixture='credit'),0,'81000000-0000-4000-8000-000000000010','credit packed');
select public.ship_commerce_shipment((select shipment_id from test_support.shipment_fixture where fixture='credit'),1,'CJ','CREDIT-1','82000000-0000-4000-8000-000000000010','credit dispatch');
reset role;
select test_support.assert_true((select shipping_credit_ledger_id is not null and shipping_fee_payment_id is null from public.commerce_shipments where id=(select shipment_id from test_support.shipment_fixture where fixture='credit')), 'credit shipment must retain settlement XOR');
select test_support.assert_true(
  (
    select orders.status = 'shipped'
      and requests.status = 'shipped'
      and fulfillments.current_stage = 'shipped'
      and fulfillments.location_kind = 'transit'
    from test_support.shipment_fixture as fixtures
    join public.commerce_shipment_orders as shipment_orders
      on shipment_orders.shipment_id = fixtures.shipment_id
    join public.commerce_orders as orders on orders.id = shipment_orders.order_id
    join public.commerce_shipments as shipments on shipments.id = fixtures.shipment_id
    join public.shipping_requests as requests on requests.id = shipments.shipping_request_id
    join public.commerce_shipment_items as shipment_items
      on shipment_items.shipment_id = shipments.id
    join public.order_item_fulfillments as fulfillments
      on fulfillments.order_item_id = shipment_items.order_item_id
    where fixtures.fixture = 'manual'
  ),
  'one ship command must atomically project order, request, and item transit state'
);
