select test_support.assert_true(
  (
    select count(*) = 1
      and bool_and(status = 'configuration_required')
      and bool_and(is_default)
      and bool_and(
        postal_code is null
        and address_line1 is null
        and address_line2 is null
        and contact_name is null
        and contact_phone is null
      )
    from public.fulfillment_centers
    where id = '99000000-0000-4000-8000-000000000002'
  ),
  'the seeded default center must contain no invented address or contact data'
);

select test_support.assert_true(
  (
    select count(*) = 2
      and count(*) filter (where business_id is null) = 0
    from public.stores
  ),
  'every legacy store must be attached to the seeded business'
);

select test_support.assert_true(
  (
    select count(*) = 6
      and count(*) filter (where location_kind <> 'unknown') = 0
      and count(*) filter (
        where current_stage in ('center_received', 'center_stored')
      ) = 0
    from public.order_item_fulfillments
  ),
  'legacy payment and storage timestamps must never imply a physical location'
);

select test_support.assert_true(
  (
    select current_stage = 'reconciliation_required'
      and location_kind = 'unknown'
    from public.order_item_fulfillments
    where order_item_id = '50000000-0000-4000-8000-000000000001'
  ),
  'a paid item with a future storage deadline must require reconciliation'
);

select test_support.assert_true(
  (
    select current_stage = 'reconciliation_required'
    from public.order_item_fulfillments
    where order_item_id = '50000000-0000-4000-8000-000000000002'
  ),
  'an expired storage deadline must not be treated as center receipt'
);

select test_support.assert_true(
  (
    select current_stage = 'reconciliation_required'
    from public.order_item_fulfillments
    where order_item_id = '50000000-0000-4000-8000-000000000003'
  ),
  'a requested shipment is not terminal shipped evidence'
);

select test_support.assert_true(
  (
    select current_stage = 'legacy_terminal'
    from public.order_item_fulfillments
    where order_item_id = '50000000-0000-4000-8000-000000000004'
  ) and (
    select current_stage = 'legacy_terminal'
    from public.order_item_fulfillments
    where order_item_id = '50000000-0000-4000-8000-000000000005'
  ),
  'only explicit shipment or shipped-order evidence may be terminal'
);

select test_support.assert_true(
  (
    select current_stage = 'cancelled'
    from public.order_item_fulfillments
    where order_item_id = '50000000-0000-4000-8000-000000000006'
  ),
  'a cancelled legacy item must remain cancelled'
);

select test_support.assert_true(
  (
    select count(*) = 6
      and count(*) filter (
        where event_type <> 'legacy_imported'
          or sequence_no <> 1
          or actor_kind <> 'migration'
          or actor_role_snapshot <> 'migration'
          or reason_code <> 'foundation_backfill'
      ) = 0
    from public.fulfillment_events
  ),
  'every projected legacy item must have one explicit migration event'
);

select test_support.assert_true(
  (
    select metadata ->> 'observed_storage_expires_at' is not null
      and (metadata ->> 'observed_shipped_evidence')::boolean is false
    from public.fulfillment_events
    where order_item_id = '50000000-0000-4000-8000-000000000001'
  ),
  'storage evidence must be recorded for reconciliation without changing location'
);

select test_support.assert_true(
  (
    select count(*) = 6
      and count(*) filter (where status = 'reconciliation_required') = 3
      and count(*) filter (where status = 'legacy_terminal') = 2
      and count(*) filter (where status = 'cancelled') = 1
    from public.store_fulfillment_works
  ),
  'work backfill must aggregate each order and store conservatively'
);

-- The foundation is intentionally projection-only for legacy rows. A new
-- order item must not silently acquire workflow state before a later guarded
-- command boundary is introduced.
insert into public.commerce_orders (id, member_id, status) values (
  '40000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000003',
  'paid'
);
insert into public.commerce_order_items (
  id, order_id, product_id, store_id, payment_status, paid_at, storage_expires_at
) values (
  '50000000-0000-4000-8000-000000000007',
  '40000000-0000-4000-8000-000000000006',
  '30000000-0000-4000-8000-000000000007',
  '20000000-0000-4000-8000-000000000001',
  'paid',
  clock_timestamp(),
  clock_timestamp() + interval '14 days'
);
select test_support.assert_true(
  not exists (
    select 1 from public.order_item_fulfillments
    where order_item_id = '50000000-0000-4000-8000-000000000007'
  ) and not exists (
    select 1 from public.fulfillment_events
    where order_item_id = '50000000-0000-4000-8000-000000000007'
  ),
  'new order items must not be auto-initialized in the foundation migration'
);

