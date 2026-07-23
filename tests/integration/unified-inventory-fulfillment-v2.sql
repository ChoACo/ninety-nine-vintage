create schema if not exists test_support;

create or replace function test_support.assert_true(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not coalesce(p_condition, false) then
    raise exception using errcode = 'P0001', message = p_message;
  end if;
end;
$$;

create or replace function test_support.expect_sqlstate(
  p_sql text,
  p_expected_state text,
  p_message text,
  p_expected_message text default null,
  p_expected_detail text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics
      v_state = returned_sqlstate,
      v_message = message_text,
      v_detail = pg_exception_detail;
    if v_state is distinct from p_expected_state then
      raise exception '% (expected SQLSTATE %, received %: %)',
        p_message, p_expected_state, v_state, v_message;
    end if;
    if p_expected_message is not null
      and v_message is distinct from p_expected_message
    then
      raise exception '% (expected message %, received %)',
        p_message, p_expected_message, v_message;
    end if;
    if p_expected_detail is not null
      and position(p_expected_detail in coalesce(v_detail, '')) = 0
    then
      raise exception '% (expected detail containing %, received %)',
        p_message, p_expected_detail, coalesce(v_detail, '<null>');
    end if;
    return;
  end;
  raise exception '% (statement unexpectedly succeeded)', p_message;
end;
$$;

grant usage on schema test_support to authenticated, service_role;
grant execute on function test_support.assert_true(boolean, text),
  test_support.expect_sqlstate(text, text, text, text, text)
to authenticated, service_role;

select test_support.assert_true(
  to_regclass('public.customer_inventory_items') is not null
    and to_regclass('public.inventory_shipments') is not null
    and to_regclass('public.manual_refunds') is not null
    and to_regclass('public.shipping_fee_refunds') is not null,
  'the full migration chain must create every v2 aggregate'
);

select test_support.assert_true(
  (
    select bool_and(c.relrowsecurity and c.relforcerowsecurity)
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'customer_inventory_items',
        'inventory_item_fulfillments',
        'inventory_shipments',
        'inventory_exception_cases',
        'manual_refunds',
        'manual_refund_accounts',
        'shipping_fee_refunds',
        'shipping_fee_refund_accounts',
        'store_financial_entries'
      )
  ),
  'every sensitive v2 table must have forced RLS'
);

select test_support.assert_true(
  to_regprocedure(
    'public.confirm_unified_manual_payment(text,uuid,bigint,text,bigint,integer,uuid)'
  ) is not null
    and to_regprocedure(
      'public.release_paid_inventory_items(uuid[],bigint[],uuid,text)'
    ) is not null
    and to_regprocedure(
      'public.request_inventory_shipment(uuid[],uuid,text,bigint,text,text,uuid)'
    ) is not null,
  'the v2 payment, release, and shipment RPC contracts must exist'
);

-- Test actors -------------------------------------------------------------

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'buyer-fixture@invalid.ninety-nine-vintage.local',
  extensions.crypt('test-only-password', extensions.gen_salt('bf')),
  clock_timestamp(),
  '{"provider":"kakao","providers":["kakao"],"role":"member"}'::jsonb,
  '{"display_name":"Buyer fixture"}'::jsonb,
  clock_timestamp(),
  clock_timestamp(),
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'email', 'buyer-fixture@invalid.ninety-nine-vintage.local'
  ),
  'kakao',
  clock_timestamp(),
  clock_timestamp(),
  clock_timestamp()
)
on conflict (provider_id, provider) do nothing;

insert into public.kakao_member_profiles (
  member_id,
  kakao_subject,
  full_name,
  profile_complete,
  consent_items
) values (
  '10000000-0000-4000-8000-000000000001',
  'runtime-flow-buyer',
  'Buyer fixture',
  true,
  array['name', 'shipping']::text[]
)
on conflict (member_id) do update set profile_complete = true;

select test_support.assert_true(
  public.access_role_for_user('10000000-0000-4000-8000-000000000001') = 'member'
    and exists (
      select 1
      from public.member_accounts
      where member_id = '10000000-0000-4000-8000-000000000001'
        and account_status = 'active'
    ),
  'the buyer fixture must have a live member role and account'
);

insert into public.shipping_addresses (
  id,
  member_id,
  label,
  recipient_name,
  phone,
  address,
  postal_code,
  is_default
) values (
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '집',
  'Buyer fixture',
  '010-1234-5678',
  '서울특별시 테스트구 테스트로 99',
  '12345',
  true
);

-- A/B stores, the B shipping center, and explicit permissions/routes -------

-- The production cutover removes every non-owner role. Recreate only the
-- isolated fixture operators after that cutover so the legacy fulfillment
-- contracts are still exercised without depending on production identities.
select set_config(
  'request.jwt.claim.sub',
  '30be08c2-6259-42c6-af26-4ded6362de12',
  false
);

update public.profiles
set
  deleted_at = null,
  anonymized_reference = null,
  updated_at = clock_timestamp()
where id in (
  '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'
);

insert into public.account_access_roles (user_id, role_code)
values
  ('4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee', 'operator'),
  ('9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d', 'operator')
on conflict (user_id) do update set
  role_code = excluded.role_code,
  updated_at = clock_timestamp();

update public.fulfillment_centers
set
  code = 'center-b',
  name = 'B 매장 출고센터',
  status = 'active',
  updated_by = '30be08c2-6259-42c6-af26-4ded6362de12',
  updated_at = clock_timestamp()
where id = '99000000-0000-4000-8000-000000000002';

insert into public.stores (
  id,
  slug,
  name,
  description,
  operator_id,
  business_id
) values
  (
    '20000000-0000-4000-8000-000000000001',
    'store-a',
    'A 매장',
    'A 매장 테스트',
    '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
    '99000000-0000-4000-8000-000000000001'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'store-b',
    'B 매장',
    'B 매장 테스트',
    '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
    '99000000-0000-4000-8000-000000000001'
  );

insert into public.store_memberships (
  business_id,
  store_id,
  user_id,
  membership_role,
  status,
  manage_products,
  publish_products,
  prepare_orders,
  confirm_payments,
  receive_at_center,
  create_shipments,
  manage_staff,
  view_reports,
  created_by,
  updated_by
) values
  (
    '99000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
    'operator', 'active', true, true, true, true, false, false, true, true,
    '30be08c2-6259-42c6-af26-4ded6362de12',
    '30be08c2-6259-42c6-af26-4ded6362de12'
  ),
  (
    '99000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
    'operator', 'active', true, true, true, true, true, true, true, true,
    '30be08c2-6259-42c6-af26-4ded6362de12',
    '30be08c2-6259-42c6-af26-4ded6362de12'
  )
on conflict (store_id, user_id) do update set
  business_id = excluded.business_id,
  membership_role = excluded.membership_role,
  status = excluded.status,
  manage_products = excluded.manage_products,
  publish_products = excluded.publish_products,
  prepare_orders = excluded.prepare_orders,
  confirm_payments = excluded.confirm_payments,
  receive_at_center = excluded.receive_at_center,
  create_shipments = excluded.create_shipments,
  manage_staff = excluded.manage_staff,
  view_reports = excluded.view_reports,
  updated_by = excluded.updated_by;

insert into public.fulfillment_center_staff_assignments (
  business_id,
  fulfillment_center_id,
  user_id,
  status,
  receive_at_center,
  create_shipments,
  created_by,
  updated_by
) values (
  '99000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000002',
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  'active',
  true,
  true,
  '30be08c2-6259-42c6-af26-4ded6362de12',
  '30be08c2-6259-42c6-af26-4ded6362de12'
) on conflict (fulfillment_center_id, user_id) do update
set
  status = excluded.status,
  receive_at_center = excluded.receive_at_center,
  create_shipments = excluded.create_shipments,
  updated_by = excluded.updated_by,
  updated_at = clock_timestamp(),
  version = public.fulfillment_center_staff_assignments.version + 1;

