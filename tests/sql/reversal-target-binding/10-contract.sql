-- The fixture deliberately uses fixed UUIDs so a failure can be replayed directly in psql.
insert into public.payment_runtime_settings (singleton, active_mode) values (true, 'manual_transfer');
set app.test_user_id = '00000000-0000-4000-8000-000000000002';
set app.test_is_staff = 'true';
set app.test_is_owner = 'false';

insert into public.stores values ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000002');
insert into public.products values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000010'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000010'),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000010');
insert into public.commerce_orders (id, member_id, status) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000003', 'paid'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000003', 'paid');
insert into public.commerce_order_transfers (id, order_id, expected_amount, status) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 100, 'confirmed'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000102', 100, 'confirmed');
insert into public.commerce_order_items (order_id, product_id) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000012');
insert into public.manual_transfer_payment_ledger (id, transfer_kind, commerce_order_transfer_id, entry_type, amount, memo, recorded_by, idempotency_key) values
  ('00000000-0000-4000-8000-000000000301', 'commerce', '00000000-0000-4000-8000-000000000201', 'receipt', 100, '', '00000000-0000-4000-8000-000000000002', 'legacy:00000000-0000-4000-8000-000000000301'),
  ('00000000-0000-4000-8000-000000000302', 'commerce', '00000000-0000-4000-8000-000000000202', 'receipt', 100, '', '00000000-0000-4000-8000-000000000002', 'legacy:00000000-0000-4000-8000-000000000302');