select test_support.assert_true(
  (
    select lower(pg_get_constraintdef(oid)) =
      'foreign key (store_id, business_id) references stores(id, business_id) on delete restrict'
    from pg_constraint
    where conname = 'store_fulfillment_works_store_business_fkey'
  ),
  'store work must remain inside one business'
);
select test_support.assert_true(
  (
    select lower(pg_get_constraintdef(oid)) =
      'foreign key (fulfillment_center_id, business_id) references fulfillment_centers(id, business_id) on delete restrict'
    from pg_constraint
    where conname = 'store_fulfillment_works_center_business_fkey'
  ),
  'store work must use a center from the same business'
);
select test_support.assert_true(
  (
    select lower(pg_get_constraintdef(oid)) =
      'foreign key (order_item_id, order_id, store_id) references commerce_order_items(id, order_id, store_id) on delete restrict'
    from pg_constraint
    where conname = 'order_item_fulfillments_order_item_identity_fkey'
  ),
  'an item projection must bind the exact order and store snapshot'
);
select test_support.assert_true(
  exists (
    select 1 from pg_constraint
    where conname = 'order_item_fulfillments_work_identity_fkey'
      and contype = 'f'
  ),
  'an item projection must bind the complete work identity'
);

insert into public.businesses (id, code, name, status) values (
  '99000000-0000-4000-8000-000000000010',
  'foreign-business',
  'FOREIGN BUSINESS',
  'active'
);
insert into public.fulfillment_centers (
  id, business_id, code, name, status, is_default
) values (
  '99000000-0000-4000-8000-000000000011',
  '99000000-0000-4000-8000-000000000010',
  'foreign-default',
  'FOREIGN DEFAULT',
  'configuration_required',
  true
);

do $$
declare
  v_existing_work_id uuid;
begin
  begin
    insert into public.store_fulfillment_works (
      business_id, order_id, store_id, fulfillment_center_id, status
    ) values (
      '99000000-0000-4000-8000-000000000010',
      '40000000-0000-4000-8000-000000000006',
      '20000000-0000-4000-8000-000000000001',
      '99000000-0000-4000-8000-000000000011',
      'reconciliation_required'
    );
    raise exception 'a store from another business unexpectedly matched';
  exception when foreign_key_violation then
    null;
  end;

  begin
    insert into public.store_fulfillment_works (
      business_id, order_id, store_id, fulfillment_center_id, status
    ) values (
      '99000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000006',
      '20000000-0000-4000-8000-000000000001',
      '99000000-0000-4000-8000-000000000011',
      'reconciliation_required'
    );
    raise exception 'a center from another business unexpectedly matched';
  exception when foreign_key_violation then
    null;
  end;

  select id into v_existing_work_id
  from public.store_fulfillment_works
  where order_id = '40000000-0000-4000-8000-000000000002'
    and store_id = '20000000-0000-4000-8000-000000000001';

  begin
    insert into public.order_item_fulfillments (
      order_item_id,
      business_id,
      order_id,
      store_id,
      work_id,
      fulfillment_center_id,
      current_stage,
      location_kind
    ) values (
      '50000000-0000-4000-8000-000000000007',
      '99000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      v_existing_work_id,
      '99000000-0000-4000-8000-000000000002',
      'reconciliation_required',
      'unknown'
    );
    raise exception 'a mismatched order-item identity unexpectedly succeeded';
  exception when foreign_key_violation then
    null;
  end;

  begin
    insert into public.order_item_fulfillments (
      order_item_id,
      business_id,
      order_id,
      store_id,
      work_id,
      fulfillment_center_id,
      current_stage,
      location_kind
    ) values (
      '50000000-0000-4000-8000-000000000007',
      '99000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000006',
      '20000000-0000-4000-8000-000000000001',
      v_existing_work_id,
      '99000000-0000-4000-8000-000000000002',
      'reconciliation_required',
      'unknown'
    );
    raise exception 'a mismatched work identity unexpectedly succeeded';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

do $$
begin
  begin
    insert into public.fulfillment_centers (
      business_id, code, name, status, is_default
    ) values (
      '99000000-0000-4000-8000-000000000001',
      'active-without-address',
      'INVALID ACTIVE CENTER',
      'active',
      false
    );
    raise exception 'active center without an address unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.fulfillment_centers (
      business_id, code, name, status, is_default, address_line1
    ) values (
      '99000000-0000-4000-8000-000000000001',
      'placeholder-with-address',
      'INVALID PLACEHOLDER',
      'configuration_required',
      false,
      '주소를 추정하면 안 됨'
    );
    raise exception 'configuration-required center accepted invented address data';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.fulfillment_centers (
      business_id, code, name, status, is_default
    ) values (
      '99000000-0000-4000-8000-000000000001',
      'second-default',
      'SECOND DEFAULT',
      'configuration_required',
      true
    );
    raise exception 'a second default center unexpectedly succeeded';
  exception when unique_violation then
    null;
  end;

  begin
    update public.order_item_fulfillments
    set is_blocked = true
    where order_item_id = '50000000-0000-4000-8000-000000000001';
    raise exception 'blocked fulfillment without a reason unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    update public.order_item_fulfillments
    set
      current_stage = 'center_stored',
      location_kind = 'center',
      storage_location_code = null
    where order_item_id = '50000000-0000-4000-8000-000000000001';
    raise exception 'stored fulfillment without a location code unexpectedly succeeded';
  exception when check_violation then
    null;
  end;