update public.payment_runtime_settings
set
  active_mode = 'manual_transfer',
  bank_name = '테스트은행',
  account_number = '110-123-456789',
  updated_by = '30be08c2-6259-42c6-af26-4ded6362de12';

select set_config(
  'request.jwt.claim.sub',
  '30be08c2-6259-42c6-af26-4ded6362de12',
  false
);

select public.configure_store_fulfillment_route(
  '20000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000002',
  'transfer',
  0,
  '81000000-0000-4000-8000-000000000001',
  'A 매장은 B 센터로 이동'
);
select public.configure_store_fulfillment_route(
  '20000000-0000-4000-8000-000000000002',
  '99000000-0000-4000-8000-000000000002',
  'co_located',
  0,
  '81000000-0000-4000-8000-000000000002',
  'B 매장은 출고 센터와 동일 위치'
);
reset role;

-- Catalog and a paid legacy item that must be reconciled without inference --

insert into public.products (
  id,
  title,
  description,
  publish_at,
  closes_at,
  status,
  starting_price,
  current_price,
  image_urls,
  sale_type,
  fixed_price,
  store_id,
  storage_class,
  created_by
) values
  ('30000000-0000-4000-8000-000000000001', '기존 만료 보관 상품', 'backfill fixture', clock_timestamp()-interval '10 days', clock_timestamp()+interval '1 day', 'active', 9000, 9000, array['https://example.invalid/1.jpg'], 'fixed', 9000, '20000000-0000-4000-8000-000000000001', 'small', '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'),
  ('30000000-0000-4000-8000-000000000002', 'A 매장 결제 상품', 'store A fixture', clock_timestamp()-interval '2 days', clock_timestamp()+interval '1 day', 'active', 10000, 10000, array['https://example.invalid/2.jpg'], 'fixed', 10000, '20000000-0000-4000-8000-000000000001', 'small', '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'),
  ('30000000-0000-4000-8000-000000000003', 'B 매장 결제 상품', 'store B fixture', clock_timestamp()-interval '2 days', clock_timestamp()+interval '1 day', 'active', 20000, 20000, array['https://example.invalid/3.jpg'], 'fixed', 20000, '20000000-0000-4000-8000-000000000002', 'large', '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'),
  ('30000000-0000-4000-8000-000000000004', '즉시 배송 A 상품', 'shipment A fixture', clock_timestamp()-interval '2 days', clock_timestamp()+interval '1 day', 'active', 15000, 15000, array['https://example.invalid/4.jpg'], 'fixed', 15000, '20000000-0000-4000-8000-000000000001', 'small', '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'),
  ('30000000-0000-4000-8000-000000000005', '즉시 배송 경매 상품', 'auction fixture', clock_timestamp()-interval '2 days', clock_timestamp()-interval '1 hour', 'closed', 20000, 22000, array['https://example.invalid/5.jpg'], 'auction', null, '20000000-0000-4000-8000-000000000002', 'small', '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'),
  ('30000000-0000-4000-8000-000000000006', '배송비 환불 상품', 'shipping fee refund fixture', clock_timestamp()-interval '2 days', clock_timestamp()+interval '1 day', 'active', 18000, 18000, array['https://example.invalid/6.jpg'], 'fixed', 18000, '20000000-0000-4000-8000-000000000001', 'small', '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'),
  ('30000000-0000-4000-8000-000000000007', '상품 환불 상품', 'item refund fixture', clock_timestamp()-interval '2 days', clock_timestamp()+interval '1 day', 'active', 25000, 25000, array['https://example.invalid/7.jpg'], 'fixed', 25000, '20000000-0000-4000-8000-000000000002', 'large', '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'),
  ('30000000-0000-4000-8000-000000000008', '동시 입금 확인 상품', 'concurrency fixture', clock_timestamp()-interval '2 days', clock_timestamp()+interval '1 day', 'active', 12000, 12000, array['https://example.invalid/8.jpg'], 'fixed', 12000, '20000000-0000-4000-8000-000000000001', 'small', '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee');

insert into public.auction_bids (
  id,
  product_id,
  bidder_id,
  bidder_display_name,
  amount
) values (
  '31000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000001',
  'Buyer fixture',
  22000
);

insert into public.commerce_orders (
  id, member_id, status, subtotal, shipping_fee, total,
  shipping_credit_applied, idempotency_key
) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'paid', 9000, 0, 9000, false, 'legacy-paid-backfill'
);
insert into public.commerce_order_items (
  id, order_id, product_id, store_id, unit_price,
  payment_status, paid_at, storage_expires_at
) values (
  '41000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  9000,
  'paid',
  clock_timestamp()-interval '20 days',
  clock_timestamp()-interval '6 days'
);

select set_config(
  'request.jwt.claim.sub',
  '30be08c2-6259-42c6-af26-4ded6362de12',
  false
);
select public.configure_inventory_fulfillment_rollout(
  '99000000-0000-4000-8000-000000000001',
  true,
  true,
  false,
  3500,
  0,
  '81000000-0000-4000-8000-000000000003'
);
reset role;

select test_support.assert_true(
  (
    select items.fulfillment_center_id is null
      and fulfillments.current_stage = 'reconciliation_required'
      and items.storage_expires_at < clock_timestamp()
      and items.storage_expires_at = source_items.storage_expires_at
    from public.customer_inventory_items as items
    join public.inventory_item_fulfillments as fulfillments
      on fulfillments.inventory_item_id = items.id
    join public.commerce_order_items as source_items
      on source_items.id = items.commerce_order_item_id
    where items.commerce_order_item_id =
      '41000000-0000-4000-8000-000000000001'
  ),
  'backfill must preserve expiration and require explicit route reconciliation'
);

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config(
  'request.jwt.claim.sub',
  '30be08c2-6259-42c6-af26-4ded6362de12',
  false
);
select test_support.expect_sqlstate(
  $$select public.get_legacy_commerce_shipment_quote(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001')$$,
  '42501',
  'legacy shipment quotes must stay behind the service-role boundary'
);

reset role;
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
select test_support.assert_true(
  public.get_legacy_commerce_shipment_quote(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001'
  ) = jsonb_build_object(
    'expected_amount', 3500,
    'bank_name_snapshot', '테스트은행',
    'account_number_snapshot', '110-123-456789'
  ),
  'legacy shipment quotes must use the active server fee and bank snapshot'
);
reset role;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config(
  'request.jwt.claim.sub',
  '30be08c2-6259-42c6-af26-4ded6362de12',
  false
);

select test_support.assert_true(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_owner_inventory_reconciliation_queue(200, 0) -> 'items'
    ) as queued(value)
    where value ->> 'productId' =
        '30000000-0000-4000-8000-000000000001'
      and value ->> 'targetCenterId' =
        '99000000-0000-4000-8000-000000000002'
      and value ->> 'targetRouteMode' = 'transfer'
      and (value ->> 'fulfillmentVersion')::bigint = 0
  ),
  'the owner reconciliation queue must expose the explicit target route'
);

select test_support.expect_sqlstate(
  $$select public.configure_inventory_fulfillment_rollout(
    '99000000-0000-4000-8000-000000000001',true,true,true,3500,1,
    '81000000-0000-4000-8000-000000000004')$$,
  '23514',
  'shipment rollout must be blocked while reconciliation remains'
);

