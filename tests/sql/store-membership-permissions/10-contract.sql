select test_support.assert_true(
  (select count(*) from public.store_memberships) = 4,
  'operator and employee backfill count is incorrect'
);

select test_support.assert_true(
  not exists (
    select 1
    from public.store_memberships as memberships
    where memberships.membership_role in ('operator', 'employee')
      and (
        not memberships.manage_products
        or memberships.receive_at_center
        or memberships.create_shipments
      )
  ),
  'legacy product access or fail-closed central defaults were not preserved'
);

select test_support.assert_true(
  (
    select memberships.publish_products
      and memberships.prepare_orders
      and memberships.confirm_payments
      and memberships.manage_staff
      and memberships.view_reports
    from public.store_memberships as memberships
    where memberships.store_id = '20000000-0000-4000-8000-000000000001'
      and memberships.user_id = '10000000-0000-4000-8000-000000000002'
  ),
  'operator permission backfill is incomplete'
);

select test_support.assert_true(
  (
    select not memberships.publish_products
      and not memberships.prepare_orders
      and not memberships.confirm_payments
      and not memberships.manage_staff
      and not memberships.view_reports
    from public.store_memberships as memberships
    where memberships.store_id = '20000000-0000-4000-8000-000000000001'
      and memberships.user_id = '10000000-0000-4000-8000-000000000004'
  ),
  'employee backfill inferred permissions beyond legacy product access'
);

select test_support.assert_true(
  (select count(*) from public.store_membership_permission_audits) = 4,
  'every backfilled membership must have an audit row'
);

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000001', false);

select test_support.assert_true(
  public.has_store_permission(
    '20000000-0000-4000-8000-000000000001',
    'create_shipments'
  ),
  'Owner must have implicit store permission'
);
select test_support.assert_true(
  public.has_business_permission(
    '99000000-0000-4000-8000-000000000001',
    'receive_at_center'
  ),
  'Owner must have implicit business permission'
);
select test_support.assert_true(
  not public.has_store_permission(
    '20000000-0000-4000-8000-000000000001',
    'unknown_permission'
  ),
  'unknown permission names must fail closed even for Owner'
);

select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000002', false);
select test_support.assert_true(
  public.can_manage_product_store('20000000-0000-4000-8000-000000000001')
  and not public.can_manage_product_store('20000000-0000-4000-8000-000000000002'),
  'operator product access must remain scoped to the assigned store'
);
select test_support.assert_true(
  not public.has_business_permission(
    '99000000-0000-4000-8000-000000000001',
    'create_shipments'
  ),
  'operator central permission must default false'
);

select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000004', false);
select test_support.assert_true(
  public.can_manage_product_store('20000000-0000-4000-8000-000000000001')
  and not public.can_manage_product_store('20000000-0000-4000-8000-000000000002'),
  'employee product access must follow the explicit backfilled membership'
);
select test_support.assert_true(
  not public.has_store_permission(
    '20000000-0000-4000-8000-000000000001',
    'prepare_orders'
  ),
  'employee preparation permission must not be inferred'
);

-- RLS reveals only the caller's memberships, while Owner can inspect all.
select test_support.assert_true(
  (select count(*) from public.store_memberships) = 1,
  'employee RLS exposed another user membership'
);
select test_support.assert_true(
  (select count(*) from public.store_membership_permission_audits) = 1,
  'employee RLS exposed another user permission audit'
);

select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000001', false);
select test_support.assert_true(
  (select count(*) from public.store_memberships) = 4,
  'Owner RLS did not expose the internal membership inventory'
);

do $$
declare
  v_membership_id uuid;
  v_result record;
  v_permissions jsonb := jsonb_build_object(
    'manage_products', true,
    'publish_products', true,
    'prepare_orders', true,
    'confirm_payments', true,
    'receive_at_center', false,
    'create_shipments', true,
    'manage_staff', true,
    'view_reports', true
  );
begin
  select memberships.id
  into v_membership_id
  from public.store_memberships as memberships
  where memberships.store_id = '20000000-0000-4000-8000-000000000001'
    and memberships.user_id = '10000000-0000-4000-8000-000000000002';

  select *
  into v_result
  from public.set_store_membership_access(
    v_membership_id,
    0,
    '70000000-0000-4000-8000-000000000001',
    'active',
    v_permissions,
    '중앙 송장 담당 운영자 권한 부여'
  );
  perform test_support.assert_true(
    v_result.membership_version = 1 and not v_result.replayed,
    'first permission configuration did not advance the version'
  );

  select *
  into v_result
  from public.set_store_membership_access(
    v_membership_id,
    0,
    '70000000-0000-4000-8000-000000000001',
    'active',
    v_permissions,
    '중앙 송장 담당 운영자 권한 부여'
  );
  perform test_support.assert_true(
    v_result.membership_version = 1 and v_result.replayed,
    'same idempotency request was not replayed'
  );

  begin
    perform public.set_store_membership_access(
      v_membership_id,
      1,
      '70000000-0000-4000-8000-000000000001',
      'active',
      v_permissions,
      '다른 요청으로 멱등 키를 재사용'
    );
    raise exception 'conflicting idempotency request unexpectedly succeeded';
  exception when unique_violation then
    null;
  end;

  begin
    perform public.set_store_membership_access(
      v_membership_id,
      0,
      '70000000-0000-4000-8000-000000000002',
      'active',
      v_permissions,
      '오래된 버전으로 권한 변경 시도'
    );
    raise exception 'stale CAS request unexpectedly succeeded';
  exception when serialization_failure then
    null;
  end;

  begin
    perform public.set_store_membership_access(
      v_membership_id,
      1,
      '70000000-0000-4000-8000-000000000003',
      'inactive',
      v_permissions,
      '현재 담당 운영자 소속 비활성화 시도'
    );
    raise exception 'assigned operator membership was unexpectedly disabled';
  exception when check_violation then
    null;
  end;
