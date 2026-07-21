-- This fixture verifies visibility across a concurrent committed writer. The
-- static contract test separately pins the queue implementation to one SQL
-- statement; repeatable-read alone must not be reported as proving that shape.
truncate table public.manual_transfer_payment_ledger, public.commerce_order_transfers;

set app.test_user_id = '00000000-0000-0000-0000-000000000901';
set app.test_is_staff = 'true';

insert into public.commerce_order_transfers values (
  '00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000130',
  '00000000-0000-0000-0000-000000000902',
  100,
  'TEST BANK',
  '000-TEST',
  'awaiting_transfer',
  '2026-07-22 05:00:00+00',
  null,
  null
);

select dblink_connect(
  'queue_writer',
  format('host=127.0.0.1 port=%s dbname=postgres user=postgres', :'test_port')
);

begin isolation level repeatable read;

do $$
declare
  v_payload jsonb;
begin
  v_payload := public.get_shared_commerce_payment_queue_page();
  perform test_support.assert_true(
    v_payload #>> '{active,0,id}' = '00000000-0000-0000-0000-000000000030'
      and jsonb_array_length(v_payload -> 'history') = 0,
    'the first repeatable-read snapshot must see the active transfer once'
  );
end;
$$;

select dblink_exec(
  'queue_writer',
  $writer$
    insert into public.manual_transfer_payment_ledger values (
      '00000000-0000-0000-0000-000000003001',
      'commerce',
      '00000000-0000-0000-0000-000000000030',
      'receipt',
      100,
      '동시 입금자',
      '',
      null,
      '00000000-0000-0000-0000-000000000901',
      '2026-07-22 05:01:00+00'
    );
    update public.commerce_order_transfers
    set status = 'confirmed',
        confirmed_at = '2026-07-22 05:01:00+00',
        confirmed_by = '00000000-0000-0000-0000-000000000901'
    where id = '00000000-0000-0000-0000-000000000030';
  $writer$
);

do $$
declare
  v_payload jsonb;
begin
  v_payload := public.get_shared_commerce_payment_queue_page();
  perform test_support.assert_true(
    v_payload #>> '{active,0,id}' = '00000000-0000-0000-0000-000000000030'
      and jsonb_array_length(v_payload -> 'history') = 0,
    'the same repeatable-read transaction must retain its original queue snapshot'
  );
end;
$$;

commit;

do $$
declare
  v_payload jsonb;
begin
  v_payload := public.get_shared_commerce_payment_queue_page();
  perform test_support.assert_true(
    jsonb_array_length(v_payload -> 'active') = 0
      and v_payload #>> '{history,0,id}' = '00000000-0000-0000-0000-000000000030',
    'a new transaction must see the transfer once in completed history only'
  );
end;
$$;

select dblink_disconnect('queue_writer');