select public.reconcile_inventory_item_route(
  (
    select id
    from public.customer_inventory_items
    where commerce_order_item_id = '41000000-0000-4000-8000-000000000001'
  ),
  0,
  '81000000-0000-4000-8000-000000000005',
  '기존 보관 상품 경로 수동 확인'
);
select public.configure_inventory_fulfillment_rollout(
  '99000000-0000-4000-8000-000000000001',
  true,
  true,
  true,
  3500,
  1,
  '81000000-0000-4000-8000-000000000006'
);
reset role;

select test_support.expect_sqlstate(
  $$update public.commerce_order_items
    set payment_status = 'cancelled'
    where id = '41000000-0000-4000-8000-000000000001'$$,
  '55000',
  'a moved unified entitlement must reject legacy paid-source reversal',
  '이동 또는 예외 처리가 시작된 보관 소유권은 결제 원천에서 되돌릴 수 없습니다. 수동 환불 절차를 사용해 주세요.'
);

select test_support.expect_sqlstate(
  $$insert into public.commerce_shipment_orders (
      shipment_id, order_id, member_id, business_id,
      fulfillment_center_id
    ) values (
      '42000000-0000-4000-8000-000000000099',
      '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '99000000-0000-4000-8000-000000000001',
      '99000000-0000-4000-8000-000000000002'
    )$$,
  '55000',
  'legacy order-level shipment creation must stop after selected shipping rollout',
  '선택 상품 배송이 활성화되어 기존 주문 단위 배송을 만들 수 없습니다.'
);

select test_support.assert_true(
  (
    select entitlement_projection_enabled
      and unified_inventory_reads_enabled
      and item_selected_shipments_enabled
      and shipping_fee_amount = 3500
      and version = 2
    from public.inventory_fulfillment_rollout_settings
    where business_id = '99000000-0000-4000-8000-000000000001'
  ),
  'staged rollout must only activate after explicit reconciliation'
);

-- Fixed and auction payment fixtures -------------------------------------

