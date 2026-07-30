begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- This is a bounded production test-data cleanup. The fixed cutoff prevents a
-- later deployment from touching products or withdrawals created afterwards.
create temporary table cleanup_products (
  id uuid primary key
) on commit drop;

insert into cleanup_products (id)
select products.id
from public.products as products
where products.status = 'closed'
  and products.created_at < timestamptz '2026-07-30 13:21:00+09'
  and (
    products.final_bid_id is not null
    or products.sale_completed_at is not null
  );

create temporary table cleanup_withdrawn_members (
  member_id uuid primary key,
  purge_due_at timestamptz not null
) on commit drop;

insert into cleanup_withdrawn_members (member_id, purge_due_at)
select retention.member_id, retention.purge_due_at
from app_private.withdrawn_member_retention as retention
where retention.deleted_at < timestamptz '2026-07-31 00:00:00+09';

create temporary table cleanup_bids (
  id uuid primary key
) on commit drop;
insert into cleanup_bids (id)
select bids.id
from public.auction_bids as bids
join cleanup_products as products on products.id = bids.product_id;

create temporary table cleanup_offers (
  id uuid primary key
) on commit drop;
insert into cleanup_offers (id)
select offers.id
from public.auction_purchase_offers as offers
join cleanup_products as products on products.id = offers.product_id;

create temporary table cleanup_transfer_orders (
  id uuid primary key,
  buyer_id uuid not null
) on commit drop;
insert into cleanup_transfer_orders (id, buyer_id)
select orders.id, orders.buyer_id
from public.manual_transfer_orders as orders
join cleanup_products as products on products.id = orders.product_id;

create temporary table cleanup_inventory_items (
  id uuid primary key
) on commit drop;
insert into cleanup_inventory_items (id)
select items.id
from public.customer_inventory_items as items
join cleanup_products as products on products.id = items.product_id;

create temporary table cleanup_inventory_shipments (
  id uuid primary key
) on commit drop;
insert into cleanup_inventory_shipments (id)
select distinct items.shipment_id
from public.inventory_shipment_items as items
where items.product_id in (select id from cleanup_products)
   or items.inventory_item_id in (select id from cleanup_inventory_items);

create temporary table cleanup_shipping_fee_payments (
  id uuid primary key
) on commit drop;
insert into cleanup_shipping_fee_payments (id)
select payments.id
from public.shipping_fee_payments as payments
where payments.inventory_shipment_id in (
    select id from cleanup_inventory_shipments
  )
   or (
     payments.payment_context = 'auction_bundle'
     and payments.member_id in (
       select distinct buyer_id from cleanup_transfer_orders
     )
   );

create temporary table cleanup_shipping_credits (
  id uuid primary key,
  member_id uuid not null,
  delta integer not null
) on commit drop;

insert into cleanup_shipping_credits (id, member_id, delta)
select credits.id, credits.member_id, credits.delta
from public.shipping_credit_ledger as credits
where credits.inventory_shipment_id in (
  select id from cleanup_inventory_shipments
);

-- Auction-bundle credits do not carry their payment id. Bind only the nearest
-- matching prepaid entry written by the same confirmation transaction.
insert into cleanup_shipping_credits (id, member_id, delta)
select matched.id, matched.member_id, matched.delta
from public.shipping_fee_payments as payments
join cleanup_shipping_fee_payments as targets on targets.id = payments.id
cross join lateral (
  select credits.id, credits.member_id, credits.delta
  from public.shipping_credit_ledger as credits
  where payments.payment_context = 'auction_bundle'
    and payments.confirmed_at is not null
    and credits.member_id = payments.member_id
    and credits.reason = 'prepaid'
    and credits.delta = payments.credit_quantity
    and abs(extract(epoch from credits.created_at - payments.confirmed_at)) <= 5
  order by abs(extract(epoch from credits.created_at - payments.confirmed_at)),
    credits.id
  limit 1
) as matched
on conflict (id) do nothing;

