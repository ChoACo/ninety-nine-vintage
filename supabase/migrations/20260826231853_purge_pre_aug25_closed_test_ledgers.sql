-- One-off, bounded purge of pre-launch closed test products and every
-- transaction row that depends on them. Scheduled/pending products and all
-- products created from 2026-08-25 KST onward are hard-protected.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

select pg_advisory_xact_lock(hashtextextended('ninety-nine:pre-aug25-closed-test-purge', 0));

create temporary table purge_lock_relations (
  relid oid primary key
) on commit drop;

insert into purge_lock_relations(relid)
select relation::regclass::oid
from unnest(array[
  'public.products',
  'public.commerce_orders',
  'public.inventory_shipments',
  'public.commerce_shipments',
  'public.shipping_requests',
  'public.auction_payment_confirmation_requests',
  'public.owner_forced_payment_confirmations',
  'public.cancelled_auction_bids',
  'public.store_settlement_entries',
  'public.security_activity_logs',
  'public.inventory_command_receipts',
  'public.fulfillment_command_receipts',
  'public.inventory_delivery_history',
  'public.member_accounts'
]::text[]) as roots(relation);

with recursive descendants(relid, path) as (
  select relid, array[relid]::oid[] from purge_lock_relations
  union all
  select constraints.conrelid, descendants.path || constraints.conrelid
  from descendants
  join pg_constraint as constraints
    on constraints.contype = 'f'
   and constraints.confrelid = descendants.relid
  where not constraints.conrelid = any(descendants.path)
)
insert into purge_lock_relations(relid)
select distinct relid from descendants
on conflict do nothing;

do $$
declare
  relation record;
begin
  for relation in
    select relid::regclass as relation_name
    from purge_lock_relations
    order by relid::regclass::text
  loop
    execute format('lock table %s in share row exclusive mode', relation.relation_name);
  end loop;
end;
$$;

create temporary table purge_guard (
  target_product_count bigint not null,
  protected_pending_count bigint not null,
  protected_newer_count bigint not null
) on commit drop;

insert into purge_guard
select
  count(*) filter (
    where status = 'closed'
      and created_at < timestamptz '2026-08-25 00:00:00+09'
  ),
  count(*) filter (
    where status = 'pending'
      and created_at < timestamptz '2026-08-25 00:00:00+09'
  ),
  count(*) filter (
    where created_at >= timestamptz '2026-08-25 00:00:00+09'
  )
from public.products;

do $$
begin
  if (select target_product_count from purge_guard) <> 25 then
    raise exception using
      errcode = '55000',
      message = '삭제 대상 마감 상품 수가 사전 검증값 25개와 다릅니다.';
  end if;

  if exists (
    with targets as (
      select id from public.products
      where status = 'closed'
        and created_at < timestamptz '2026-08-25 00:00:00+09'
    ), target_orders as (
      select distinct order_id from public.commerce_order_items
      where product_id in (select id from targets)
    )
    select 1 from public.commerce_order_items
    where order_id in (select order_id from target_orders)
      and product_id not in (select id from targets)
  ) or exists (
    with targets as (
      select id from public.products
      where status = 'closed'
        and created_at < timestamptz '2026-08-25 00:00:00+09'
    ), target_shipments as (
      select distinct shipment_id from public.inventory_shipment_items
      where product_id in (select id from targets)
    )
    select 1 from public.inventory_shipment_items
    where shipment_id in (select shipment_id from target_shipments)
      and product_id not in (select id from targets)
  ) or exists (
    with targets as (
      select id from public.products
      where status = 'closed'
        and created_at < timestamptz '2026-08-25 00:00:00+09'
    ), target_shipments as (
      select distinct shipment_id from public.commerce_shipment_items
      where product_id in (select id from targets)
    )
    select 1 from public.commerce_shipment_items
    where shipment_id in (select shipment_id from target_shipments)
      and product_id not in (select id from targets)
  ) or exists (
    with targets as (
      select id from public.products
      where status = 'closed'
        and created_at < timestamptz '2026-08-25 00:00:00+09'
    ), target_requests as (
      select distinct request_id from public.shipping_request_items
      where product_id in (select id from targets)
    )
    select 1 from public.shipping_request_items
    where request_id in (select request_id from target_requests)
      and product_id not in (select id from targets)
  ) then
    raise exception using
      errcode = '55000',
      message = '삭제 대상과 보호 상품이 같은 주문 또는 배송 묶음에 섞여 있습니다.';
  end if;