do $$
begin
  begin
    perform public.reverse_manual_transfer_payment('commerce', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000301', 100, 1, '10000000-0000-4000-8000-000000000001', 'wrong target');
    raise exception 'commerce wrong target unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
  perform test_support.assert_true((select count(*) = 0 from public.manual_transfer_payment_ledger where reversal_of in ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302')), 'wrong commerce target must not write a reversal');
  begin
    perform public.reverse_manual_transfer_payment('commerce', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301', 99, 1, '10000000-0000-4000-8000-000000000002', 'stale');
    raise exception 'commerce stale CAS unexpectedly succeeded';
  exception when sqlstate 'PT409' then null;
  end;
  perform test_support.assert_true((select count(*) = 0 from public.manual_transfer_payment_ledger where reversal_of in ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302')), 'stale commerce CAS must not write a reversal');
end;
$$;

do $$
declare v_first jsonb; v_replay jsonb;
begin
  v_first := public.reverse_manual_transfer_payment('commerce', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301', 100, 1, '10000000-0000-4000-8000-000000000003', 'operator correction');
  perform test_support.assert_true(v_first ->> 'status' = 'awaiting_transfer' and (v_first ->> 'received_amount')::bigint = 0 and (v_first ->> 'ledger_entry_count')::integer = 2 and not (v_first ->> 'idempotent_replay')::boolean, 'commerce success must apply signed total and count');
  v_replay := public.reverse_manual_transfer_payment('commerce', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301', 100, 1, '10000000-0000-4000-8000-000000000003', 'operator correction');
  perform test_support.assert_true((v_replay ->> 'idempotent_replay')::boolean and v_replay ->> 'ledger_id' = v_first ->> 'ledger_id', 'commerce same actor/key must replay the original reversal');
  begin
    perform public.reverse_manual_transfer_payment('commerce', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301', 0, 2, '10000000-0000-4000-8000-000000000003', 'changed payload');
    raise exception 'commerce changed same-key payload unexpectedly succeeded';
  exception when sqlstate '23505' then null;
  end;
  begin
    perform public.reverse_manual_transfer_payment('commerce', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301', 0, 2, '10000000-0000-4000-8000-000000000004', 'another key');
    raise exception 'commerce second reversal unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
end;
$$;

set role authenticated;
select test_support.assert_true(
  (public.reverse_manual_transfer_payment('commerce', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301', 100, 1, '10000000-0000-4000-8000-000000000003', 'operator correction') ->> 'idempotent_replay')::boolean,
  'authenticated execution must retain the same actor-scoped replay identity'
);
reset role;

-- The migration must preserve the pre-contract NULL reversal key from 05-legacy-state.
select test_support.assert_true(exists (select 1 from public.manual_transfer_payment_ledger where id = '00000000-0000-4000-8000-000000000904' and memo = 'legacy reversal' and idempotency_key is null), 'legacy NULL reversal keys must remain valid');

insert into public.manual_transfer_orders (id, product_id, expected_amount, buyer_id, status) values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000013', 70, '00000000-0000-4000-8000-000000000003', 'confirmed');
insert into public.manual_transfer_payment_ledger (id, transfer_kind, manual_transfer_order_id, entry_type, amount, memo, recorded_by, idempotency_key) values
  ('00000000-0000-4000-8000-000000000402', 'auction', '00000000-0000-4000-8000-000000000401', 'receipt', 70, '', '00000000-0000-4000-8000-000000000002', 'legacy:00000000-0000-4000-8000-000000000402');
do $$
declare v_result jsonb;
begin
  begin
    perform public.reverse_manual_transfer_payment('commerce', '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000402', 70, 1, '10000000-0000-4000-8000-000000000005', 'wrong auction kind');
    raise exception 'auction wrong kind unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.reverse_manual_transfer_payment('auction', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000402', 70, 1, '10000000-0000-4000-8000-000000000006', 'wrong auction scope');
    raise exception 'auction wrong scope unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
  perform test_support.assert_true((select count(*) = 0 from public.manual_transfer_payment_ledger where reversal_of = '00000000-0000-4000-8000-000000000402'), 'auction target probes must have no side effects');
  v_result := public.reverse_manual_transfer_payment('auction', '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000402', 70, 1, '10000000-0000-4000-8000-00000000000b', 'store-scoped auction correction');
  perform test_support.assert_true(v_result ->> 'status' = 'awaiting_manual_transfer' and (v_result ->> 'received_amount')::bigint = 0 and not (v_result ->> 'idempotent_replay')::boolean, 'store-scoped staff must reverse only its exact auction target');
end;
$$;

set app.test_user_id = '00000000-0000-4000-8000-000000000001';
set app.test_is_staff = 'true';
set app.test_is_owner = 'true';
insert into public.member_accounts values ('00000000-0000-4000-8000-000000000003', 1);
insert into public.shipping_fee_payments (id, member_id, expected_amount, status) values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000003', 50, 'confirmed'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000003', 50, 'confirmed');
insert into public.manual_transfer_payment_ledger (id, transfer_kind, shipping_fee_payment_id, entry_type, amount, memo, recorded_by, idempotency_key) values
  ('00000000-0000-4000-8000-000000000601', 'shipping', '00000000-0000-4000-8000-000000000501', 'receipt', 50, '', '00000000-0000-4000-8000-000000000001', 'legacy:00000000-0000-4000-8000-000000000601'),
  ('00000000-0000-4000-8000-000000000602', 'shipping', '00000000-0000-4000-8000-000000000502', 'receipt', 50, '', '00000000-0000-4000-8000-000000000001', 'legacy:00000000-0000-4000-8000-000000000602');
do $$
declare v_first jsonb; v_replay jsonb;
begin
  begin
    perform public.reverse_shipping_fee_payment('shipping', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000601', 50, 1, '10000000-0000-4000-8000-000000000007', 'wrong shipping target');
    raise exception 'shipping wrong target unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.reverse_shipping_fee_payment('shipping', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000601', 49, 1, '10000000-0000-4000-8000-000000000008', 'stale shipping');
    raise exception 'shipping stale CAS unexpectedly succeeded';
  exception when sqlstate 'PT409' then null;
  end;
  perform test_support.assert_true((select count(*) = 0 from public.manual_transfer_payment_ledger where reversal_of = '00000000-0000-4000-8000-000000000601' or shipping_fee_payment_id = '00000000-0000-4000-8000-000000000502' and entry_type = 'reversal'), 'shipping target and stale CAS probes must not write a reversal');
  v_first := public.reverse_shipping_fee_payment('shipping', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000601', 50, 1, '10000000-0000-4000-8000-000000000009', 'shipping correction');
  perform test_support.assert_true(v_first ->> 'status' = 'awaiting_transfer' and (v_first ->> 'received_amount')::bigint = 0 and (v_first ->> 'ledger_entry_count')::integer = 2 and not (v_first ->> 'idempotent_replay')::boolean, 'shipping success must apply signed total and count');
  v_replay := public.reverse_shipping_fee_payment('shipping', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000601', 50, 1, '10000000-0000-4000-8000-000000000009', 'shipping correction');
  perform test_support.assert_true((v_replay ->> 'idempotent_replay')::boolean and v_replay ->> 'ledger_id' = v_first ->> 'ledger_id', 'shipping same actor/key must replay');
  begin
    perform public.reverse_shipping_fee_payment('shipping', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000601', 0, 2, '10000000-0000-4000-8000-000000000009', 'changed shipping payload');
    raise exception 'shipping changed same-key payload unexpectedly succeeded';
  exception when sqlstate '23505' then null;
  end;
  begin
    perform public.reverse_shipping_fee_payment('shipping', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000601', 0, 2, '10000000-0000-4000-8000-00000000000a', 'another shipping key');
    raise exception 'shipping second reversal unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
end;
$$;

select test_support.assert_true(to_regprocedure('public.reverse_manual_transfer_payment(uuid,text)') is null and to_regprocedure('public.reverse_shipping_fee_payment(uuid,text)') is null, 'obsolete two-argument reversal overloads must be removed');
select test_support.assert_true(has_function_privilege('authenticated', 'public.reverse_manual_transfer_payment(text,uuid,uuid,bigint,integer,text,text)', 'execute') and has_function_privilege('authenticated', 'public.reverse_shipping_fee_payment(text,uuid,uuid,bigint,integer,text,text)', 'execute'), 'authenticated must retain only the target-bound contract');