insert into public.commerce_orders (
  id, member_id, status, subtotal, shipping_fee, total,
  shipping_credit_applied, idempotency_key
) values
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'awaiting_payment', 30000, 0, 30000, false, 'payment-two-stores'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'awaiting_payment', 15000, 0, 15000, false, 'shipment-fixed'),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'awaiting_payment', 18000, 0, 18000, false, 'fee-refund-fixed'),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'awaiting_payment', 25000, 0, 25000, false, 'item-refund-fixed'),
  ('40000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'awaiting_payment', 12000, 0, 12000, false, 'concurrent-fixed');

insert into public.commerce_order_items (
  id, order_id, product_id, store_id, unit_price, payment_status
) values
  ('41000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 10000, 'awaiting_payment'),
  ('41000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 20000, 'awaiting_payment'),
  ('41000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 15000, 'awaiting_payment'),
  ('41000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', 18000, 'awaiting_payment'),
  ('41000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000002', 25000, 'awaiting_payment'),
  ('41000000-0000-4000-8000-000000000008', '40000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000001', 12000, 'awaiting_payment');

insert into public.commerce_order_transfers (
  id, order_id, member_id, expected_amount,
  bank_name_snapshot, account_number_snapshot, status
) values
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 30000, '테스트은행', '110-123-456789', 'awaiting_transfer'),
  ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 15000, '테스트은행', '110-123-456789', 'awaiting_transfer'),
  ('50000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 18000, '테스트은행', '110-123-456789', 'awaiting_transfer'),
  ('50000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 25000, '테스트은행', '110-123-456789', 'awaiting_transfer'),
  ('50000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 12000, '테스트은행', '110-123-456789', 'awaiting_transfer');

insert into public.manual_transfer_orders (
  id,
  product_id,
  buyer_id,
  order_name,
  expected_amount,
  bank_name_snapshot,
  account_number_snapshot,
  status,
  due_at
) values (
  '60000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000001',
  '즉시 배송 경매 상품',
  22000,
  '테스트은행',
  '110-123-456789',
  'awaiting_manual_transfer',
  clock_timestamp()+interval '1 day'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
select test_support.expect_sqlstate(
  $$select public.confirm_unified_manual_payment(
    'commerce','50000000-0000-4000-8000-000000000002',0,
    'Buyer fixture',0,0,'82000000-0000-4000-8000-000000000001')$$,
  '42501',
  'a buyer must not confirm their own payment'
);

select set_config(
  'request.jwt.claim.sub',
  '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
  false
);
select public.confirm_unified_manual_payment(
  'commerce',
  '50000000-0000-4000-8000-000000000002',
  0,
  'Buyer fixture',
  0,
  0,
  '82000000-0000-4000-8000-000000000002'
);
select test_support.assert_true(
  (
    public.confirm_unified_manual_payment(
      'commerce',
      '50000000-0000-4000-8000-000000000002',
      0,
      'Buyer fixture',
      0,
      0,
      '82000000-0000-4000-8000-000000000002'
    ) ->> 'idempotent_replay'
  )::boolean,
  'an exact payment replay must return its stored result'
);
select test_support.expect_sqlstate(
  $$select public.confirm_unified_manual_payment(
    'commerce','50000000-0000-4000-8000-000000000002',0,
    'Buyer fixture',0,0,'82000000-0000-4000-8000-000000000003')$$,
  'PT409',
  'a stale payment version must fail CAS'
);

-- Operator A has business payment permission through store A and must be
-- allowed to confirm a store-B auction payment shared by both centers.
select public.confirm_unified_manual_payment(
  'auction',
  '60000000-0000-4000-8000-000000000005',
  0,
  'Buyer fixture',
  0,
  0,
  '82000000-0000-4000-8000-000000000004'
);
reset role;

select test_support.assert_true(
  (
    select count(*) = 3
    from public.customer_inventory_items
    where commerce_order_item_id in (
      '41000000-0000-4000-8000-000000000002',
      '41000000-0000-4000-8000-000000000003'
    )
       or manual_transfer_order_id =
          '60000000-0000-4000-8000-000000000005'
  )
  and (
    select count(*) = 3
    from public.store_financial_entries
    where entry_kind = 'item_payment'
      and inventory_item_id in (
        select id
        from public.customer_inventory_items
        where commerce_order_item_id in (
          '41000000-0000-4000-8000-000000000002',
          '41000000-0000-4000-8000-000000000003'
        )
           or manual_transfer_order_id =
              '60000000-0000-4000-8000-000000000005'
      )
  ),
  'fixed and auction confirmations must create item entitlements exactly once'
);

select test_support.assert_true(
  (
    select count(*) = 2
    from public.manual_transfer_payment_ledger
    where (
      commerce_order_transfer_id =
        '50000000-0000-4000-8000-000000000002'
      or manual_transfer_order_id =
        '60000000-0000-4000-8000-000000000005'
    )
      and entry_type = 'receipt'
  ),
  'fixed and auction confirmation must append one receipt each'
);

-- Standalone paid inventory intake: A transfers, B is co-located ---------

select set_config(
  'request.jwt.claim.sub',
  '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
  false
);
select public.release_paid_inventory_items(
  array[
    (
      select id
      from public.customer_inventory_items
      where commerce_order_item_id =
        '41000000-0000-4000-8000-000000000002'
    )
  ]::uuid[],
  array[0]::bigint[],
  '83000000-0000-4000-8000-000000000001',
  'A 매장 전일 결제 상품 출고'
);

select set_config(
  'request.jwt.claim.sub',
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  false
);
select public.release_paid_inventory_items(
  array[
    (
      select id
      from public.customer_inventory_items
      where commerce_order_item_id =
        '41000000-0000-4000-8000-000000000003'
    )
  ]::uuid[],
  array[0]::bigint[],
  '83000000-0000-4000-8000-000000000002',
  'B 매장 전일 결제 상품 현장 인계'
);

do $$
declare
  v_a uuid;
  v_b uuid;
  v_a_version bigint;
  v_b_version bigint;
begin
  select items.id, fulfillments.version
  into v_a, v_a_version
  from public.customer_inventory_items as items
  join public.inventory_item_fulfillments as fulfillments
    on fulfillments.inventory_item_id = items.id
  where items.commerce_order_item_id =
    '41000000-0000-4000-8000-000000000002';
  select items.id, fulfillments.version
  into v_b, v_b_version
  from public.customer_inventory_items as items
  join public.inventory_item_fulfillments as fulfillments
    on fulfillments.inventory_item_id = items.id
  where items.commerce_order_item_id =
    '41000000-0000-4000-8000-000000000003';

  perform test_support.assert_true(
    (
      select current_stage = 'in_transit_to_center'
        and location_kind = 'transit'
        and outbound_released
      from public.inventory_item_fulfillments
      where inventory_item_id = v_a
    )
    and (
      select current_stage = 'center_received'
        and location_kind = 'center'
        and outbound_released
      from public.inventory_item_fulfillments
      where inventory_item_id = v_b
    ),
    'A and B routes must produce distinct transfer and co-located stages'
  );

  perform public.record_inventory_center_items(
    'receive',
    array[v_a],
    array[v_a_version],
    null,
    '83000000-0000-4000-8000-000000000003',
    'A 상품 B 센터 수령'
  );
  select version into v_a_version
  from public.inventory_item_fulfillments
  where inventory_item_id = v_a;
  select version into v_b_version
  from public.inventory_item_fulfillments
  where inventory_item_id = v_b;

  if v_a < v_b then
    perform public.record_inventory_center_items(
      'store', array[v_a, v_b], array[v_a_version, v_b_version],
      'B-RACK-01', '83000000-0000-4000-8000-000000000004',
      'A/B 상품 함께 보관'
    );
  else
    perform public.record_inventory_center_items(
      'store', array[v_b, v_a], array[v_b_version, v_a_version],
      'B-RACK-01', '83000000-0000-4000-8000-000000000004',
      'A/B 상품 함께 보관'
    );
  end if;
end;
$$;
reset role;

select test_support.assert_true(
  (
    select count(*) = 2
      and bool_and(fulfillments.current_stage = 'center_stored')
      and bool_and(items.storage_started_at is not null)
      and bool_and(
        items.storage_expires_at =
          items.storage_started_at
          + make_interval(days => items.storage_duration_days)
      )
    from public.customer_inventory_items as items
    join public.inventory_item_fulfillments as fulfillments
      on fulfillments.inventory_item_id = items.id
    where items.commerce_order_item_id in (
      '41000000-0000-4000-8000-000000000002',
      '41000000-0000-4000-8000-000000000003'
    )
  ),
  'storage timers must start exactly when the center stores each item'
);

-- Immediate mixed-source shipment and partial exclusion -------------------

insert into public.manual_transfer_payment_ledger (
  transfer_kind,
  commerce_order_transfer_id,
  entry_type,
  amount,
  depositor_name,
  memo,
  recorded_by,
  idempotency_key
) values (
  'commerce',
  '50000000-0000-4000-8000-000000000003',
  'receipt',
  5000,
  'Buyer fixture',
  'partial fixture',
  '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
  '84000000-0000-4000-8000-000000000001'
);
update public.commerce_order_transfers
set status = 'partially_paid'
where id = '50000000-0000-4000-8000-000000000003';

select set_config(
  'request.jwt.claim.sub',
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  false
);
select test_support.assert_true(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_unified_manual_payment_queue(false, 200, 0) -> 'payments'
    ) as payments(value)
    where value ->> 'paymentId' =
      '50000000-0000-4000-8000-000000000003'
      and (value ->> 'receivedAmount')::bigint = 5000
      and (value ->> 'remainingAmount')::bigint = 10000
      and (value ->> 'ledgerEntryCount')::integer = 1
  ),
  'the shared queue must expose the exact cumulative partial-payment snapshot'
);
select public.confirm_unified_manual_payment(
  'commerce',
  '50000000-0000-4000-8000-000000000003',
  (
    select version
    from public.commerce_order_transfers
    where id = '50000000-0000-4000-8000-000000000003'
  ),
  'Buyer fixture',
  5000,
  1,
  '84000000-0000-4000-8000-000000000002'
);
reset role;

create table test_support.runtime_values (
  label text primary key,
  value uuid,
  payload jsonb
);
grant select, insert, update on test_support.runtime_values
to authenticated, service_role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
do $$
declare
  v_items uuid[];
  v_result jsonb;
  v_replay jsonb;
begin
  select array_agg(id order by id)
  into v_items
  from public.customer_inventory_items
  where commerce_order_item_id =
      '41000000-0000-4000-8000-000000000004'
     or manual_transfer_order_id =
      '60000000-0000-4000-8000-000000000005';

  v_result := public.request_inventory_shipment(
    v_items,
    '70000000-0000-4000-8000-000000000001',
    'manual_transfer',
    1,
    '클라이언트조작은행',
    '99999',
    '85000000-0000-4000-8000-000000000001'
  );
  perform test_support.assert_true(
    v_result ->> 'settlement_method' = 'manual_transfer'
      and (v_result -> 'payment' ->> 'expected_amount')::bigint = 3500
      and v_result -> 'payment' ->> 'bank_name_snapshot' = '테스트은행'
      and v_result -> 'payment' ->> 'account_number_snapshot' =
        '110-123-456789',
    'shipment response must use server-controlled fee and bank snapshots'
  );
  insert into test_support.runtime_values(label, value, payload)
  values (
    'partial-shipment',
    (v_result ->> 'shipment_id')::uuid,
    v_result
  );

  v_replay := public.request_inventory_shipment(
    v_items,
    '70000000-0000-4000-8000-000000000001',
    'manual_transfer',
    1,
    '클라이언트조작은행',
    '99999',
    '85000000-0000-4000-8000-000000000001'
  );
  perform test_support.assert_true(
    (v_replay ->> 'idempotent_replay')::boolean
      and v_replay ->> 'shipment_id' = v_result ->> 'shipment_id',
    'shipment request replay must return the original aggregate'
  );
end;
$$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  false
);
select test_support.expect_sqlstate(
  format(
    'select public.pack_inventory_shipment(%L::uuid,%s,%L::uuid,%L)',
    (
      select value
      from test_support.runtime_values
      where label = 'partial-shipment'
    ),
    (
      select version
      from public.inventory_shipments
      where id = (
        select value
        from test_support.runtime_values
        where label = 'partial-shipment'
      )
    ),
    '85000000-0000-4000-8000-000000000002',
    'must be blocked before store release'
  ),
  '55000',
  'pack must expose the exact unreleased-items business error',
  '미 출고된 상품이 존재합니다',
  'UNRELEASED_ITEMS'
);
reset role;

-- Each store releases only its own work. B then receives and stores both.
select set_config(
  'request.jwt.claim.sub',
  '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
  false
);
select public.release_inventory_shipment_items(
  (
    select works.id
    from public.inventory_shipment_store_works as works
    where works.shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'partial-shipment'
    )
      and works.origin_store_id =
        '20000000-0000-4000-8000-000000000001'
  ),
  array[
    (
      select id
      from public.customer_inventory_items
      where commerce_order_item_id =
        '41000000-0000-4000-8000-000000000004'
    )
  ]::uuid[],
  0,
  '85000000-0000-4000-8000-000000000003',
  'A 매장 배송 요청 상품 출고'
);

select set_config(
  'request.jwt.claim.sub',
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  false
);
select public.release_inventory_shipment_items(
  (
    select works.id
    from public.inventory_shipment_store_works as works
    where works.shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'partial-shipment'
    )
      and works.origin_store_id =
        '20000000-0000-4000-8000-000000000002'
  ),
  array[
    (
      select id
      from public.customer_inventory_items
      where manual_transfer_order_id =
        '60000000-0000-4000-8000-000000000005'
    )
  ]::uuid[],
  0,
  '85000000-0000-4000-8000-000000000004',
  'B 매장 배송 요청 상품 현장 인계'
);

select test_support.assert_true(
  not exists (
    select 1
    from jsonb_array_elements(
      public.get_inventory_center_queue(200, 0) -> 'items'
    ) as queued(value)
    where not (value ? 'centerId')
       or (value ->> 'centerId')::uuid is null
  ),
  'every center queue item must carry its explicit center identity'
);

do $$
declare
  v_a uuid;
  v_b uuid;
  v_a_version bigint;
  v_b_version bigint;
begin
  select items.id, fulfillments.version
  into v_a, v_a_version
  from public.customer_inventory_items as items
  join public.inventory_item_fulfillments as fulfillments
    on fulfillments.inventory_item_id = items.id
  where items.commerce_order_item_id =
    '41000000-0000-4000-8000-000000000004';
  select items.id, fulfillments.version
  into v_b, v_b_version
  from public.customer_inventory_items as items
  join public.inventory_item_fulfillments as fulfillments
    on fulfillments.inventory_item_id = items.id
  where items.manual_transfer_order_id =
    '60000000-0000-4000-8000-000000000005';

  perform public.record_inventory_center_items(
    'receive', array[v_a], array[v_a_version], null,
    '85000000-0000-4000-8000-000000000005',
    'A 배송 상품 B 센터 수령'
  );
  select version into v_a_version
  from public.inventory_item_fulfillments
  where inventory_item_id = v_a;
  select version into v_b_version
  from public.inventory_item_fulfillments
  where inventory_item_id = v_b;

  if v_a < v_b then
    perform public.record_inventory_center_items(
      'store', array[v_a, v_b], array[v_a_version, v_b_version],
      'B-RACK-02', '85000000-0000-4000-8000-000000000006',
      '배송 요청 상품 보관 완료'
    );
  else
    perform public.record_inventory_center_items(
      'store', array[v_b, v_a], array[v_b_version, v_a_version],
      'B-RACK-02', '85000000-0000-4000-8000-000000000006',
      '배송 요청 상품 보관 완료'
    );
  end if;
end;
$$;

do $$
declare
  v_item uuid;
  v_case jsonb;
  v_resolved jsonb;
begin
  select id into v_item
  from public.customer_inventory_items
  where manual_transfer_order_id =
    '60000000-0000-4000-8000-000000000005';
  v_case := public.open_inventory_exception(
    v_item,
    'inspection_required',
    '오프라인 재고 상태 확인이 필요합니다.',
    'B 매장 확인 중',
    clock_timestamp()+interval '1 day',
    '85000000-0000-4000-8000-000000000007'
  );
  v_resolved := public.resolve_inventory_exception(
    (v_case ->> 'id')::uuid,
    (v_case ->> 'version')::bigint,
    'exclude_for_later',
    '이번 배송에서 제외하고 다음 신청을 기다립니다.',
    '부분 배송은 계속 진행',
    '85000000-0000-4000-8000-000000000008'
  );
  perform test_support.assert_true(
    v_resolved ->> 'resolution' = 'exclude_for_later',
    'the held auction item must resolve as exclude-for-later'
  );
end;
$$;

-- Any store operator with the business payment permission can confirm the
-- central shipping fee, while only the assigned B center can pack/ship.
select set_config(
  'request.jwt.claim.sub',
  '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
  false
);
select public.confirm_unified_manual_payment(
  'shipping_fee',
  (
    select shipping_fee_payment_id
    from public.inventory_shipments
    where id = (
      select value
      from test_support.runtime_values
      where label = 'partial-shipment'
    )
  ),
  (
    select payments.version
    from public.shipping_fee_payments as payments
    join public.inventory_shipments as shipments
      on shipments.shipping_fee_payment_id = payments.id
    where shipments.id = (
      select value
      from test_support.runtime_values
      where label = 'partial-shipment'
    )
  ),
  'Buyer fixture',
  0,
  0,
  '85000000-0000-4000-8000-000000000009'
);
select test_support.expect_sqlstate(
  format(
    'select public.pack_inventory_shipment(%L::uuid,%s,%L::uuid,%L)',
    (
      select value
      from test_support.runtime_values
      where label = 'partial-shipment'
    ),
    (
      select version
      from public.inventory_shipments
      where id = (
        select value
        from test_support.runtime_values
        where label = 'partial-shipment'
      )
    ),
    '85000000-0000-4000-8000-000000000010',
    'A store operator must not pack at B center'
  ),
  '42501',
  'center assignment must gate packing'
);

select set_config(
  'request.jwt.claim.sub',
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  false
);
do $$
declare
  v_shipment uuid;
  v_version bigint;
  v_result jsonb;
begin
  select value into v_shipment
  from test_support.runtime_values
  where label = 'partial-shipment';
  select version into v_version
  from public.inventory_shipments
  where id = v_shipment;
  v_result := public.pack_inventory_shipment(
    v_shipment,
    v_version,
    '85000000-0000-4000-8000-000000000011',
    '부분 제외 후 포장'
  );
  perform test_support.assert_true(
    v_result ->> 'status' = 'packed',
    'the remaining ready item must pack after partial exclusion'
  );
  perform test_support.expect_sqlstate(
    format(
      'select public.open_inventory_exception(%L::uuid,%L,%L,%L,%L::timestamptz,%L::uuid)',
      (
        select inventory_item_id
        from public.inventory_shipment_items
        where shipment_id = v_shipment
          and line_status = 'packed'
        limit 1
      ),
      'inspection_required',
      '포장 이후 예외 차단 확인입니다.',
      'packed-stage guard fixture',
      clock_timestamp()+interval '1 day',
      '85000000-0000-4000-8000-000000000012'
    ),
    '55000',
    'packed inventory must reject a newly opened exception',
    '현재 단계에서는 상품 예외를 시작할 수 없습니다.'
  );
  v_result := public.ship_inventory_shipment(
    v_shipment,
    (v_result ->> 'version')::bigint,
    'CJ대한통운',
    '1234567890',
    '85000000-0000-4000-8000-000000000013',
    '부분 배송 발송'
  );
  perform test_support.assert_true(
    v_result ->> 'status' = 'shipped',
    'the packed aggregate must ship once with one tracking number'
  );
end;
$$;
reset role;

select test_support.assert_true(
  (
    select count(*) = 1
      and bool_and(items.line_status = 'shipped')
    from public.inventory_shipment_items as items
    where items.shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'partial-shipment'
    )
      and items.line_status = 'shipped'
  )
  and (
    select line_status = 'excluded'
    from public.inventory_shipment_items
    where shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'partial-shipment'
    )
      and inventory_item_id = (
        select id
        from public.customer_inventory_items
        where manual_transfer_order_id =
          '60000000-0000-4000-8000-000000000005'
      )
  )
  and (
    select count(*) = 1
    from public.shipping_fee_waiver_entitlements
    where member_id = '10000000-0000-4000-8000-000000000001'
      and status = 'available'
  ),
  'partial exclusion must ship the remaining item and issue one waiver'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
