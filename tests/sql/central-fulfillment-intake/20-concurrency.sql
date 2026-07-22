-- Hold the ready transition open in one real backend while a second backend
-- attempts a payment reversal against the same order item.
\set concurrency_conninfo 'host=127.0.0.1 port=' :test_port ' dbname=' :test_database ' user=' :test_user

create or replace function test_support.capture_payment_reversal(
  p_order_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.commerce_order_items
  set payment_status = 'awaiting_payment', paid_at = null
  where id = p_order_item_id;
  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'sqlstate', sqlstate,
      'message', sqlerrm
    );
end;
$$;

create or replace function test_support.wait_for_intake_lock_wait(
  p_application_name text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_deadline timestamptz := clock_timestamp() + interval '5 seconds';
begin
  loop
    exit when exists (
      select 1
      from pg_catalog.pg_stat_activity as activity
      where activity.application_name = p_application_name
        and activity.wait_event_type = 'Lock'
    );
    if clock_timestamp() >= v_deadline then
      raise exception 'timed out waiting for lock wait in %', p_application_name;
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
end;
$$;

insert into public.products (
  id, store_id, title, thumbnail_urls, image_urls
) values (
  '30000000-0000-4000-8000-000000000010',
  '20000000-0000-4000-8000-000000000001',
  'Concurrent reversal item',
  '{}',
  '{}'
);
insert into public.commerce_orders (id, member_id, status) values (
  '40000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000006',
  'paid'
);
insert into public.commerce_order_items (
  id, order_id, product_id, store_id, payment_status, paid_at
) values (
  '50000000-0000-4000-8000-000000000010',
  '40000000-0000-4000-8000-000000000010',
  '30000000-0000-4000-8000-000000000010',
  '20000000-0000-4000-8000-000000000001',
  'paid',
  clock_timestamp()
);

select test_support.assert_true(
  (select works.status = 'preparing'
   from public.store_fulfillment_works as works
   where works.order_id = '40000000-0000-4000-8000-000000000010')
  and
  (select fulfillment.current_stage = 'preparing'
   from public.order_item_fulfillments as fulfillment
   where fulfillment.order_item_id = '50000000-0000-4000-8000-000000000010'),
  'concurrency fixture must start from one paid preparing work'
);

create temporary table intake_concurrency_results (
  scenario text primary key,
  payload jsonb not null
);

select dblink_connect(
  'ready_a',
  :'concurrency_conninfo' || ' application_name=fulfillment_intake_ready_a'
);
select dblink_connect(
  'reversal_b',
  :'concurrency_conninfo' || ' application_name=fulfillment_intake_reversal_b'
);
select dblink_exec('ready_a', 'set role authenticated');
select dblink_exec(
  'ready_a',
  'set app.test_user_id = ''10000000-0000-4000-8000-000000000002'''
);
select dblink_exec('ready_a', 'begin');

-- The RPC returns while its transaction remains open, retaining its canonical
-- order -> work -> projection row locks and its uncommitted ready state.
select payload
from dblink('ready_a', $$
  select public.advance_store_fulfillment_work(
    works.id,
    works.version,
    'mark_ready',
    '75000000-0000-4000-8000-000000000001',
    'concurrent ready transition'
  )
  from public.store_fulfillment_works as works
  where works.order_id = '40000000-0000-4000-8000-000000000010'
$$) as result(payload jsonb);

select dblink_send_query('reversal_b', $$
  select test_support.capture_payment_reversal(
    '50000000-0000-4000-8000-000000000010'
  ) as payload
$$);
select test_support.wait_for_intake_lock_wait(
  'fulfillment_intake_reversal_b'
);
select dblink_exec('ready_a', 'commit');

insert into intake_concurrency_results (scenario, payload)
select 'ready-versus-payment-reversal', payload
from dblink_get_result('reversal_b') as result(payload jsonb);
select dblink_disconnect('ready_a');
select dblink_disconnect('reversal_b');

select test_support.assert_true(
  (select not (payload ->> 'ok')::boolean
     and payload ->> 'sqlstate' = '55000'
   from intake_concurrency_results
   where scenario = 'ready-versus-payment-reversal'),
  'payment reversal must wait for ready commit and then fail with SQLSTATE 55000'
);
select test_support.assert_true(
  (select payment_status = 'paid'
   from public.commerce_order_items
   where id = '50000000-0000-4000-8000-000000000010')
  and
  (select current_stage = 'ready_for_transfer'
   from public.order_item_fulfillments
   where order_item_id = '50000000-0000-4000-8000-000000000010')
  and
  (select status = 'ready_for_transfer'
   from public.store_fulfillment_works
   where order_id = '40000000-0000-4000-8000-000000000010'),
  'failed concurrent reversal must preserve paid and ready-for-transfer state'
);
select test_support.assert_true(
  not exists (
    select 1
    from public.fulfillment_events
    where order_item_id = '50000000-0000-4000-8000-000000000010'
      and event_type = 'payment_reversed'
  ),
  'failed concurrent reversal must append no payment-reversed audit event'
);
