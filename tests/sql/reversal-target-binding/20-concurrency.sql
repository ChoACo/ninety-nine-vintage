-- Run true concurrent sessions against the same disposable cluster. Every
-- worker returns a JSON envelope so an expected SQLSTATE does not abort psql.
\set concurrency_conninfo 'host=127.0.0.1 port=' :test_port ' dbname=' :test_database ' user=' :test_user ' password=' :test_password

create or replace function test_support.capture_manual_reversal(
  p_kind text,
  p_target_id uuid,
  p_ledger_id uuid,
  p_expected_received bigint,
  p_expected_count integer,
  p_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.reverse_manual_transfer_payment(
    p_kind,
    p_target_id,
    p_ledger_id,
    p_expected_received,
    p_expected_count,
    p_key,
    p_reason
  );
  return jsonb_build_object('ok', true, 'result', v_result);
exception when others then
  return jsonb_build_object('ok', false, 'sqlstate', sqlstate, 'message', sqlerrm);
end;
$$;

create or replace function test_support.wait_for_lock_waits(
  p_application_names text[],
  p_expected integer
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_deadline timestamptz := clock_timestamp() + interval '5 seconds';
  v_waiting integer;
begin
  loop
    select count(*)::integer
    into v_waiting
    from pg_catalog.pg_stat_activity as activity
    where activity.application_name = any(p_application_names)
      and activity.wait_event_type = 'Lock';
    exit when v_waiting >= p_expected;
    if clock_timestamp() >= v_deadline then
      raise exception 'timed out waiting for % workers; observed %', p_expected, v_waiting;
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
end;
$$;

create temporary table reversal_concurrency_results (
  scenario text not null,
  worker text not null,
  payload jsonb not null
);

-- Two copies of one actor/key must overlap, then resolve to one append and one
-- replay carrying the exact same reversal ledger id.
insert into public.commerce_orders (id, member_id, status) values
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000003', 'paid');
insert into public.commerce_order_transfers (id, order_id, expected_amount, status) values
  ('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000701', 100, 'confirmed');
insert into public.products values
  ('00000000-0000-4000-8000-000000000704', '00000000-0000-4000-8000-000000000010');
insert into public.commerce_order_items (order_id, product_id) values
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000704');
insert into public.manual_transfer_payment_ledger (
  id, transfer_kind, commerce_order_transfer_id, entry_type, amount, memo,
  recorded_by, idempotency_key
) values (
  '00000000-0000-4000-8000-000000000703', 'commerce',
  '00000000-0000-4000-8000-000000000702', 'receipt', 100, '',
  '00000000-0000-4000-8000-000000000002',
  'legacy:00000000-0000-4000-8000-000000000703'
);

select dblink_connect('same_a', :'concurrency_conninfo' || ' application_name=reversal_same_a');
select dblink_connect('same_b', :'concurrency_conninfo' || ' application_name=reversal_same_b');
select dblink_exec('same_a', 'set app.test_user_id = ''00000000-0000-4000-8000-000000000002''');
select dblink_exec('same_a', 'set app.test_is_staff = ''true''');
select dblink_exec('same_a', 'set app.test_is_owner = ''false''');
select dblink_exec('same_b', 'set app.test_user_id = ''00000000-0000-4000-8000-000000000002''');
select dblink_exec('same_b', 'set app.test_is_staff = ''true''');
select dblink_exec('same_b', 'set app.test_is_owner = ''false''');

begin;
select id from public.commerce_order_transfers
where id = '00000000-0000-4000-8000-000000000702'
for update;
select dblink_send_query('same_a', $$
  select test_support.capture_manual_reversal(
    'commerce',
    '00000000-0000-4000-8000-000000000702',
    '00000000-0000-4000-8000-000000000703',
    100,
    1,
    '20000000-0000-4000-8000-000000000001',
    'concurrent retry'
  ) as payload
$$);
select dblink_send_query('same_b', $$
  select test_support.capture_manual_reversal(
    'commerce',
    '00000000-0000-4000-8000-000000000702',
    '00000000-0000-4000-8000-000000000703',
    100,
    1,
    '20000000-0000-4000-8000-000000000001',
    'concurrent retry'
  ) as payload
$$);
select test_support.wait_for_lock_waits(
  array['reversal_same_a', 'reversal_same_b'],
  2
);
commit;

insert into reversal_concurrency_results
select 'same-key', 'a', payload from dblink_get_result('same_a') as result(payload jsonb);
insert into reversal_concurrency_results
select 'same-key', 'b', payload from dblink_get_result('same_b') as result(payload jsonb);
select dblink_disconnect('same_a');
select dblink_disconnect('same_b');

select test_support.assert_true(
  (select count(*) = 2 from reversal_concurrency_results
   where scenario = 'same-key' and (payload ->> 'ok')::boolean),
  'both concurrent copies of one actor/key must return a successful envelope'
);
select test_support.assert_true(
  (select count(*) = 1 from reversal_concurrency_results
   where scenario = 'same-key'
     and (payload #>> '{result,idempotent_replay}')::boolean)
  and
  (select count(*) = 1 from reversal_concurrency_results
   where scenario = 'same-key'
     and not (payload #>> '{result,idempotent_replay}')::boolean),
  'one concurrent copy must append and the other must replay'
);
select test_support.assert_true(
  (select count(distinct payload #>> '{result,ledger_id}') = 1
   from reversal_concurrency_results where scenario = 'same-key')
  and
  (select count(*) = 1 from public.manual_transfer_payment_ledger
   where reversal_of = '00000000-0000-4000-8000-000000000703'),
  'same actor/key concurrency must return and persist exactly one reversal id'
);

-- Different actors and keys still serialize on the canonical parent. Exactly
-- one can reverse the receipt; the loser must observe the committed reversal.
insert into public.commerce_orders (id, member_id, status) values
  ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000003', 'paid');
insert into public.commerce_order_transfers (id, order_id, expected_amount, status) values
  ('00000000-0000-4000-8000-000000000712', '00000000-0000-4000-8000-000000000711', 100, 'confirmed');
insert into public.products values
  ('00000000-0000-4000-8000-000000000714', '00000000-0000-4000-8000-000000000010');
insert into public.commerce_order_items (order_id, product_id) values
  ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000714');
insert into public.manual_transfer_payment_ledger (
  id, transfer_kind, commerce_order_transfer_id, entry_type, amount, memo,
  recorded_by, idempotency_key
) values (
  '00000000-0000-4000-8000-000000000713', 'commerce',
  '00000000-0000-4000-8000-000000000712', 'receipt', 100, '',
  '00000000-0000-4000-8000-000000000002',
  'legacy:00000000-0000-4000-8000-000000000713'
);

select dblink_connect('race_a', :'concurrency_conninfo' || ' application_name=reversal_race_a');
select dblink_connect('race_b', :'concurrency_conninfo' || ' application_name=reversal_race_b');
select dblink_exec('race_a', 'set app.test_user_id = ''00000000-0000-4000-8000-000000000002''');
select dblink_exec('race_a', 'set app.test_is_staff = ''true''');
select dblink_exec('race_a', 'set app.test_is_owner = ''false''');
select dblink_exec('race_b', 'set app.test_user_id = ''00000000-0000-4000-8000-000000000004''');
select dblink_exec('race_b', 'set app.test_is_staff = ''true''');
select dblink_exec('race_b', 'set app.test_is_owner = ''false''');

begin;
select id from public.commerce_order_transfers
where id = '00000000-0000-4000-8000-000000000712'
for update;
select dblink_send_query('race_a', $$
  select test_support.capture_manual_reversal(
    'commerce',
    '00000000-0000-4000-8000-000000000712',
    '00000000-0000-4000-8000-000000000713',
    100,
    1,
    '20000000-0000-4000-8000-000000000002',
    'actor a correction'
  ) as payload
$$);
select dblink_send_query('race_b', $$
  select test_support.capture_manual_reversal(
    'commerce',
    '00000000-0000-4000-8000-000000000712',
    '00000000-0000-4000-8000-000000000713',
    100,
    1,
    '20000000-0000-4000-8000-000000000003',
    'actor b correction'
  ) as payload
$$);
select test_support.wait_for_lock_waits(
  array['reversal_race_a', 'reversal_race_b'],
  2
);
commit;

insert into reversal_concurrency_results
select 'different-key', 'a', payload from dblink_get_result('race_a') as result(payload jsonb);
insert into reversal_concurrency_results
select 'different-key', 'b', payload from dblink_get_result('race_b') as result(payload jsonb);
select dblink_disconnect('race_a');
select dblink_disconnect('race_b');

select test_support.assert_true(
  (select count(*) = 1 from reversal_concurrency_results
   where scenario = 'different-key' and (payload ->> 'ok')::boolean)
  and
  (select count(*) = 1 from reversal_concurrency_results
   where scenario = 'different-key'
     and not (payload ->> 'ok')::boolean
     and payload ->> 'sqlstate' = '55000')
  and
  (select count(*) = 1 from public.manual_transfer_payment_ledger
   where reversal_of = '00000000-0000-4000-8000-000000000713'),
  'different actors racing one receipt must have one winner and one already-reversed result'
);

-- CAS is evaluated only after the canonical parent lock. A ledger append that
-- commits while the worker waits must therefore produce PT409 with no reversal.
insert into public.commerce_orders (id, member_id, status) values
  ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000003', 'partially_paid');
insert into public.commerce_order_transfers (id, order_id, expected_amount, status) values
  ('00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000721', 200, 'partially_paid');
insert into public.products values
  ('00000000-0000-4000-8000-000000000724', '00000000-0000-4000-8000-000000000010');
insert into public.commerce_order_items (order_id, product_id) values
  ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000724');
insert into public.manual_transfer_payment_ledger (
  id, transfer_kind, commerce_order_transfer_id, entry_type, amount, memo,
  recorded_by, idempotency_key
) values (
  '00000000-0000-4000-8000-000000000723', 'commerce',
  '00000000-0000-4000-8000-000000000722', 'receipt', 100, '',
  '00000000-0000-4000-8000-000000000002',
  'legacy:00000000-0000-4000-8000-000000000723'
);

select dblink_connect('stale_worker', :'concurrency_conninfo' || ' application_name=reversal_stale_worker');
select dblink_exec('stale_worker', 'set app.test_user_id = ''00000000-0000-4000-8000-000000000002''');
select dblink_exec('stale_worker', 'set app.test_is_staff = ''true''');
select dblink_exec('stale_worker', 'set app.test_is_owner = ''false''');

begin;
select id from public.commerce_order_transfers
where id = '00000000-0000-4000-8000-000000000722'
for update;
select dblink_send_query('stale_worker', $$
  select test_support.capture_manual_reversal(
    'commerce',
    '00000000-0000-4000-8000-000000000722',
    '00000000-0000-4000-8000-000000000723',
    100,
    1,
    '20000000-0000-4000-8000-000000000004',
    'stale while waiting'
  ) as payload
$$);
select test_support.wait_for_lock_waits(array['reversal_stale_worker'], 1);
insert into public.manual_transfer_payment_ledger (
  id, transfer_kind, commerce_order_transfer_id, entry_type, amount, memo,
  recorded_by, idempotency_key
) values (
  '00000000-0000-4000-8000-000000000725', 'commerce',
  '00000000-0000-4000-8000-000000000722', 'receipt', 50, 'concurrent append',
  '00000000-0000-4000-8000-000000000004',
  'legacy:00000000-0000-4000-8000-000000000725'
);
commit;

insert into reversal_concurrency_results
select 'stale-cas', 'worker', payload
from dblink_get_result('stale_worker') as result(payload jsonb);
select dblink_disconnect('stale_worker');

select test_support.assert_true(
  (select count(*) = 1 from reversal_concurrency_results
   where scenario = 'stale-cas'
     and not (payload ->> 'ok')::boolean
     and payload ->> 'sqlstate' = 'PT409')
  and
  (select count(*) = 0 from public.manual_transfer_payment_ledger
   where reversal_of = '00000000-0000-4000-8000-000000000723')
  and
  (select count(*) = 2 from public.manual_transfer_payment_ledger
   where commerce_order_transfer_id = '00000000-0000-4000-8000-000000000722'),
  'a parent-lock wait followed by a ledger append must fail stale CAS without reversal'
);