select test_support.assert_true(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_my_inventory_shipments() -> 'shipments'
    ) as shipments(value)
    where (value ->> 'id')::uuid = (
      select value
      from test_support.runtime_values
      where label = 'partial-shipment'
    )
      and value ->> 'trackingNumber' = '1234567890'
      and value ->> 'trackingUrl' like
        'https://trace.cjlogistics.com/%'
  )
  and exists (
    select 1
    from jsonb_array_elements(
      public.get_my_inventory_overview() -> 'items'
    ) as inventory(value)
    where value ->> 'sourceReference' =
      '60000000-0000-4000-8000-000000000005'
      and value ->> 'exceptionResolution' = 'exclude_for_later'
      and (value ->> 'requestEligible')::boolean
  ),
  'buyer views must expose tracking and the excluded item situation'
);

-- Reuse the partial-exclusion waiver, then restore it if every line is
-- excluded. No fee refund is created because no shipping fee was collected.
do $$
declare
  v_item uuid;
  v_request jsonb;
  v_case jsonb;
begin
  select id into v_item
  from public.customer_inventory_items
  where manual_transfer_order_id =
    '60000000-0000-4000-8000-000000000005';
  v_request := public.request_inventory_shipment(
    array[v_item],
    '70000000-0000-4000-8000-000000000001',
    'manual_transfer',
    999999,
    '무시할은행',
    '99999',
    '86000000-0000-4000-8000-000000000001'
  );
  perform test_support.assert_true(
    v_request ->> 'settlement_method' = 'waiver',
    'an available waiver must override the requested settlement method'
  );
  insert into test_support.runtime_values(label, value, payload)
  values (
    'waiver-shipment',
    (v_request ->> 'shipment_id')::uuid,
    v_request
  );
  perform set_config(
    'request.jwt.claim.sub',
    '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
    false
  );
  v_case := public.open_inventory_exception(
    v_item,
    'additional_wait',
    '추가 확인을 위해 이번 단독 배송에서 제외합니다.',
    'waiver restore fixture',
    clock_timestamp()+interval '1 day',
    '86000000-0000-4000-8000-000000000002'
  );
  perform public.resolve_inventory_exception(
    (v_case ->> 'id')::uuid,
    0,
    'exclude_for_later',
    '다음 배송 신청까지 보관을 계속합니다.',
    'all excluded waiver fixture',
    '86000000-0000-4000-8000-000000000003'
  );
