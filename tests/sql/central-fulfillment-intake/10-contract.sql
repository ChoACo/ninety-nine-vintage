create or replace function test_support.expect_sqlstate(
  p_statement text,
  p_expected_state text,
  p_message text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_failed boolean := false;
begin
  begin
    execute p_statement;
  exception
    when others then
      if sqlstate <> p_expected_state then
        raise exception using
          errcode = 'P0001',
          message = p_message || ' (expected ' || p_expected_state
            || ', received ' || sqlstate || ': ' || sqlerrm || ')';
      end if;
      v_failed := true;
  end;

  if not v_failed then
    raise exception using
      errcode = 'P0001',
      message = p_message || ' (statement unexpectedly succeeded)';
  end if;
end;
$$;

grant execute on function test_support.expect_sqlstate(text, text, text)
to anon, authenticated, service_role;

select test_support.assert_true(
  (select count(*) = 2 from public.stores where business_id = '99000000-0000-4000-8000-000000000001'),
  'foundation must project both stores into the default business'
);
select test_support.assert_true(
  (select count(*) = 4 from public.store_memberships),
  'membership migration must backfill both operators and their employees'
);
select test_support.assert_true(
  (select count(*) = 0 from public.store_fulfillment_works)
    and (select count(*) = 0 from public.order_item_fulfillments),
  'an empty operational order state must remain projection-free through all migrations'
);
select test_support.assert_true(
  (select extnamespace = 'extensions'::regnamespace
   from pg_catalog.pg_extension
   where extname = 'pgcrypto'),
  'pgcrypto must be installed in the extensions schema'
);

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000001', false);

do $$
declare
  v_result jsonb;
begin
  v_result := public.configure_fulfillment_center(
    '99000000-0000-4000-8000-000000000002',
    0,
    '04524',
    '99 Eulji-ro, Jung-gu, Seoul',
    'NINETY-NINE intake desk',
    'Central Intake',
    '+82-2-9900-9900',
    '70000000-0000-4000-8000-000000000001'
  );
  perform test_support.assert_true(
    v_result ->> 'status' = 'active'
      and (v_result ->> 'version')::bigint = 1
      and not (v_result ->> 'idempotent_replay')::boolean,
    'owner must activate the center with CAS version 0'
  );

  v_result := public.configure_fulfillment_center(
    '99000000-0000-4000-8000-000000000002',
    0,
    '04524',
    '99 Eulji-ro, Jung-gu, Seoul',
    'NINETY-NINE intake desk',
    'Central Intake',
    '+82-2-9900-9900',
    '70000000-0000-4000-8000-000000000001'
  );
  perform test_support.assert_true(
    (v_result ->> 'version')::bigint = 1
      and (v_result ->> 'idempotent_replay')::boolean,
    'an exact center configuration replay must be idempotent'
  );
end;
$$;

select test_support.expect_sqlstate(
  $sql$
    select public.configure_fulfillment_center(
      '99000000-0000-4000-8000-000000000002', 0, '04524',
      'DIFFERENT ADDRESS', null, 'Central Intake', '+82-2-9900-9900',
      '70000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '22000',
  'an idempotency key must not be reusable for different center input'
);
select test_support.expect_sqlstate(
  $sql$
    select public.configure_fulfillment_center(
      '99000000-0000-4000-8000-000000000002', 0, '04524',
      '99 Eulji-ro, Jung-gu, Seoul', null, 'Central Intake', '+82-2-9900-9900',
      '70000000-0000-4000-8000-000000000002'
    )
  $sql$,
  '55000',
  'a stale center version must fail closed'
);

do $$
declare
  v_membership_id uuid;
  v_version bigint;
  v_new_version bigint;
  v_replayed boolean;
begin
  select memberships.id, memberships.version
  into v_membership_id, v_version
  from public.store_memberships as memberships
  where memberships.store_id = '20000000-0000-4000-8000-000000000001'
    and memberships.user_id = '10000000-0000-4000-8000-000000000002';

  select configured.membership_version, configured.replayed
  into v_new_version, v_replayed
  from public.set_store_membership_access(
    v_membership_id,
    v_version,
    '71000000-0000-4000-8000-000000000001',
    'active',
    jsonb_build_object(
      'manage_products', true,
      'publish_products', true,
      'prepare_orders', true,
      'confirm_payments', true,
      'receive_at_center', true,
      'create_shipments', false,
      'manage_staff', true,
      'view_reports', true
    ),
    'Grant central intake permission for integration contract'
  ) as configured;

  perform test_support.assert_true(
    v_new_version = v_version + 1 and not v_replayed,
    'owner must explicitly grant central intake permission'
  );
end;
$$;

reset role;
select set_config('app.test_user_id', '', false);

insert into public.products (
  id, store_id, title, thumbnail_urls, image_urls
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Store A jacket',
    array['https://example.test/a-jacket-thumb.jpg'],
    '{}'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'Store A boots',
    '{}',
    array['https://example.test/a-boots.jpg']
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000002',
    'Store B bag',
    '{}',
    '{}'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001',
    'Cancelled item',
    '{}',
    '{}'
  );

insert into public.commerce_orders (id, member_id, status) values
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000006',
    'awaiting_payment'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000006',
    'cancelled'
  );

insert into public.commerce_order_items (
  id, order_id, product_id, store_id, payment_status, paid_at
) values
  (
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'awaiting_payment',
    null
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'awaiting_payment',
    null
  ),
  (
    '50000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000002',
    'awaiting_payment',
    null
  );

insert into public.commerce_order_items (
  id, order_id, product_id, store_id, payment_status, paid_at
) values (
  '50000000-0000-4000-8000-000000000004',
  '40000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000001',
  'cancelled',
  null
);

select test_support.assert_true(
  (select count(*) = 2
   from public.store_fulfillment_works
   where order_id = '40000000-0000-4000-8000-000000000001'),
  'one multi-store order must initialize one work per store'
);
select test_support.assert_true(
  (select count(*) = 3
   from public.order_item_fulfillments
   where order_id = '40000000-0000-4000-8000-000000000001'
     and current_stage = 'waiting_payment'
     and location_kind = 'store'),
  'new unpaid items must initialize at the owning store'
);
select test_support.assert_true(
  (select count(*) = 4
   from public.fulfillment_events
   where event_type = 'initialized' and sequence_no = 1),
  'every post-migration item must receive one initialization event'
);

update public.commerce_order_items
set payment_status = 'paid', paid_at = clock_timestamp()
where id = '50000000-0000-4000-8000-000000000001';
select test_support.assert_true(
  (select current_stage = 'preparing'
   from public.order_item_fulfillments
   where order_item_id = '50000000-0000-4000-8000-000000000001'),
  'awaiting-to-paid must start item preparation'
);

update public.commerce_order_items
set payment_status = 'awaiting_payment', paid_at = null
where id = '50000000-0000-4000-8000-000000000001';
select test_support.assert_true(
  (select current_stage = 'waiting_payment'
   from public.order_item_fulfillments
   where order_item_id = '50000000-0000-4000-8000-000000000001'),
  'paid-to-awaiting must reverse preparation before physical work advances'
);

select test_support.expect_sqlstate(
  $sql$
    update public.commerce_order_items
    set payment_status = 'paid', paid_at = clock_timestamp()
    where id = '50000000-0000-4000-8000-000000000004'
  $sql$,
  '55000',
  'cancelled-to-paid is not an allowed payment transition'
);

update public.commerce_order_items
set payment_status = 'paid', paid_at = clock_timestamp()
where order_id = '40000000-0000-4000-8000-000000000001';
update public.commerce_orders
set status = 'paid'
where id = '40000000-0000-4000-8000-000000000001';

select test_support.assert_true(
  (select count(*) = 3
   from public.order_item_fulfillments
   where order_id = '40000000-0000-4000-8000-000000000001'
     and current_stage = 'preparing'
     and location_kind = 'store'),
  'all paid items must be ready for store preparation'
);

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000002', false);
select test_support.assert_true(
  (select count(*) = 1 from public.get_store_fulfillment_queue(100, 0))
    and not exists (
      select 1
      from public.get_store_fulfillment_queue(100, 0)
      where store_id <> '20000000-0000-4000-8000-000000000001'
    ),
  'Store A operator queue must be scoped to Store A'
);

do $$
declare
  v_work_id uuid;
  v_version bigint;
  v_result jsonb;
begin
  select works.id, works.version into v_work_id, v_version
  from public.store_fulfillment_works as works
  where works.order_id = '40000000-0000-4000-8000-000000000001'
    and works.store_id = '20000000-0000-4000-8000-000000000001';

  v_result := public.advance_store_fulfillment_work(
    v_work_id, v_version, 'mark_ready',
    '72000000-0000-4000-8000-000000000001', 'Store A packed'
  );
  perform test_support.assert_true(
    v_result ->> 'status' = 'ready_for_transfer'
      and not (v_result ->> 'idempotent_replay')::boolean,
    'Store A operator must mark its own paid work ready'
  );

  v_result := public.advance_store_fulfillment_work(
    v_work_id, v_version, 'mark_ready',
    '72000000-0000-4000-8000-000000000001', 'Store A packed'
  );
  perform test_support.assert_true(
    (v_result ->> 'idempotent_replay')::boolean,
    'an exact store-work command replay must be idempotent'
  );
end;
$$;

select test_support.expect_sqlstate(
  $sql$
    select public.advance_store_fulfillment_work(
      works.id, works.version, 'mark_ready',
      '72000000-0000-4000-8000-000000000002', 'cross-store attempt'
    )
    from public.store_fulfillment_works as works
    where works.order_id = '40000000-0000-4000-8000-000000000001'
      and works.store_id = '20000000-0000-4000-8000-000000000002'
  $sql$,
  '42501',
  'Store A operator must not advance Store B work'
);

select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000003', false);
select test_support.assert_true(
  (select count(*) = 1 from public.get_store_fulfillment_queue(100, 0))
    and not exists (
      select 1
      from public.get_store_fulfillment_queue(100, 0)
      where store_id <> '20000000-0000-4000-8000-000000000002'
    ),
  'Store B operator queue must be scoped to Store B'
);

do $$
declare
  v_work_id uuid;
  v_version bigint;
begin
  select works.id, works.version into v_work_id, v_version
  from public.store_fulfillment_works as works
  where works.order_id = '40000000-0000-4000-8000-000000000001'
    and works.store_id = '20000000-0000-4000-8000-000000000002';
  perform public.advance_store_fulfillment_work(
    v_work_id, v_version, 'mark_ready',
    '72000000-0000-4000-8000-000000000003', 'Store B packed'
  );
end;
$$;

select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000006', false);
select test_support.assert_true(
  (select count(*) = 0 from public.get_store_fulfillment_queue(100, 0)),
  'ordinary members must have no store fulfillment queue'
);

reset role;
select set_config('app.test_user_id', '', false);
select test_support.expect_sqlstate(
  $sql$
    update public.commerce_order_items
    set payment_status = 'awaiting_payment', paid_at = null
    where id = '50000000-0000-4000-8000-000000000001'
  $sql$,
  '55000',
  'payment reversal must fail after store work reaches ready-for-transfer'
);

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000002', false);
do $$
declare
  v_work_id uuid;
  v_version bigint;
begin
  select works.id, works.version into v_work_id, v_version
  from public.store_fulfillment_works as works
  where works.order_id = '40000000-0000-4000-8000-000000000001'
    and works.store_id = '20000000-0000-4000-8000-000000000001';
  perform public.advance_store_fulfillment_work(
    v_work_id, v_version, 'hand_over',
    '72000000-0000-4000-8000-000000000004', 'Transferred to center'
  );
end;
$$;

select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000003', false);
do $$
declare
  v_work_id uuid;
  v_version bigint;
begin
  select works.id, works.version into v_work_id, v_version
  from public.store_fulfillment_works as works
  where works.order_id = '40000000-0000-4000-8000-000000000001'
    and works.store_id = '20000000-0000-4000-8000-000000000002';
  perform public.advance_store_fulfillment_work(
    v_work_id, v_version, 'hand_over',
    '72000000-0000-4000-8000-000000000005', 'Transferred to center'
  );
end;
$$;

select test_support.assert_true(
  (select count(*) = 0 from public.get_center_fulfillment_queue(100, 0)),
  'Store B operator must not inherit central intake scope'
);

select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000002', false);
select test_support.assert_true(
  (select count(*) = 2 from public.get_center_fulfillment_queue(100, 0)),
  'explicit central permission must expose both in-transit stores in the business'
);

do $$
declare
  v_version bigint;
  v_result jsonb;
begin
  select version into v_version
  from public.order_item_fulfillments
  where order_item_id = '50000000-0000-4000-8000-000000000001';
  v_result := public.record_center_item_action(
    '50000000-0000-4000-8000-000000000001', v_version, 'receive',
    '73000000-0000-4000-8000-000000000001', null, null, 'First parcel arrived'
  );
  perform test_support.assert_true(
    v_result ->> 'stage' = 'center_received'
      and v_result ->> 'work_status' = 'partially_received',
    'receiving one of two Store A items must create a partial receipt'
  );

  v_result := public.record_center_item_action(
    '50000000-0000-4000-8000-000000000001', v_version, 'receive',
    '73000000-0000-4000-8000-000000000001', null, null, 'First parcel arrived'
  );
  perform test_support.assert_true(
    (v_result ->> 'idempotent_replay')::boolean,
    'an exact center item command replay must be idempotent'
  );

  select version into v_version
  from public.order_item_fulfillments
  where order_item_id = '50000000-0000-4000-8000-000000000001';
  v_result := public.record_center_item_action(
    '50000000-0000-4000-8000-000000000001', v_version, 'report_issue',
    '73000000-0000-4000-8000-000000000002', null, 'damaged_box',
    'Outer box is damaged; item inspection required'
  );
  perform test_support.assert_true(
    (v_result ->> 'is_blocked')::boolean
      and v_result ->> 'work_status' = 'issue',
    'reporting an issue must block the item and aggregate work'
  );

  select version into v_version
  from public.order_item_fulfillments
  where order_item_id = '50000000-0000-4000-8000-000000000001';
  v_result := public.record_center_item_action(
    '50000000-0000-4000-8000-000000000001', v_version, 'resolve_issue',
    '73000000-0000-4000-8000-000000000003', null, 'inspection_passed',
    'Inspection passed and the item is undamaged'
  );
  perform test_support.assert_true(
    not (v_result ->> 'is_blocked')::boolean
      and v_result ->> 'work_status' = 'partially_received',
    'resolving the issue must restore partial-receipt aggregation'
  );

  select version into v_version
  from public.order_item_fulfillments
  where order_item_id = '50000000-0000-4000-8000-000000000001';
  v_result := public.record_center_item_action(
    '50000000-0000-4000-8000-000000000001', v_version, 'store',
    '73000000-0000-4000-8000-000000000004', 'RACK-A-01', null,
    'Stored after inspection'
  );
  perform test_support.assert_true(
    v_result ->> 'stage' = 'center_stored'
      and v_result ->> 'storage_location_code' = 'RACK-A-01'
      and v_result ->> 'work_status' = 'partially_received',
    'a received item must retain a concrete center storage location'
  );

  select version into v_version
  from public.order_item_fulfillments
  where order_item_id = '50000000-0000-4000-8000-000000000002';
  v_result := public.record_center_item_action(
    '50000000-0000-4000-8000-000000000002', v_version, 'receive',
    '73000000-0000-4000-8000-000000000005', null, null,
    'Second Store A parcel arrived'
  );
  perform test_support.assert_true(
    v_result ->> 'work_status' = 'center_received',
    'receiving every active Store A item must complete aggregate receipt'
  );

  select version into v_version
  from public.order_item_fulfillments
  where order_item_id = '50000000-0000-4000-8000-000000000003';
  v_result := public.record_center_item_action(
    '50000000-0000-4000-8000-000000000003', v_version, 'receive',
    '73000000-0000-4000-8000-000000000006', null, null,
    'Store B parcel arrived'
  );
  perform test_support.assert_true(
    v_result ->> 'work_status' = 'center_received',
    'Store B receipt must be available through business-level central scope'
  );

  select version into v_version
  from public.order_item_fulfillments
  where order_item_id = '50000000-0000-4000-8000-000000000003';
  v_result := public.record_center_item_action(
    '50000000-0000-4000-8000-000000000003', v_version, 'store',
    '73000000-0000-4000-8000-000000000007', 'RACK-B-01', null,
    'Store B item stored'
  );
  perform test_support.assert_true(
    v_result ->> 'stage' = 'center_stored',
    'Store B item must be storable after receipt'
  );
end;
$$;

select test_support.assert_true(
  (select count(*) = 2 from public.get_center_fulfillment_queue(100, 0))
    and (select sum(stored_item_count) = 2
         from public.get_center_fulfillment_queue(100, 0)),
  'central queue must retain both received works and expose stored counts'
);

select test_support.expect_sqlstate(
  $sql$
    update public.order_item_fulfillments
    set version = version + 1
    where order_item_id = '50000000-0000-4000-8000-000000000001'
  $sql$,
  '42501',
  'authenticated users must not mutate fulfillment projections directly'
);
select test_support.expect_sqlstate(
  $sql$
    update public.fulfillment_command_receipts
    set result = result
    where actor_user_id = '10000000-0000-4000-8000-000000000002'
  $sql$,
  '42501',
  'authenticated users must not mutate command receipts directly'
);

select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000006', false);
select test_support.assert_true(
  (select count(*) = 0 from public.get_center_fulfillment_queue(100, 0)),
  'ordinary members must have no central fulfillment queue'
);

reset role;
select set_config('app.test_user_id', '', false);

select test_support.assert_true(
  not exists (
    select 1
    from (
      select
        order_item_id,
        min(sequence_no) as first_sequence,
        max(sequence_no) as last_sequence,
        count(*) as event_count,
        count(distinct sequence_no) as distinct_sequence_count
      from public.fulfillment_events
      group by order_item_id
    ) as sequences
    where first_sequence <> 1
      or last_sequence <> event_count
      or event_count <> distinct_sequence_count
  ),
  'fulfillment event sequences must be contiguous and unique per item'
);
select test_support.assert_true(
  (select count(*) >= 1 from public.fulfillment_events where event_type = 'payment_confirmed')
    and (select count(*) >= 1 from public.fulfillment_events where event_type = 'payment_reversed')
    and (select count(*) = 1 from public.fulfillment_center_events where event_type = 'configured'),
  'payment and center configuration audit events must be append-only evidence'
);

do $$
declare
  v_table text;
  v_action text;
  v_statement text;
begin
  foreach v_table in array array[
    'fulfillment_events',
    'fulfillment_command_receipts',
    'fulfillment_center_events',
    'store_membership_permission_audits'
  ] loop
    foreach v_action in array array['update', 'delete', 'truncate'] loop
      v_statement := case v_action
        when 'update' then case v_table
          when 'fulfillment_command_receipts' then
            'update public.fulfillment_command_receipts set result = result where false'
          else format('update public.%I set id = id where false', v_table)
        end
        when 'delete' then format('delete from public.%I where false', v_table)
        else format('truncate table public.%I', v_table)
      end;
      perform test_support.expect_sqlstate(
        v_statement,
        '55000',
        v_table || ' must reject ' || v_action || ' even when no row matches'
      );
    end loop;
  end loop;
end;
$$;

set role service_role;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000001', false);
select test_support.expect_sqlstate(
  $sql$
    select public.configure_fulfillment_center(
      '99000000-0000-4000-8000-000000000002', 1, '04524',
      '99 Eulji-ro, Jung-gu, Seoul', null, 'Central Intake', '+82-2-9900-9900',
      '74000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '42501',
  'service_role must not execute fulfillment mutation RPCs'
);
select test_support.expect_sqlstate(
  $sql$select * from public.fulfillment_command_receipts$sql$,
  '42501',
  'service_role must not read fulfillment command receipts'
);
select test_support.expect_sqlstate(
  $sql$
    update public.order_item_fulfillments
    set version = version + 1
    where order_item_id = '50000000-0000-4000-8000-000000000001'
  $sql$,
  '42501',
  'service_role must not bypass fulfillment projection DML revocation'
);

reset role;
select set_config('app.test_user_id', '', false);