end;
$$;

create temporary table purge_rows (
  relid oid not null,
  row_tid tid not null,
  primary key(relid, row_tid)
) on commit drop;

-- Exact product roots. Pending reservations are deliberately excluded.
insert into purge_rows
select 'public.products'::regclass::oid, products.ctid
from public.products as products
where products.status = 'closed'
  and products.created_at < timestamptz '2026-08-25 00:00:00+09';

-- Select the owning transaction containers only when they contain a target
-- product. The mixed-container guard above prevents collateral deletion.
insert into purge_rows
select distinct 'public.commerce_orders'::regclass::oid, orders.ctid
from public.commerce_orders as orders
join public.commerce_order_items as items on items.order_id = orders.id
join public.products as products on products.id = items.product_id
where products.status = 'closed'
  and products.created_at < timestamptz '2026-08-25 00:00:00+09'
on conflict do nothing;

insert into purge_rows
select distinct 'public.inventory_shipments'::regclass::oid, shipments.ctid
from public.inventory_shipments as shipments
join public.inventory_shipment_items as items on items.shipment_id = shipments.id
join public.products as products on products.id = items.product_id
where products.status = 'closed'
  and products.created_at < timestamptz '2026-08-25 00:00:00+09'
on conflict do nothing;

insert into purge_rows
select distinct 'public.commerce_shipments'::regclass::oid, shipments.ctid
from public.commerce_shipments as shipments
join public.commerce_shipment_items as items on items.shipment_id = shipments.id
join public.products as products on products.id = items.product_id
where products.status = 'closed'
  and products.created_at < timestamptz '2026-08-25 00:00:00+09'
on conflict do nothing;

insert into purge_rows
select distinct 'public.shipping_requests'::regclass::oid, requests.ctid
from public.shipping_requests as requests
join public.shipping_request_items as items on items.request_id = requests.id
join public.products as products on products.id = items.product_id
where products.status = 'closed'
  and products.created_at < timestamptz '2026-08-25 00:00:00+09'
on conflict do nothing;

-- Repeatedly add every FK child of an already-selected row. This follows the
-- live database constraints instead of relying on a stale hand-written list.
do $$
declare
  foreign_key record;
  matcher text;
  inserted_count integer;
  round_count integer := 0;
  round_inserted integer;
begin
  loop
    round_count := round_count + 1;
    round_inserted := 0;

    for foreign_key in
      select constraints.oid, constraints.conrelid, constraints.confrelid,
             constraints.conkey, constraints.confkey,
             constraints.conrelid::regclass as child_table,
             constraints.confrelid::regclass as parent_table
      from pg_constraint as constraints
      where constraints.contype = 'f'
        and exists (select 1 from purge_rows where relid = constraints.confrelid)
      order by constraints.confrelid::regclass::text,
               constraints.conrelid::regclass::text,
               constraints.conname
    loop
      select string_agg(
        format('child.%I is not distinct from parent.%I', child_attr.attname, parent_attr.attname),
        ' and ' order by keys.ordinality
      )
      into matcher
      from unnest(foreign_key.conkey, foreign_key.confkey)
        with ordinality as keys(child_attnum, parent_attnum, ordinality)
      join pg_attribute as child_attr
        on child_attr.attrelid = foreign_key.conrelid
       and child_attr.attnum = keys.child_attnum
      join pg_attribute as parent_attr
        on parent_attr.attrelid = foreign_key.confrelid
       and parent_attr.attnum = keys.parent_attnum;

      execute format(
        'insert into purge_rows(relid,row_tid)
         select %s, child.ctid
         from %s as child
         where exists (
           select 1 from %s as parent
           join purge_rows as selected_parent
             on selected_parent.relid = %s
            and selected_parent.row_tid = parent.ctid
           where %s
         )
         on conflict do nothing',
        foreign_key.conrelid,
        foreign_key.child_table,
        foreign_key.parent_table,
        foreign_key.confrelid,
        matcher
      );
      get diagnostics inserted_count = row_count;
      round_inserted := round_inserted + inserted_count;
    end loop;

    exit when round_inserted = 0;
    if round_count > 64 then
      raise exception using errcode = '54001', message = '원장 의존관계 탐색이 허용 깊이를 초과했습니다.';
    end if;
  end loop;