end;
$$;

select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000002', false);
select test_support.assert_true(
  public.has_business_permission(
    '99000000-0000-4000-8000-000000000001',
    'create_shipments'
  ),
  'explicit Owner-granted business permission was not effective'
);

do $$
declare
  v_membership_id uuid;
  v_permissions jsonb;
begin
  select memberships.id,
    jsonb_build_object(
      'manage_products', memberships.manage_products,
      'publish_products', memberships.publish_products,
      'prepare_orders', memberships.prepare_orders,
      'confirm_payments', memberships.confirm_payments,
      'receive_at_center', memberships.receive_at_center,
      'create_shipments', memberships.create_shipments,
      'manage_staff', memberships.manage_staff,
      'view_reports', memberships.view_reports
    )
  into v_membership_id, v_permissions
  from public.store_memberships as memberships
  where memberships.store_id = '20000000-0000-4000-8000-000000000001'
    and memberships.user_id = '10000000-0000-4000-8000-000000000002';

  begin
    perform public.set_store_membership_access(
      v_membership_id,
      1,
      '70000000-0000-4000-8000-000000000004',
      'active',
      v_permissions,
      '운영자의 자기 권한 변경 시도'
    );
    raise exception 'operator permission mutation unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
select set_config('app.test_user_id', '', false);

select test_support.assert_true(
  (
    select count(*)
    from public.store_membership_permission_audits as audits
    where audits.action = 'access_configured'
      and audits.actor_user_id = '10000000-0000-4000-8000-000000000001'
      and audits.idempotency_key = '70000000-0000-4000-8000-000000000001'
  ) = 1,
  'Owner permission mutation did not create exactly one idempotent audit'
);

-- Account and store changes synchronize new memberships and deactivate stale
-- employee relationships without changing the authenticated actor identity.
update public.account_access_roles
set reports_to_operator_id = '10000000-0000-4000-8000-000000000003'
where user_id = '10000000-0000-4000-8000-000000000004';

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000004', false);
select test_support.assert_true(
  not public.can_manage_product_store('20000000-0000-4000-8000-000000000001')
  and public.can_manage_product_store('20000000-0000-4000-8000-000000000002'),
  'employee reassignment did not update the effective store scope'
);
reset role;
select set_config('app.test_user_id', '', false);

insert into public.stores (id, business_id, operator_id, is_active) values (
  '20000000-0000-4000-8000-000000000003',
  '99000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  true
);

select test_support.assert_true(
  exists (
    select 1
    from public.store_memberships as memberships
    where memberships.store_id = '20000000-0000-4000-8000-000000000003'
      and memberships.user_id = '10000000-0000-4000-8000-000000000003'
      and memberships.membership_role = 'operator'
      and memberships.status = 'active'
  )
  and exists (
    select 1
    from public.store_memberships as memberships
    where memberships.store_id = '20000000-0000-4000-8000-000000000003'
      and memberships.user_id = '10000000-0000-4000-8000-000000000004'
      and memberships.membership_role = 'employee'
      and memberships.status = 'active'
  ),
  'new store relationships did not provision operator and employee memberships'
);

update public.account_access_roles
set role_code = 'member', reports_to_operator_id = null
where user_id = '10000000-0000-4000-8000-000000000005';

select test_support.assert_true(
  exists (
    select 1
    from public.store_memberships as memberships
    where memberships.user_id = '10000000-0000-4000-8000-000000000005'
      and memberships.membership_role = 'employee'
      and memberships.status = 'inactive'
  ),
  'employee role removal did not deactivate the former store membership'
);

do $$
begin
  begin
    update public.stores
    set operator_id = '10000000-0000-4000-8000-000000000006'
    where id = '20000000-0000-4000-8000-000000000001';
    raise exception 'invalid store operator assignment unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    update public.account_access_roles
    set role_code = 'member'
    where user_id = '10000000-0000-4000-8000-000000000002';
    raise exception 'assigned operator role demotion unexpectedly succeeded';
  exception when check_violation then
    null;
  end;
end;
$$;

delete from public.profiles
where id = '10000000-0000-4000-8000-000000000004';

select test_support.assert_true(
  not exists (
    select 1
    from public.profiles
    where id = '10000000-0000-4000-8000-000000000004'
  )
  and not exists (
    select 1
    from public.store_memberships as memberships
    where memberships.user_id = '10000000-0000-4000-8000-000000000004'
      and memberships.status = 'active'
  ),
  'former employee account deletion was blocked or left an active membership'
);

set role service_role;
do $$
begin
  begin
    insert into public.store_memberships (
      business_id,
      store_id,
      user_id,
      membership_role
    ) values (
      '99000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000006',
      'employee'
    );
    raise exception 'service_role direct membership DML unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

do $$
begin
  begin
    update public.store_membership_permission_audits
    set reason = '감사 이력 변조';
    raise exception 'permission audit update unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  begin
    delete from public.store_membership_permission_audits;
    raise exception 'permission audit delete unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  begin
    truncate table public.store_membership_permission_audits;
    raise exception 'permission audit truncate unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then
    null;
  end;
end;
$$;

select test_support.assert_true(
  not has_table_privilege('anon', 'public.store_memberships', 'INSERT')
  and not has_table_privilege('authenticated', 'public.store_memberships', 'UPDATE')
  and not has_table_privilege('service_role', 'public.store_memberships', 'DELETE')
  and not has_table_privilege('service_role', 'public.store_membership_permission_audits', 'INSERT'),
  'direct membership or audit mutation privilege leaked to a Data API role'
);