end;
$$;
reset role;

select test_support.assert_true(
  (
    select status = 'cancelled'
      and cancellation_reason = 'all_lines_excluded'
      and settlement_method = 'waiver'
    from public.inventory_shipments
    where id = (
      select value
      from test_support.runtime_values
      where label = 'waiver-shipment'
    )
  )
  and (
    select count(*) = 1
    from public.shipping_fee_waiver_entitlements
    where member_id = '10000000-0000-4000-8000-000000000001'
      and status = 'available'
  )
  and not exists (
    select 1
    from public.shipping_fee_refunds
    where inventory_shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'waiver-shipment'
    )
  ),
  'all-excluded waiver shipment must restore the same waiver without a refund'
);

-- All-excluded paid shipment creates a real shipping-fee refund ------------

update public.shipping_fee_waiver_entitlements
set status = 'cancelled'
where member_id = '10000000-0000-4000-8000-000000000001'
  and status = 'available';

select set_config(
  'request.jwt.claim.sub',
  '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
  false
);
select public.confirm_unified_manual_payment(
  'commerce',
  '50000000-0000-4000-8000-000000000004',
  0,
  'Buyer fixture',
  0,
  0,
  '87000000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
do $$
declare
  v_item uuid;
  v_request jsonb;
begin
  select id into v_item
  from public.customer_inventory_items
  where commerce_order_item_id =
    '41000000-0000-4000-8000-000000000006';
  v_request := public.request_inventory_shipment(
    array[v_item],
    '70000000-0000-4000-8000-000000000001',
    'manual_transfer',
    3500,
    '테스트은행',
    '110-123-456789',
    '87000000-0000-4000-8000-000000000002'
  );
  insert into test_support.runtime_values(label, value, payload)
  values (
    'fee-refund-shipment',
    (v_request ->> 'shipment_id')::uuid,
    v_request
  );
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  false
);
select public.confirm_unified_manual_payment(
  'shipping_fee',
  (
    select shipping_fee_payment_id
    from public.inventory_shipments
    where id = (
      select value
      from test_support.runtime_values
      where label = 'fee-refund-shipment'
    )
  ),
  (
    select payments.version
    from public.shipping_fee_payments as payments
    join public.inventory_shipments as shipments
      on shipments.shipping_fee_payment_id = payments.id
    where shipments.id = (
      select value
      from test_support.runtime_values
      where label = 'fee-refund-shipment'
    )
  ),
  'Buyer fixture',
  0,
  0,
  '87000000-0000-4000-8000-000000000003'
);

do $$
declare
  v_item uuid;
  v_case jsonb;
begin
  select id into v_item
  from public.customer_inventory_items
  where commerce_order_item_id =
    '41000000-0000-4000-8000-000000000006';
  v_case := public.open_inventory_exception(
    v_item,
    'offline_sold',
    '오프라인 매장에서 판매되어 배송할 수 없습니다.',
    'shipping fee refund fixture',
    clock_timestamp()+interval '1 hour',
    '87000000-0000-4000-8000-000000000004'
  );
  perform test_support.expect_sqlstate(
    format(
      'select public.resolve_inventory_exception(%L::uuid,0,%L,%L,%L,%L::uuid)',
      (v_case ->> 'id')::uuid,
      'exclude_for_later',
      '오프라인 판매 상품을 보류로 끝낼 수 있는지 확인합니다.',
      'offline sale must require refund',
      '87000000-0000-4000-8000-000000000005'
    ),
    '22023',
    'offline-sold inventory must not be resumed or excluded without a refund',
    '오프라인 판매 또는 환불 대상 상품은 환불로만 처리할 수 있습니다.'
  );
  perform public.resolve_inventory_exception(
    (v_case ->> 'id')::uuid,
    0,
    'refund',
    '이번 배송 전체가 취소되어 배송비를 환불합니다.',
    'all excluded fee refund fixture',
    '87000000-0000-4000-8000-000000000006'
  );
end;
$$;
reset role;

select test_support.assert_true(
  (
    select status = 'cancelled'
      and cancellation_reason = 'all_lines_excluded'
    from public.inventory_shipments
    where id = (
      select value
      from test_support.runtime_values
      where label = 'fee-refund-shipment'
    )
  )
  and (
    select count(*) = 1
      and bool_and(status = 'requested')
      and bool_and(amount = 3500)
    from public.shipping_fee_refunds
    where inventory_shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'fee-refund-shipment'
    )
  ),
  'all-excluded paid shipment must create one requested fee refund'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
select public.submit_shipping_fee_refund_account(
  (
    select id
    from public.shipping_fee_refunds
    where inventory_shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'fee-refund-shipment'
    )
  ),
  encode(convert_to(repeat('c', 16), 'UTF8'), 'base64'),
  encode(convert_to(repeat('i', 12), 'UTF8'), 'base64'),
  encode(convert_to(repeat('t', 16), 'UTF8'), 'base64'),
  1,
  repeat('a', 64),
  '****6789',
  '87000000-0000-4000-8000-000000000006'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '30be08c2-6259-42c6-af26-4ded6362de12',
  false
);
select public.record_shipping_fee_refund_account_access(
  (
    select id
    from public.shipping_fee_refunds
    where inventory_shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'fee-refund-shipment'
    )
  ),
  '배송비 환불 송금 처리',
  '87000000-0000-4000-8000-000000000007'
);
select public.review_shipping_fee_refund(
  (
    select id
    from public.shipping_fee_refunds
    where inventory_shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'fee-refund-shipment'
    )
  ),
  1,
  'complete',
  'SHIP-REFUND-001',
  '87000000-0000-4000-8000-000000000008'
);
reset role;

