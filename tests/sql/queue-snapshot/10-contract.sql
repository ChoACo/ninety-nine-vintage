select test_support.assert_true(
  has_function_privilege(
    'authenticated',
    'public.get_shared_commerce_payment_queue_page(integer,timestamp with time zone,uuid,boolean)',
    'EXECUTE'
  ),
  'authenticated must be able to enter the staff-checked queue RPC'
);
select test_support.assert_true(
  not has_function_privilege(
    'anon',
    'public.get_shared_commerce_payment_queue_page(integer,timestamp with time zone,uuid,boolean)',
    'EXECUTE'
  ),
  'anon must not execute the queue RPC'
);
select test_support.assert_true(
  not has_function_privilege(
    'service_role',
    'public.get_shared_commerce_payment_queue_page(integer,timestamp with time zone,uuid,boolean)',
    'EXECUTE'
  ),
  'service_role must not bypass the authenticated staff boundary'
);

set role authenticated;
set app.test_user_id = '00000000-0000-0000-0000-000000000900';
set app.test_is_staff = 'false';
do $$
begin
  begin
    perform public.get_shared_commerce_payment_queue_page();
    raise exception 'non-staff queue execution unexpectedly succeeded';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;
reset role;

set app.test_user_id = '00000000-0000-0000-0000-000000000901';
set app.test_is_staff = 'true';

insert into public.commerce_order_transfers (
  id,
  order_id,
  member_id,
  expected_amount,
  bank_name_snapshot,
  account_number_snapshot,
  status,
  requested_at
)
select
  gen_random_uuid(),
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000902',
  1000,
  'TEST BANK',
  '000-TEST',
  case when sequence_number % 2 = 0 then 'awaiting_transfer' else 'partially_paid' end,
  timestamptz '2026-07-22 00:00:00+00' + sequence_number * interval '1 second'
from generate_series(1, 400) as sequence_number;

insert into public.manual_transfer_payment_ledger (
  id,
  transfer_kind,
  commerce_order_transfer_id,
  entry_type,
  amount,
  depositor_name,
  memo,
  reversal_of,
  recorded_by,
  created_at
)
select
  gen_random_uuid(),
  'commerce',
  transfers.id,
  'receipt',
  1,
  '부분 입금자',
  '',
  null,
  '00000000-0000-0000-0000-000000000901',
  transfers.requested_at + interval '1 millisecond'
from public.commerce_order_transfers as transfers
where transfers.status = 'partially_paid';

do $$
declare
  v_payload jsonb;
begin
  v_payload := public.get_shared_commerce_payment_queue_page();
  perform test_support.assert_true(
    (v_payload ->> 'active_count')::integer = 400,
    'exactly 400 active transfers must be returned'
  );
  perform test_support.assert_true(
    not (v_payload ->> 'active_overflow')::boolean,
    '400 active transfers must not trip overflow'
  );
  perform test_support.assert_true(
    jsonb_array_length(v_payload -> 'active') = 400,
    'the full 400-row active queue must be visible'
  );
  perform test_support.assert_true(
    not (v_payload ->> 'integrity_error')::boolean,
    'valid active fixtures must pass the status-balance contract'
  );
end;
$$;

insert into public.commerce_order_transfers values (
  '00000000-0000-0000-0000-000000000999',
  '00000000-0000-0000-0000-000000001999',
  '00000000-0000-0000-0000-000000000902',
  1000,
  'TEST BANK',
  '000-TEST',
  'awaiting_transfer',
  '2026-07-22 02:00:00+00',
  null,
  null
);

do $$
declare
  v_payload jsonb;
begin
  v_payload := public.get_shared_commerce_payment_queue_page();
  perform test_support.assert_true(
    (v_payload ->> 'active_count')::integer = 401
      and (v_payload ->> 'active_overflow')::boolean,
    'the 401st active transfer must trip the fail-closed sentinel'
  );
  perform test_support.assert_true(
    jsonb_array_length(v_payload -> 'active') = 0
      and jsonb_array_length(v_payload -> 'history') = 0
      and v_payload -> 'next_history_cursor' = 'null'::jsonb,
    'overflow must never expose a partial actionable queue or cursor'
  );
end;
$$;

truncate table public.manual_transfer_payment_ledger, public.commerce_order_transfers;

insert into public.commerce_order_transfers values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000902', 100, 'TEST BANK', '000-TEST', 'confirmed', '2026-07-22 03:00:00+00', null, null),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000902', 100, 'TEST BANK', '000-TEST', 'confirmed', '2026-07-22 03:00:00+00', '2026-07-22 03:05:00+00', '00000000-0000-0000-0000-000000000901'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000902', 100, 'TEST BANK', '000-TEST', 'confirmed', '2026-07-22 03:00:00+00', '2026-07-22 03:05:00+00', '00000000-0000-0000-0000-000000000901');

insert into public.manual_transfer_payment_ledger values
  ('00000000-0000-0000-0000-000000001001', 'commerce', '00000000-0000-0000-0000-000000000001', 'receipt', 100, '입금자', '', null, '00000000-0000-0000-0000-000000000901', '2026-07-22 03:05:00+00'),
  ('00000000-0000-0000-0000-000000001002', 'commerce', '00000000-0000-0000-0000-000000000002', 'receipt', 100, '입금자', '', null, '00000000-0000-0000-0000-000000000901', '2026-07-22 03:05:00+00'),
  ('00000000-0000-0000-0000-000000001003', 'commerce', '00000000-0000-0000-0000-000000000003', 'receipt', 100, '입금자', '', null, '00000000-0000-0000-0000-000000000901', '2026-07-22 03:05:00+00');

