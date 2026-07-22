-- Real independent PostgreSQL backends validate both aggregate CAS and the
-- cross-shipment partial unique tracking key.  The RPC locks force a stable
-- loser result instead of relying on timing or a client-side retry.
create or replace function test_support.shipment_id_for_order(p_order_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select shipment_orders.shipment_id
  from public.commerce_shipment_orders as shipment_orders
  where shipment_orders.order_id = p_order_id
$$;
grant execute on function test_support.shipment_id_for_order(uuid) to authenticated;

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000001', false);
select public.pack_commerce_shipment(
  test_support.shipment_id_for_order('40000000-0000-4000-8000-000000000003'),
  0, '81000000-0000-4000-8000-000000000103', 'same shipment concurrency fixture'
);
select public.pack_commerce_shipment(
  test_support.shipment_id_for_order('40000000-0000-4000-8000-000000000004'),
  0, '81000000-0000-4000-8000-000000000104', 'tracking collision fixture A'
);
select public.pack_commerce_shipment(
  test_support.shipment_id_for_order('40000000-0000-4000-8000-000000000005'),
  0, '81000000-0000-4000-8000-000000000105', 'tracking collision fixture B'
);
reset role;

create or replace function test_support.capture_ship(
  p_shipment_id uuid, p_idempotency_key uuid, p_tracking_number text
) returns jsonb language plpgsql set search_path = '' as $$
begin
  return public.ship_commerce_shipment(p_shipment_id, 1, 'CJ', p_tracking_number, p_idempotency_key, 'concurrent contract');
exception when others then
  return jsonb_build_object('error', true, 'sqlstate', sqlstate, 'message', sqlerrm);
end;
$$;

create temporary table canonical_concurrency_results (
  scenario text not null, payload jsonb not null
);

select dblink_connect('same_a', 'dbname=canonical_commerce_shipment_test user=canonical_commerce_shipment_test');
select dblink_connect('same_b', 'dbname=canonical_commerce_shipment_test user=canonical_commerce_shipment_test');
select dblink_exec('same_a', 'set role authenticated');
select dblink_exec('same_b', 'set role authenticated');
select dblink_exec('same_a', $$set app.test_user_id = '10000000-0000-4000-8000-000000000001'$$);
select dblink_exec('same_b', $$set app.test_user_id = '10000000-0000-4000-8000-000000000001'$$);
select dblink_send_query('same_a', $$select test_support.capture_ship(test_support.shipment_id_for_order('40000000-0000-4000-8000-000000000003'),'82000000-0000-4000-8000-000000000103','CAS-A')$$);
select dblink_send_query('same_b', $$select test_support.capture_ship(test_support.shipment_id_for_order('40000000-0000-4000-8000-000000000003'),'82000000-0000-4000-8000-000000000104','CAS-B')$$);
insert into canonical_concurrency_results
select 'same-shipment', payload from dblink_get_result('same_a') as result(payload jsonb)
union all
select 'same-shipment', payload from dblink_get_result('same_b') as result(payload jsonb);
select dblink_disconnect('same_a');
select dblink_disconnect('same_b');

select test_support.assert_true(
  (select count(*) from canonical_concurrency_results where scenario='same-shipment' and payload ->> 'status' = 'shipped') = 1
  and (select count(*) from canonical_concurrency_results where scenario='same-shipment' and payload ->> 'sqlstate' = '55000') = 1,
  'two concurrent ships of one shipment must yield exactly one winner and one stale-CAS failure'
);

select dblink_connect('tracking_a', 'dbname=canonical_commerce_shipment_test user=canonical_commerce_shipment_test');
select dblink_connect('tracking_b', 'dbname=canonical_commerce_shipment_test user=canonical_commerce_shipment_test');
select dblink_exec('tracking_a', 'set role authenticated');
select dblink_exec('tracking_b', 'set role authenticated');
select dblink_exec('tracking_a', $$set app.test_user_id = '10000000-0000-4000-8000-000000000001'$$);
select dblink_exec('tracking_b', $$set app.test_user_id = '10000000-0000-4000-8000-000000000001'$$);
select dblink_send_query('tracking_a', $$select test_support.capture_ship(test_support.shipment_id_for_order('40000000-0000-4000-8000-000000000004'),'82000000-0000-4000-8000-000000000204','SHARED-TRACKING')$$);
select dblink_send_query('tracking_b', $$select test_support.capture_ship(test_support.shipment_id_for_order('40000000-0000-4000-8000-000000000005'),'82000000-0000-4000-8000-000000000205','SHARED-TRACKING')$$);
insert into canonical_concurrency_results
select 'tracking-collision', payload from dblink_get_result('tracking_a') as result(payload jsonb)
union all
select 'tracking-collision', payload from dblink_get_result('tracking_b') as result(payload jsonb);
select dblink_disconnect('tracking_a');
select dblink_disconnect('tracking_b');

select test_support.assert_true(
  (select count(*) from canonical_concurrency_results where scenario='tracking-collision' and payload ->> 'status' = 'shipped') = 1
  and (select count(*) from canonical_concurrency_results where scenario='tracking-collision' and payload ->> 'sqlstate' in ('23505', '55000')) = 1,
  'same tracking on distinct shipments must yield exactly one winner and a canonical conflict'
);
select test_support.assert_true(
  (select count(*) from public.commerce_shipments where courier='CJ' and tracking_number='SHARED-TRACKING' and status='shipped') = 1,
  'the partial unique tracking key must retain exactly one shipped row'
);
