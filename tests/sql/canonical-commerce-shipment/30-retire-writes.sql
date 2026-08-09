-- Runs after 20260808000000_retire_commerce_shipment_writes.sql.  The previous
-- 10-contract/20-concurrency files prove the canonical commerce writer surface
-- before retirement; this file locks the retired surface and the immutable
-- history guards that the new migration installs.
select test_support.assert_true(
  not pg_catalog.has_function_privilege(
    'public',
    'public.request_commerce_order_shipment(uuid,uuid,uuid,text,bigint,text,text,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.request_commerce_order_shipment(uuid,uuid,uuid,text,bigint,text,text,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.request_commerce_order_shipment(uuid,uuid,uuid,text,bigint,text,text,uuid)',
    'EXECUTE'
  ),
  'legacy order request writer must be unreachable from every API role'
);
select test_support.assert_true(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.pack_commerce_shipment(uuid,bigint,uuid,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.ship_commerce_shipment(uuid,bigint,text,text,uuid,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.correct_commerce_shipment_tracking(uuid,bigint,text,text,text,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.pack_commerce_shipment(uuid,bigint,uuid,text)',
    'EXECUTE'
  ),
  'legacy pack/ship/tracking writers must be unreachable from every API role'
);
select test_support.assert_true(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_commerce_shipment_queue(boolean,integer,integer)',
    'EXECUTE'
  ),
  'read-only compatibility queue must remain available'
);
select test_support.assert_true(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'app_private.get_commerce_shipment_compat(uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'app_private.get_commerce_shipment_compat(uuid)',
    'EXECUTE'
  ),
  'compatibility adapter must be an internal app_private contract'
);

-- shipping_requests: no new projections and no history deletion.  The account
-- deletion anonymizer still needs to null the member link, so only insert and
-- delete are guarded; fact updates stay behind the canonical projection guard.
select test_support.expect_sqlstate(
  $insert$
    insert into public.shipping_requests (id, member_id, address_id, address_snapshot, idempotency_key)
    values (
      '62000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000006',
      '60000000-0000-4000-8000-000000000001',
      '{}'::jsonb,
      'retired-insert'
    )
  $insert$,
  '42501',
  'new shipping_requests projections must be rejected by the retired guard'
);
select test_support.expect_sqlstate(
  $delete$
    delete from public.shipping_requests
    where id = (
      select shipping_request_id
      from public.commerce_shipments
      where id = (
        select shipment_id from test_support.shipment_fixture where fixture = 'manual'
      )
    )
  $delete$,
  '42501',
  'legacy shipping_requests history must never be deleted'
);

-- The anonymizer-style member link nulling must still be allowed for account
-- deletion; only insert/delete are blocked by the retired guard.
do $$
begin
  update public.shipping_requests
  set member_id = member_id
  where id = (
    select shipping_request_id
    from public.commerce_shipments
    where id = (
      select shipment_id from test_support.shipment_fixture where fixture = 'manual'
    )
  );
end;
$$;

-- commerce_shipments: immutable compatibility history.  The trigger fires even
-- for the table owner, so a direct DML attempt always fails closed.
select test_support.expect_sqlstate(
  $insert$
    insert into public.commerce_shipments (id, shipping_request_id, member_id, business_id, fulfillment_center_id, settlement_method, address_snapshot)
    values (
      '63000000-0000-4000-8000-000000000001',
      (select shipping_request_id from public.commerce_shipments where id = (select shipment_id from test_support.shipment_fixture where fixture = 'manual')),
      '10000000-0000-4000-8000-000000000006',
      '70000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      'manual_transfer',
      '{}'::jsonb
    )
  $insert$,
  '42501',
  'new commerce_shipments rows must be rejected as immutable history'
);
select test_support.expect_sqlstate(
  $update$
    update public.commerce_shipments
    set courier = 'CJ'
    where id = (
      select shipment_id from test_support.shipment_fixture where fixture = 'manual'
    )
  $update$,
  '42501',
  'commerce_shipments rows must be immutable'
);
select test_support.expect_sqlstate(
  $delete$
    delete from public.commerce_shipments
    where id = (
      select shipment_id from test_support.shipment_fixture where fixture = 'manual'
    )
  $delete$,
  '42501',
  'commerce_shipments history must never be deleted'
);
select test_support.expect_sqlstate(
  $events$
    insert into public.commerce_shipment_events (
      shipment_id, sequence_no, event_type, from_status, to_status, actor_kind,
      actor_role_snapshot, idempotency_key
    )
    values (
      (select shipment_id from test_support.shipment_fixture where fixture = 'manual'),
      99999,
      'tracking_corrected',
      'shipped',
      'shipped',
      'user',
      'owner',
      '99999999-0000-4000-8000-000000000001'
    )
  $events$,
  '42501',
  'commerce_shipment_events must stay append-only immutable history'
);

-- The compatibility adapter exposes the legacy shipment with stable identity
-- and the manifest facts; v2 tables are absent in this focused schema so the
-- linked v2 shipment ids must default to an empty array.
select test_support.assert_true(
  (select app_private.get_commerce_shipment_compat(
    (select shipment_id from test_support.shipment_fixture where fixture = 'manual')
  ) ->> 'sourceKind') = 'canonical_commerce'
  and (select (app_private.get_commerce_shipment_compat(
    (select shipment_id from test_support.shipment_fixture where fixture = 'manual')
  ) ->> 'sourceId')::uuid) = (
    select shipment_id from test_support.shipment_fixture where fixture = 'manual'
  )
  and (select app_private.get_commerce_shipment_compat(
    (select shipment_id from test_support.shipment_fixture where fixture = 'manual')
  ) ->> 'status') = 'shipped'
  and (select (app_private.get_commerce_shipment_compat(
    (select shipment_id from test_support.shipment_fixture where fixture = 'manual')
  ) ->> 'immutable')::boolean)
  and (select app_private.get_commerce_shipment_compat(
    (select shipment_id from test_support.shipment_fixture where fixture = 'manual')
  ) ->> 'trackingNumber') = 'MANUAL-1-CORRECTED'
  and (select jsonb_array_length(app_private.get_commerce_shipment_compat(
    (select shipment_id from test_support.shipment_fixture where fixture = 'manual')
  ) -> 'items')) = 1,
  'compatibility adapter must return immutable legacy facts with stable identity'
);
select test_support.assert_true(
  (select app_private.get_commerce_shipment_compat(
    '99999999-0000-4000-8000-000000000000'
  )) is null,
  'compatibility adapter must return null for an unknown legacy shipment'
);