do $$
declare
  v_first jsonb;
  v_second jsonb;
  v_cursor_time timestamptz;
  v_cursor_id uuid;
begin
  v_first := public.get_shared_commerce_payment_queue_page(2);
  perform test_support.assert_true(
    v_first #>> '{history,0,id}' = '00000000-0000-0000-0000-000000000003'
      and v_first #>> '{history,1,id}' = '00000000-0000-0000-0000-000000000002',
    'same-time history must use descending UUID order'
  );
  perform test_support.assert_true(
    (v_first ->> 'history_has_more')::boolean,
    'the third same-time row must be retained only as lookahead'
  );
  v_cursor_time := (v_first #>> '{next_history_cursor,activity_at}')::timestamptz;
  v_cursor_id := (v_first #>> '{next_history_cursor,transfer_id}')::uuid;
  perform test_support.assert_true(
    v_cursor_id = '00000000-0000-0000-0000-000000000002',
    'the next cursor must be the last visible row'
  );

  v_second := public.get_shared_commerce_payment_queue_page(
    2,
    v_cursor_time,
    v_cursor_id,
    false
  );
  perform test_support.assert_true(
    jsonb_array_length(v_second -> 'history') = 1
      and v_second #>> '{history,0,id}' = '00000000-0000-0000-0000-000000000001'
      and not (v_second ->> 'history_has_more')::boolean,
    'the next keyset page must contain the remaining UUID without overlap'
  );
end;
$$;

insert into public.commerce_order_transfers values (
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000120',
  '00000000-0000-0000-0000-000000000902',
  100,
  'TEST BANK',
  '000-TEST',
  'awaiting_transfer',
  '2026-07-22 04:00:00+00',
  null,
  null
);
insert into public.manual_transfer_payment_ledger values
  ('00000000-0000-0000-0000-000000002001', 'commerce', '00000000-0000-0000-0000-000000000020', 'receipt', 50, '입금자', '', null, '00000000-0000-0000-0000-000000000901', '2026-07-22 04:02:00+00'),
  ('00000000-0000-0000-0000-000000002002', 'commerce', '00000000-0000-0000-0000-000000000020', 'reversal', 50, null, '정정', '00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000901', '2026-07-22 04:02:00+00');

do $$
declare
  v_payload jsonb;
  v_transfer jsonb;
begin
  v_payload := public.get_shared_commerce_payment_queue_page();
  select value into v_transfer
  from jsonb_array_elements(v_payload -> 'active')
  where value ->> 'id' = '00000000-0000-0000-0000-000000000020';
  perform test_support.assert_true(
    (v_transfer ->> 'received_amount')::bigint = 0
      and (v_transfer ->> 'ledger_entry_count')::bigint = 2,
    'receipt and reversal must produce a zero signed balance and version two'
  );
  perform test_support.assert_true(
    v_transfer #>> '{ledger,0,id}' = '00000000-0000-0000-0000-000000002002',
    'recent ledger rows must use created_at and UUID descending order'
  );
end;
$$;

insert into public.commerce_order_transfers values (
  '00000000-0000-0000-0000-000000000021',
  '00000000-0000-0000-0000-000000000121',
  '00000000-0000-0000-0000-000000000902',
  100,
  'TEST BANK',
  '000-TEST',
  'awaiting_transfer',
  '2026-07-22 04:10:00+00',
  null,
  null
);
insert into public.manual_transfer_payment_ledger values (
  '00000000-0000-0000-0000-000000002101',
  'commerce',
  '00000000-0000-0000-0000-000000000021',
  'receipt',
  1,
  '불일치 입금자',
  '',
  null,
  '00000000-0000-0000-0000-000000000901',
  '2026-07-22 04:11:00+00'
);

do $$
declare
  v_payload jsonb;
begin
  v_payload := public.get_shared_commerce_payment_queue_page();
  perform test_support.assert_true(
    (v_payload ->> 'integrity_error')::boolean,
    'a status-balance mismatch must trip the integrity sentinel'
  );
  perform test_support.assert_true(
    jsonb_array_length(v_payload -> 'active') = 0
      and jsonb_array_length(v_payload -> 'history') = 0
      and v_payload -> 'next_history_cursor' = 'null'::jsonb,
    'an integrity error must hide every actionable row and cursor'
  );
end;
$$;

delete from public.manual_transfer_payment_ledger
where commerce_order_transfer_id = '00000000-0000-0000-0000-000000000021';
delete from public.commerce_order_transfers
where id = '00000000-0000-0000-0000-000000000021';

do $$
begin
  begin
    perform public.get_shared_commerce_payment_queue_page(
      100,
      '2026-07-22 00:00:00+00',
      null,
      false
    );
    raise exception 'one-sided cursor unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;
  begin
    perform public.get_shared_commerce_payment_queue_page(0);
    raise exception 'zero history limit unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;
  begin
    perform public.get_shared_commerce_payment_queue_page(
      100,
      'infinity'::timestamptz,
      '00000000-0000-0000-0000-000000000001',
      false
    );
    raise exception 'infinite cursor unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;