select test_support.assert_true(
  (
    select refunds.status = 'completed'
      and disbursements.amount = refunds.amount
      and disbursements.external_reference = 'SHIP-REFUND-001'
    from public.shipping_fee_refunds as refunds
    join public.shipping_fee_refund_disbursements as disbursements
      on disbursements.shipping_fee_refund_id = refunds.id
    where refunds.inventory_shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'fee-refund-shipment'
    )
  )
  and not exists (
    select 1
    from public.shipping_fee_refund_accounts as accounts
    join public.shipping_fee_refunds as refunds
      on refunds.id = accounts.shipping_fee_refund_id
    where refunds.inventory_shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'fee-refund-shipment'
    )
  )
  and exists (
    select 1
    from public.store_financial_entries
    where inventory_shipment_id = (
      select value
      from test_support.runtime_values
      where label = 'fee-refund-shipment'
    )
      and entry_kind = 'shipping_fee_refund'
      and amount = -3500
  ),
  'completed shipping-fee refund must record disbursement, erase account, and post a negative ledger entry'
);

-- Item refund, 30-day account cleanup, owner approval, and store ledger ----

select set_config(
  'request.jwt.claim.sub',
  '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
  false
);
select public.confirm_unified_manual_payment(
  'commerce',
  '50000000-0000-4000-8000-000000000005',
  0,
  'Buyer fixture',
  0,
  0,
  '88000000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claim.sub',
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  false
);
do $$
declare
  v_item uuid;
  v_case jsonb;
  v_refund jsonb;
begin
  select id into v_item
  from public.customer_inventory_items
  where commerce_order_item_id =
    '41000000-0000-4000-8000-000000000007';
  v_case := public.open_inventory_exception(
    v_item,
    'missing',
    '보관 정리 중 상품을 찾을 수 없습니다.',
    'item refund fixture',
    clock_timestamp()+interval '1 hour',
    '88000000-0000-4000-8000-000000000002'
  );
  v_refund := public.resolve_inventory_exception(
    (v_case ->> 'id')::uuid,
    0,
    'refund',
    '상품 분실을 확인하여 결제 금액을 환불합니다.',
    'owner refund required',
    '88000000-0000-4000-8000-000000000003'
  );
  insert into test_support.runtime_values(label, value, payload)
  values (
    'item-refund',
    (v_refund ->> 'refundId')::uuid,
    v_refund
  );
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
select public.submit_manual_refund_account(
  (
    select value
    from test_support.runtime_values
    where label = 'item-refund'
  ),
  encode(convert_to(repeat('c', 16), 'UTF8'), 'base64'),
  encode(convert_to(repeat('i', 12), 'UTF8'), 'base64'),
  encode(convert_to(repeat('t', 16), 'UTF8'), 'base64'),
  1,
  repeat('b', 64),
  '****4321',
  '88000000-0000-4000-8000-000000000004'
);
reset role;

update public.manual_refund_accounts
set account_submitted_at = clock_timestamp()-interval '31 days'
where refund_id = (
  select value
  from test_support.runtime_values
  where label = 'item-refund'
);
update public.manual_refund_accounts
set account_expires_at = clock_timestamp()-interval '1 minute'
where refund_id = (
  select value
  from test_support.runtime_values
  where label = 'item-refund'
);
select app_private.clear_expired_manual_refund_accounts();

select test_support.assert_true(
  not exists (
    select 1
    from public.manual_refund_accounts
    where refund_id = (
      select value
      from test_support.runtime_values
      where label = 'item-refund'
    )
  ),
  'expired encrypted refund account material must be physically deleted'
);