-- These paths have no rows in the preflight. Abort instead of expanding this
-- one-off cleanup into unrelated commerce, refund, or exception histories.
do $$
begin
  if exists (
    select 1
    from public.commerce_order_items as items
    where items.product_id in (select id from cleanup_products)
  ) or exists (
    select 1
    from public.payment_orders as orders
    where orders.product_id in (select id from cleanup_products)
  ) or exists (
    select 1
    from public.shipping_request_items as items
    where items.product_id in (select id from cleanup_products)
  ) or exists (
    select 1
    from public.inventory_exception_cases as cases
    where cases.inventory_item_id in (select id from cleanup_inventory_items)
  ) or exists (
    select 1
    from public.manual_refunds as refunds
    where refunds.inventory_item_id in (select id from cleanup_inventory_items)
  ) or exists (
    select 1
    from public.shipping_fee_refunds as refunds
    where refunds.shipping_fee_payment_id in (
      select id from cleanup_shipping_fee_payments
    )
  ) or exists (
    select 1
    from public.commerce_shipments as shipments
    where shipments.shipping_credit_ledger_id in (
      select id from cleanup_shipping_credits
    )
       or shipments.shipping_fee_payment_id in (
         select id from cleanup_shipping_fee_payments
       )
  ) then
    raise exception using
      errcode = '55000',
      message = '테스트 상품 정리 범위를 벗어난 주문·환불·예외 참조가 있습니다.';
  end if;
end;
$$;

alter table public.owner_auction_action_audit
  disable trigger owner_auction_action_audit_immutable;
alter table public.security_activity_logs
  disable trigger security_activity_logs_append_only;
alter table public.owner_hidden_test_member_audit
  disable trigger owner_hidden_test_member_audit_append_only;
alter table public.inventory_item_fulfillment_events
  disable trigger inventory_item_fulfillment_events_append_only;
alter table public.inventory_shipment_events
  disable trigger inventory_shipment_events_append_only;
alter table public.store_financial_entries
  disable trigger store_financial_entries_append_only;
alter table public.shipping_credit_ledger
  disable trigger shipping_credit_ledger_validate_canonical_settlement;
alter table public.shipping_fee_payments
  disable trigger shipping_fee_payments_validate_canonical_settlement;
alter table public.auction_bids
  disable trigger auction_bids_clear_anti_sniping_after_last;
alter table public.auction_bids
  disable trigger auction_bids_reopen_fixed_after_last;
alter table public.auction_bids
  disable trigger auction_bids_security_activity;
alter table public.products
  disable trigger products_notify_auction_winner;

-- Inventory shipments and their selected settlement rows intentionally point
-- at each other. Remove only the two outbound shipment FKs while the bounded
-- rows are deleted, then restore and revalidate them in the same transaction.
alter table public.inventory_shipments
  drop constraint inventory_shipments_shipping_credit_ledger_id_fkey;
alter table public.inventory_shipments
  drop constraint inventory_shipments_shipping_fee_payment_id_fkey;

delete from public.inventory_command_receipts as receipts
where receipts.target_id in (select id from cleanup_inventory_items)
   or receipts.target_id in (select id from cleanup_inventory_shipments)
   or receipts.target_id in (select id from cleanup_shipping_fee_payments)
   or (
     receipts.command_name = 'confirm_payment'
     and receipts.target_id in (
       select distinct buyer_id from cleanup_transfer_orders
     )
   );

delete from public.inventory_shipment_events as events
where events.shipment_id in (select id from cleanup_inventory_shipments);

delete from public.inventory_shipment_store_works as work
where work.shipment_id in (select id from cleanup_inventory_shipments);

delete from public.store_financial_entries as entries
where entries.inventory_item_id in (select id from cleanup_inventory_items)
   or entries.inventory_shipment_id in (
     select id from cleanup_inventory_shipments
   );

delete from public.manual_transfer_payment_ledger as entries
where entries.manual_transfer_order_id in (select id from cleanup_transfer_orders)
   or entries.shipping_fee_payment_id in (
     select id from cleanup_shipping_fee_payments
   );

do $$
begin
  if exists (
    select 1
    from (
      select credits.member_id, sum(credits.delta)::integer as net_delta
      from cleanup_shipping_credits as credits
      group by credits.member_id
    ) as changes
    join public.member_accounts as accounts
      on accounts.member_id = changes.member_id
    where accounts.shipping_credit_count - changes.net_delta not between 0 and 10000
  ) then
    raise exception using
      errcode = '22003',
      message = '테스트 배송 크레딧 정리 결과가 허용 범위를 벗어났습니다.';
  end if;
end;
$$;

update public.member_accounts as accounts
set shipping_credit_count =
  accounts.shipping_credit_count - changes.net_delta
from (
  select credits.member_id, sum(credits.delta)::integer as net_delta
  from cleanup_shipping_credits as credits
  group by credits.member_id
) as changes
where accounts.member_id = changes.member_id;

delete from public.shipping_credit_ledger as credits
where credits.id in (select id from cleanup_shipping_credits);

delete from public.shipping_fee_payments as payments
where payments.id in (select id from cleanup_shipping_fee_payments);