end;
$$;

-- Non-FK polymorphic and array references.
with target_orders as (
  select orders.id
  from public.manual_transfer_orders as orders
  join public.products as products on products.id = orders.product_id
  where products.status = 'closed'
    and products.created_at < timestamptz '2026-08-25 00:00:00+09'
)
insert into purge_rows
select 'public.auction_payment_confirmation_requests'::regclass::oid, requests.ctid
from public.auction_payment_confirmation_requests as requests
where requests.order_ids && array(select id from target_orders)
on conflict do nothing;

with target_orders as (
  select orders.id
  from public.manual_transfer_orders as orders
  join public.products as products on products.id = orders.product_id
  where products.status = 'closed'
    and products.created_at < timestamptz '2026-08-25 00:00:00+09'
)
insert into purge_rows
select 'public.owner_forced_payment_confirmations'::regclass::oid, confirmations.ctid
from public.owner_forced_payment_confirmations as confirmations
where confirmations.order_ids && array(select id from target_orders)
on conflict do nothing;

insert into purge_rows
select 'public.cancelled_auction_bids'::regclass::oid, bids.ctid
from public.cancelled_auction_bids as bids
join public.products as products on products.id = bids.product_id
where products.status = 'closed'
  and products.created_at < timestamptz '2026-08-25 00:00:00+09'
on conflict do nothing;

with entity_ids(id) as (
  select products.id from public.products as products
  where products.status = 'closed'
    and products.created_at < timestamptz '2026-08-25 00:00:00+09'
  union select bids.id from public.auction_bids as bids join public.products as products on products.id=bids.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
  union select offers.id from public.auction_purchase_offers as offers join public.products as products on products.id=offers.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
  union select orders.id from public.manual_transfer_orders as orders join public.products as products on products.id=orders.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
  union select items.id from public.customer_inventory_items as items join public.products as products on products.id=items.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
  union select shipments.id from public.inventory_shipments as shipments join public.inventory_shipment_items as items on items.shipment_id=shipments.id join public.products as products on products.id=items.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
  union select orders.id from public.commerce_orders as orders join public.commerce_order_items as items on items.order_id=orders.id join public.products as products on products.id=items.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
  union select orders.id from public.payment_orders as orders join public.products as products on products.id=orders.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
)
insert into purge_rows
select 'public.security_activity_logs'::regclass::oid, logs.ctid
from public.security_activity_logs as logs
where logs.entity_id in (select id::text from entity_ids)
on conflict do nothing;

with entity_ids(id) as (
  select products.id from public.products as products
  where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
  union select items.id from public.customer_inventory_items as items join public.products as products on products.id=items.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
  union select shipments.id from public.inventory_shipments as shipments join public.inventory_shipment_items as items on items.shipment_id=shipments.id join public.products as products on products.id=items.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
)
insert into purge_rows
select 'public.inventory_command_receipts'::regclass::oid, receipts.ctid
from public.inventory_command_receipts as receipts
where receipts.target_id in (select id from entity_ids)
on conflict do nothing;

with target_shipments as (
  select distinct shipments.id
  from public.inventory_shipments as shipments
  join public.inventory_shipment_items as items on items.shipment_id=shipments.id
  join public.products as products on products.id=items.product_id
  where products.status='closed'
    and products.created_at<timestamptz '2026-08-25 00:00:00+09'
)
insert into purge_rows
select 'public.inventory_delivery_history'::regclass::oid, history.ctid
from public.inventory_delivery_history as history
where history.shipment_id in (select id from target_shipments)
on conflict do nothing;