select set_config(
  'request.jwt.claim.sub',
  '30be08c2-6259-42c6-af26-4ded6362de12',
  false
);
select test_support.expect_sqlstate(
  format(
    'select public.review_manual_refund(%L::uuid,1,%L,null,null,%L::uuid)',
    (
      select value
      from test_support.runtime_values
      where label = 'item-refund'
    ),
    'approve',
    '88000000-0000-4000-8000-000000000005'
  ),
  '55000',
  'owner approval must fail after account expiration cleanup'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
select public.submit_manual_refund_account(
  (
    select value
    from test_support.runtime_values
    where label = 'item-refund'
  ),
  encode(convert_to(repeat('d', 16), 'UTF8'), 'base64'),
  encode(convert_to(repeat('j', 12), 'UTF8'), 'base64'),
  encode(convert_to(repeat('u', 16), 'UTF8'), 'base64'),
  1,
  repeat('c', 64),
  '****4321',
  '88000000-0000-4000-8000-000000000006'
);

select set_config(
  'request.jwt.claim.sub',
  '30be08c2-6259-42c6-af26-4ded6362de12',
  false
);
select public.record_manual_refund_account_access(
  (
    select value
    from test_support.runtime_values
    where label = 'item-refund'
  ),
  '상품 환불 송금 처리',
  '88000000-0000-4000-8000-000000000007'
);
select public.review_manual_refund(
  (
    select value
    from test_support.runtime_values
    where label = 'item-refund'
  ),
  2,
  'approve',
  null,
  '환불 계좌 확인 완료',
  '88000000-0000-4000-8000-000000000008'
);
select public.review_manual_refund(
  (
    select value
    from test_support.runtime_values
    where label = 'item-refund'
  ),
  3,
  'complete',
  'ITEM-REFUND-001',
  '환불 송금 완료',
  '88000000-0000-4000-8000-000000000009'
);
reset role;

select test_support.assert_true(
  (
    select refunds.status = 'completed'
      and refunds.amount = 25000
      and disbursements.amount = 25000
      and items.ownership_status = 'refunded'
      and fulfillments.current_stage = 'cancelled'
    from public.manual_refunds as refunds
    join public.manual_refund_disbursements as disbursements
      on disbursements.refund_id = refunds.id
    join public.customer_inventory_items as items
      on items.id = refunds.inventory_item_id
    join public.inventory_item_fulfillments as fulfillments
      on fulfillments.inventory_item_id = items.id
    where refunds.id = (
      select value
      from test_support.runtime_values
      where label = 'item-refund'
    )
  )
  and not exists (
    select 1
    from public.manual_refund_accounts
    where refund_id = (
      select value
      from test_support.runtime_values
      where label = 'item-refund'
    )
  )
  and exists (
    select 1
    from public.store_financial_entries
    where manual_refund_id = (
      select value
      from test_support.runtime_values
      where label = 'item-refund'
    )
      and origin_store_id =
        '20000000-0000-4000-8000-000000000002'
      and entry_kind = 'item_refund'
      and amount = -25000
  ),
  'item refund completion must erase the account and post against origin store B'
);

select test_support.assert_true(
  not exists (
    select 1
    from public.manual_refund_events
    where metadata::text like '%4321%'
       or metadata::text like '%' || repeat('c', 64) || '%'
  )
  and not exists (
    select 1
    from public.shipping_fee_refund_events
    where metadata::text like '%6789%'
       or metadata::text like '%' || repeat('a', 64) || '%'
  ),
  'append-only refund events must not retain masked accounts or fingerprints'
);

-- Independent backends: exactly one confirmation wins --------------------

create or replace function test_support.capture_confirm(
  p_key uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  return public.confirm_unified_manual_payment(
    'commerce',
    '50000000-0000-4000-8000-000000000006',
    0,
    'Buyer fixture',
    0,
    0,
    p_key
  );
exception when others then
  return jsonb_build_object(
    'error', true,
    'sqlstate', sqlstate,
    'message', sqlerrm
  );
end;
$$;
grant execute on function test_support.capture_confirm(uuid) to authenticated;

create table test_support.concurrent_results (
  payload jsonb not null
);

-- The outer test has switched between application roles. Reassert the local
-- superuser before opening dblink sessions; each remote session then switches
-- to authenticated and receives the operator JWT claim below.
set role postgres;
select public.dblink_connect(
  'confirm_a',
  format(
    'host=host.docker.internal port=%s dbname=%s user=%s password=postgres',
    :'test_port', :'test_database', :'test_user'
  )
);
select public.dblink_connect(
  'confirm_b',
  format(
    'host=host.docker.internal port=%s dbname=%s user=%s password=postgres',
    :'test_port', :'test_database', :'test_user'
  )
);
select public.dblink_exec('confirm_a', 'set role authenticated');
select public.dblink_exec('confirm_b', 'set role authenticated');
select public.dblink_exec(
  'confirm_a',
  $$set request.jwt.claim.sub = '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'$$
);
select public.dblink_exec(
  'confirm_b',
  $$set request.jwt.claim.sub = '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'$$
);
select public.dblink_send_query(
  'confirm_a',
  $$select test_support.capture_confirm(
    '89000000-0000-4000-8000-000000000001')$$
);
select public.dblink_send_query(
  'confirm_b',
  $$select test_support.capture_confirm(
    '89000000-0000-4000-8000-000000000002')$$
);
insert into test_support.concurrent_results(payload)
select payload
from public.dblink_get_result('confirm_a') as result(payload jsonb)
union all
select payload
from public.dblink_get_result('confirm_b') as result(payload jsonb);
select public.dblink_disconnect('confirm_a');
select public.dblink_disconnect('confirm_b');

select test_support.assert_true(
  (
    select count(*) = 1
    from test_support.concurrent_results
    where payload ->> 'status' = 'confirmed'
  )
  and (
    select count(*) = 1
    from test_support.concurrent_results
    where payload ->> 'sqlstate' = 'PT409'
  )
  and (
    select count(*) = 1
    from public.manual_transfer_payment_ledger
    where commerce_order_transfer_id =
      '50000000-0000-4000-8000-000000000006'
      and entry_type = 'receipt'
  )
  and (
    select count(*) = 1
    from public.customer_inventory_items
    where commerce_order_item_id =
      '41000000-0000-4000-8000-000000000008'
  ),
  'concurrent confirm must yield one winner, one CAS loser, one receipt, and one entitlement'
);

select test_support.assert_true(
  (
    select deadlocks = 0
    from pg_stat_database
    where datname = current_database()
  ),
  'consistent lock ordering must avoid database deadlocks'
);

-- RLS, direct-table denial, least privilege, and append-only evidence ------

select test_support.assert_true(
  not has_table_privilege(
    'authenticated', 'public.customer_inventory_items', 'SELECT'
  )
  and not has_table_privilege(
    'authenticated', 'public.inventory_shipments', 'SELECT'
  )
  and not has_table_privilege(
    'authenticated', 'public.manual_refund_accounts', 'SELECT'
  )
  and has_table_privilege(
    'service_role', 'public.manual_refund_accounts', 'SELECT'
  )
  and has_table_privilege(
    'service_role', 'public.shipping_fee_refund_accounts', 'SELECT'
  )
  and not has_table_privilege(
    'service_role', 'public.manual_refund_accounts', 'UPDATE'
  )
  and has_function_privilege(
    'authenticated',
    'public.confirm_unified_manual_payment(text,uuid,bigint,text,bigint,integer,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.confirm_unified_manual_payment(text,uuid,bigint,text,bigint,integer,uuid)',
    'EXECUTE'
  ),
  'v2 tables and RPCs must follow least-privilege grants'
);

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
select test_support.expect_sqlstate(
  $$select * from public.customer_inventory_items limit 1$$,
  '42501',
  'buyer direct inventory-table access must be denied'
);
select test_support.expect_sqlstate(
  $$select * from public.manual_refund_accounts limit 1$$,
  '42501',
  'buyer direct encrypted-account access must be denied'
);

select set_config(
  'request.jwt.claim.sub',
  '30be08c2-6259-42c6-af26-4ded6362de12',
  false
);
select test_support.expect_sqlstate(
  $$select * from public.shipping_fee_refund_accounts limit 1$$,
  '42501',
  'owner direct encrypted-account access must be denied'
);
reset role;

set role service_role;
select count(*) from public.manual_refund_accounts;
select count(*) from public.shipping_fee_refund_accounts;
select test_support.expect_sqlstate(
  $$update public.manual_refund_accounts
    set account_key_version = account_key_version
    where false$$,
  '42501',
  'service role may read but not mutate encrypted accounts'
);
reset role;

select test_support.expect_sqlstate(
  $$update public.inventory_shipment_events
    set metadata = metadata
    where false$$,
  '55000',
  'shipment events must be append-only'
);
select test_support.expect_sqlstate(
  $$delete from public.store_financial_entries where false$$,
  '55000',
  'financial ledger must be append-only'
);

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '30be08c2-6259-42c6-af26-4ded6362de12',
  false
);
select test_support.assert_true(
  (
    select count(*) = 2
    from jsonb_array_elements(
      public.get_store_financial_report(
        (clock_timestamp() at time zone 'Asia/Seoul')::date-30,
        (clock_timestamp() at time zone 'Asia/Seoul')::date
      ) -> 'stores'
    ) as stores(value)
    where value ->> 'storeId' in (
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002'
    )
  )
  and (
    public.get_store_financial_report(
      (clock_timestamp() at time zone 'Asia/Seoul')::date-30,
      (clock_timestamp() at time zone 'Asia/Seoul')::date
    ) ->> 'centralShippingFees'
  )::bigint = 3500
  and exists (
    select 1
    from jsonb_array_elements(
      public.get_store_financial_report(
        (clock_timestamp() at time zone 'Asia/Seoul')::date-30,
        (clock_timestamp() at time zone 'Asia/Seoul')::date
      ) -> 'stores'
    ) as stores(value)
    where value ->> 'storeId' =
      '20000000-0000-4000-8000-000000000002'
      and (value ->> 'refunds')::bigint >= 25000
  ),
  'financial report must split A/B revenue and keep shipping fees central'
);
reset role;

-- Buyer-safe command wrappers must reject mixed-buyer batches before any
-- underlying inventory transition can run, including manipulated RPC calls.
begin;
create temporary table buyer_mixing_items on commit drop as
select i.id,f.version,row_number() over(order by i.id) ordinal
from public.customer_inventory_items i
join public.inventory_item_fulfillments f on f.inventory_item_id=i.id
where not exists(select 1 from public.inventory_shipment_items x where x.inventory_item_id=i.id)
order by i.id limit 2;
grant select on buyer_mixing_items to authenticated;
select test_support.assert_true((select count(*) from buyer_mixing_items)=2,'mixed-buyer fixture requires two unshipped inventory items');
alter table public.customer_inventory_items disable trigger customer_inventory_items_guard_snapshot;
update public.customer_inventory_items set member_id='4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'
where id=(select id from buyer_mixing_items where ordinal=1);
alter table public.customer_inventory_items enable trigger customer_inventory_items_guard_snapshot;
set local role authenticated;
select set_config('request.jwt.claim.sub','30be08c2-6259-42c6-af26-4ded6362de12',true);
do $$
declare v_ids uuid[]; v_versions bigint[];
begin
  select array_agg(m.id order by m.id),array_agg(m.version order by m.id)
  into v_ids,v_versions from buyer_mixing_items m;
  begin
    perform public.release_buyer_paid_inventory_items(v_ids,v_versions,gen_random_uuid(),'혼합 구매자 거부 검증');
    raise exception 'mixed buyer release should fail';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_buyer_inventory_center_items('receive',v_ids,v_versions,null,gen_random_uuid(),'혼합 구매자 거부 검증');
    raise exception 'mixed buyer center work should fail';
  exception when sqlstate '22023' then null;
  end;
end;
$$;
rollback;