end;
$$;

insert into public.fulfillment_centers (
  business_id,
  code,
  name,
  status,
  is_default,
  postal_code,
  address_line1,
  address_line2,
  contact_name,
  contact_phone
) values (
  '99000000-0000-4000-8000-000000000001',
  'configured-secondary',
  'CONFIGURED SECONDARY',
  'active',
  false,
  '12345',
  '서울특별시 테스트로 99',
  '테스트동',
  '중앙 담당자',
  '02-1234-5678'
);

do $$
begin
  begin
    insert into public.fulfillment_centers (
      business_id, code, name, status, is_default,
      postal_code, address_line1, contact_name, contact_phone
    ) values (
      '99000000-0000-4000-8000-000000000001',
      'invalid-postal',
      'INVALID POSTAL',
      'active',
      false,
      '1234',
      '서울특별시 테스트로 99',
      '중앙 담당자',
      '02-1234-5678'
    );
    raise exception 'an invalid postal code unexpectedly succeeded';
  exception when check_violation then
    null;
  end;
end;
$$;

-- Exercise all three append-only paths as the database owner so table ACLs
-- cannot mask a missing trigger event.
do $$
declare
  v_before bigint;
begin
  select count(*) into v_before from public.fulfillment_events;

  begin
    update public.fulfillment_events set note = 'forbidden';
    raise exception 'fulfillment event update unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from public.fulfillment_events;
    raise exception 'fulfillment event delete unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    truncate table public.fulfillment_events;
    raise exception 'fulfillment event truncate unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  perform test_support.assert_true(
    (select count(*) from public.fulfillment_events) = v_before,
    'append-only probes must leave the event history unchanged'
  );
end;
$$;

do $$
declare
  v_table text;
  v_role text;
  v_privilege text;
  v_tables constant text[] := array[
    'businesses',
    'fulfillment_centers',
    'store_fulfillment_works',
    'order_item_fulfillments',
    'fulfillment_events'
  ];
begin
  foreach v_table in array v_tables loop
    perform test_support.assert_true(
      has_table_privilege('authenticated', 'public.' || v_table, 'SELECT'),
      'authenticated must have the owner-filtered SELECT entry privilege on ' || v_table
    );
    perform test_support.assert_true(
      not has_table_privilege('anon', 'public.' || v_table, 'SELECT')
        and not has_table_privilege('service_role', 'public.' || v_table, 'SELECT'),
      'anon and service role must not read ' || v_table
    );

    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      foreach v_privilege in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
        perform test_support.assert_true(
          not has_table_privilege(v_role, 'public.' || v_table, v_privilege),
          v_role || ' unexpectedly has ' || v_privilege || ' on ' || v_table
        );
      end loop;
    end loop;
  end loop;
end;
$$;

set role authenticated;
set app.test_user_id = '10000000-0000-4000-8000-000000000001';
set app.test_is_owner = 'true';
select test_support.assert_true(
  (select count(*) from public.businesses) >= 1
    and (select count(*) from public.fulfillment_centers) >= 1
    and (select count(*) from public.store_fulfillment_works) = 6
    and (select count(*) from public.order_item_fulfillments) = 6
    and (select count(*) from public.fulfillment_events) = 6,
  'an owner must be able to read every foundation table through RLS'
);
do $$
begin
  begin
    update public.businesses set name = name;
    raise exception 'owner direct DML unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

set app.test_is_owner = 'false';
select test_support.assert_true(
  (select count(*) from public.businesses) = 0
    and (select count(*) from public.fulfillment_centers) = 0
    and (select count(*) from public.store_fulfillment_works) = 0
    and (select count(*) from public.order_item_fulfillments) = 0
    and (select count(*) from public.fulfillment_events) = 0,
  'an ordinary authenticated member must see no foundation rows'
);
reset role;

set role anon;
do $$
begin
  begin
    update public.businesses set name = name;
    raise exception 'anon direct DML unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set role service_role;
do $$
begin
  begin
    update public.businesses set name = name;
    raise exception 'service role direct DML unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