with source_ids(id) as (
  select products.id from public.products as products
  where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
  union select items.id from public.customer_inventory_items as items join public.products as products on products.id=items.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
  union select shipments.id from public.inventory_shipments as shipments join public.inventory_shipment_items as items on items.shipment_id=shipments.id join public.products as products on products.id=items.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
  union select orders.id from public.manual_transfer_orders as orders join public.products as products on products.id=orders.product_id
    where products.status='closed' and products.created_at<timestamptz '2026-08-25 00:00:00+09'
)
insert into purge_rows
select 'public.store_settlement_entries'::regclass::oid, entries.ctid
from public.store_settlement_entries as entries
where entries.source_id in (select id from source_ids)
on conflict do nothing;

-- Propagate again from array/polymorphic roots.
do $$
declare
  foreign_key record;
  matcher text;
  inserted_count integer;
  round_count integer := 0;
  round_inserted integer;
begin
  loop
    round_count := round_count + 1;
    round_inserted := 0;
    for foreign_key in
      select constraints.conrelid, constraints.confrelid, constraints.conkey, constraints.confkey,
             constraints.conrelid::regclass as child_table,
             constraints.confrelid::regclass as parent_table
      from pg_constraint as constraints
      where constraints.contype='f'
        and exists(select 1 from purge_rows where relid=constraints.confrelid)
      order by constraints.confrelid::regclass::text, constraints.conrelid::regclass::text, constraints.conname
    loop
      select string_agg(format('child.%I is not distinct from parent.%I',ca.attname,pa.attname),' and ' order by keys.ordinality)
      into matcher
      from unnest(foreign_key.conkey,foreign_key.confkey) with ordinality as keys(ca_num,pa_num,ordinality)
      join pg_attribute ca on ca.attrelid=foreign_key.conrelid and ca.attnum=keys.ca_num
      join pg_attribute pa on pa.attrelid=foreign_key.confrelid and pa.attnum=keys.pa_num;
      execute format(
        'insert into purge_rows(relid,row_tid) select %s,child.ctid from %s child where exists(select 1 from %s parent join purge_rows selected_parent on selected_parent.relid=%s and selected_parent.row_tid=parent.ctid where %s) on conflict do nothing',
        foreign_key.conrelid,foreign_key.child_table,foreign_key.parent_table,foreign_key.confrelid,matcher
      );
      get diagnostics inserted_count=row_count;
      round_inserted:=round_inserted+inserted_count;
    end loop;
    exit when round_inserted=0;
    if round_count>64 then raise exception using errcode='54001',message='추가 원장 의존관계 탐색이 허용 깊이를 초과했습니다.'; end if;
  end loop;
end;
$$;

-- Fail closed if graph traversal ever reaches a protected product.
do $$
begin
  if exists (
    select 1
    from public.products as products
    join purge_rows as selected
      on selected.relid='public.products'::regclass::oid
     and selected.row_tid=products.ctid
    where products.status<>'closed'
       or products.created_at>=timestamptz '2026-08-25 00:00:00+09'
  ) then
    raise exception using errcode='55000',message='보호 상품이 삭제 그래프에 포함되어 작업을 중단합니다.';
  end if;

  if exists (
    select 1 from public.store_settlement_entries entries
    join purge_rows selected on selected.relid='public.store_settlement_entries'::regclass::oid and selected.row_tid=entries.ctid
    where entries.settlement_batch_id is not null
  ) then
    raise exception using errcode='55000',message='확정 정산 배치에 포함된 원장이 있어 작업을 중단합니다.';
  end if;
end;
$$;

create temporary table purge_credit_changes (
  member_id uuid primary key,
  net_delta integer not null
) on commit drop;