delete from public.inventory_shipment_items as items
where items.shipment_id in (select id from cleanup_inventory_shipments);

delete from public.inventory_shipments as shipments
where shipments.id in (select id from cleanup_inventory_shipments);

alter table public.inventory_shipments
  add constraint inventory_shipments_shipping_credit_ledger_id_fkey
  foreign key (shipping_credit_ledger_id)
  references public.shipping_credit_ledger(id)
  on delete restrict;

alter table public.inventory_shipments
  add constraint inventory_shipments_shipping_fee_payment_id_fkey
  foreign key (shipping_fee_payment_id)
  references public.shipping_fee_payments(id)
  on delete restrict;

delete from public.inventory_item_fulfillment_events as events
where events.inventory_item_id in (select id from cleanup_inventory_items);

delete from public.inventory_item_fulfillments as fulfillment
where fulfillment.inventory_item_id in (select id from cleanup_inventory_items);

delete from public.customer_inventory_items as items
where items.id in (select id from cleanup_inventory_items);

delete from public.manual_transfer_orders as orders
where orders.id in (select id from cleanup_transfer_orders);

delete from public.auction_offer_penalties as penalties
where penalties.offer_id in (select id from cleanup_offers);

delete from public.auction_purchase_offers as offers
where offers.id in (select id from cleanup_offers);

delete from public.owner_auction_action_audit as audits
where audits.product_id in (select id from cleanup_products);

update public.products as products
set
  bid_locked_at = null,
  final_bid_id = null,
  final_bid_amount = null
where products.id in (select id from cleanup_products);

delete from public.auction_bids as bids
where bids.id in (select id from cleanup_bids);

delete from public.cancelled_auction_bids as bids
where bids.product_id in (select id from cleanup_products);

delete from public.support_messages as messages
where messages.product_id in (select id from cleanup_products);

delete from public.products as products
where products.id in (select id from cleanup_products);

-- Remove security activity generated by and referring to the test commerce
-- entities, plus activity whose actor or subject is a withdrawn test member.
delete from public.security_activity_logs as logs
where logs.entity_id in (
  select id::text from cleanup_products
  union
  select id::text from cleanup_bids
  union
  select id::text from cleanup_offers
  union
  select id::text from cleanup_transfer_orders
  union
  select id::text from cleanup_inventory_items
  union
  select id::text from cleanup_inventory_shipments
  union
  select id::text from cleanup_shipping_fee_payments
)
or logs.actor_user_id in (select member_id from cleanup_withdrawn_members)
or logs.subject_user_id in (select member_id from cleanup_withdrawn_members);

delete from app_private.member_management_events as events
where events.member_id in (select member_id from cleanup_withdrawn_members)
   or events.actor_id in (select member_id from cleanup_withdrawn_members);

delete from public.owner_hidden_test_member_audit as audits
where audits.target_test_user_id in (
  select member_id from cleanup_withdrawn_members
);

delete from public.owner_hidden_test_members as members
where members.test_user_id in (
  select member_id from cleanup_withdrawn_members
);

do $$
declare
  withdrawn record;
begin
  for withdrawn in
    select members.member_id, members.purge_due_at
    from cleanup_withdrawn_members as members
    order by members.member_id
  loop
    perform app_private.cleanup_withdrawn_member(
      withdrawn.member_id,
      withdrawn.purge_due_at
    );
  end loop;
end;
$$;

alter table public.products
  enable trigger products_notify_auction_winner;
alter table public.auction_bids
  enable trigger auction_bids_security_activity;
alter table public.auction_bids
  enable trigger auction_bids_reopen_fixed_after_last;
alter table public.auction_bids
  enable trigger auction_bids_clear_anti_sniping_after_last;
alter table public.shipping_fee_payments
  enable trigger shipping_fee_payments_validate_canonical_settlement;
alter table public.shipping_credit_ledger
  enable trigger shipping_credit_ledger_validate_canonical_settlement;
alter table public.store_financial_entries
  enable trigger store_financial_entries_append_only;
alter table public.inventory_shipment_events
  enable trigger inventory_shipment_events_append_only;
alter table public.inventory_item_fulfillment_events
  enable trigger inventory_item_fulfillment_events_append_only;
alter table public.owner_hidden_test_member_audit
  enable trigger owner_hidden_test_member_audit_append_only;
alter table public.security_activity_logs
  enable trigger security_activity_logs_append_only;
alter table public.owner_auction_action_audit
  enable trigger owner_auction_action_audit_immutable;

commit;