insert into purge_credit_changes(member_id,net_delta)
select credits.member_id,sum(credits.delta)::integer
from public.shipping_credit_ledger as credits
join purge_rows as selected
  on selected.relid='public.shipping_credit_ledger'::regclass::oid
 and selected.row_tid=credits.ctid
group by credits.member_id;

do $$
begin
  if exists (
    select 1 from purge_credit_changes changes
    join public.member_accounts accounts on accounts.member_id=changes.member_id
    where accounts.shipping_credit_count-changes.net_delta not between 0 and 10000
  ) then
    raise exception using errcode='22003',message='배송 크레딧 역산 결과가 허용 범위를 벗어납니다.';
  end if;
end;
$$;

update public.member_accounts as accounts
set shipping_credit_count=accounts.shipping_credit_count-changes.net_delta
from purge_credit_changes as changes
where accounts.member_id=changes.member_id;

do $$
declare
  counts jsonb;
begin
  select jsonb_object_agg(table_name,row_count order by table_name)
  into counts
  from (
    select relid::regclass::text table_name,count(*) row_count
    from purge_rows group by relid
  ) summary;
  raise notice 'pre_aug25_closed_test_purge_counts=%',counts;
end;
$$;

-- The selected graph is complete and locked. Replica mode bypasses only the
-- circular FK and append-only triggers for this one transaction.
set local session_replication_role = replica;

do $$
declare
  relation record;
begin
  for relation in
    select relid,relid::regclass as relation_name
    from purge_rows group by relid
    order by relid::regclass::text desc
  loop
    execute format(
      'delete from %s as target using purge_rows selected where selected.relid=%s and selected.row_tid=target.ctid',
      relation.relation_name,relation.relid
    );
  end loop;
end;
$$;

set local session_replication_role = origin;

-- Post-delete invariants.
do $$
declare
  foreign_key record;
  matcher text;
  child_not_null text;
  orphan_count bigint;
begin
  if exists (
    select 1 from public.products
    where status='closed' and created_at<timestamptz '2026-08-25 00:00:00+09'
  ) then
    raise exception using errcode='55000',message='대상 마감 상품이 삭제 후에도 남아 있습니다.';
  end if;

  if (select count(*) from public.products where status='pending' and created_at<timestamptz '2026-08-25 00:00:00+09')
     <> (select protected_pending_count from purge_guard)
     or (select count(*) from public.products where created_at>=timestamptz '2026-08-25 00:00:00+09')
     <> (select protected_newer_count from purge_guard)
  then
    raise exception using errcode='55000',message='예약 대기 또는 8월 25일 이후 보호 상품 수가 변경되었습니다.';
  end if;

  for foreign_key in
    select constraints.conrelid,constraints.confrelid,constraints.conkey,constraints.confkey,
           constraints.conrelid::regclass child_table,constraints.confrelid::regclass parent_table,
           constraints.conname
    from pg_constraint constraints
    where constraints.contype='f' and constraints.convalidated
      and (constraints.conrelid in(select relid from purge_rows)
        or constraints.confrelid in(select relid from purge_rows))
  loop
    select
      string_agg(format('child.%I is not distinct from parent.%I',ca.attname,pa.attname),' and ' order by keys.ordinality),
      string_agg(format('child.%I is not null',ca.attname),' and ' order by keys.ordinality)
    into matcher,child_not_null
    from unnest(foreign_key.conkey,foreign_key.confkey) with ordinality as keys(ca_num,pa_num,ordinality)
    join pg_attribute ca on ca.attrelid=foreign_key.conrelid and ca.attnum=keys.ca_num
    join pg_attribute pa on pa.attrelid=foreign_key.confrelid and pa.attnum=keys.pa_num;
    execute format('select count(*) from %s child where %s and not exists(select 1 from %s parent where %s)',foreign_key.child_table,child_not_null,foreign_key.parent_table,matcher)
      into orphan_count;
    if orphan_count<>0 then
      raise exception using errcode='23503',message=format('삭제 후 외래키 고아 행 발견: %s (%s)',foreign_key.conname,orphan_count);
    end if;
  end loop;
end;
$$;

commit;
