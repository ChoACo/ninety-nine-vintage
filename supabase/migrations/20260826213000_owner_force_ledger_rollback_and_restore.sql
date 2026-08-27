begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';

-- A forced Owner rollback is a platform-state reversal, not erasure. Cash,
-- settlement, fulfillment, and security history remains append-only.
alter table public.owner_ledger_repair_events
  drop constraint if exists owner_ledger_repair_events_action_check;
alter table public.owner_ledger_repair_events
  add constraint owner_ledger_repair_events_action_check check (action in (
    'cancel_bid', 'cancel_auction_payment', 'cancel_commerce_order',
    'cancel_legacy_payment', 'update_auction_due_at',
    'cancel_inventory_item', 'restore_inventory_item',
    'update_storage_duration', 'cancel_shipment',
    'correct_shipment_tracking', 'restore_audit_event'
  ));

alter table public.auction_purchase_offers
  drop constraint if exists auction_purchase_offers_status_check;
alter table public.auction_purchase_offers
  add constraint auction_purchase_offers_status_check check (status in (
    'payment_due','offered','accepted','settled','expired_unpaid','declined',
    'expired_offer','no_successor','owner_reversed'
  ));

alter table public.manual_transfer_orders
  drop constraint if exists manual_transfer_orders_status_check;
alter table public.manual_transfer_orders
  add constraint manual_transfer_orders_status_check check (status in (
    'awaiting_manual_transfer','confirmed','cancelled_unpaid','owner_reversed'
  ));
alter table public.manual_transfer_orders
  drop constraint if exists manual_transfer_orders_confirmation_check;
alter table public.manual_transfer_orders
  add constraint manual_transfer_orders_confirmation_check check (
    (status='awaiting_manual_transfer' and confirmed_at is null and confirmed_by is null and cancelled_at is null and cancellation_reason is null)
    or (status='confirmed' and confirmed_at is not null and cancelled_at is null and cancellation_reason is null)
    or (status='cancelled_unpaid' and confirmed_at is null and confirmed_by is null and cancelled_at is not null and char_length(btrim(cancellation_reason)) between 2 and 200)
    or (status='owner_reversed' and cancelled_at is not null and char_length(btrim(cancellation_reason)) between 3 and 200)
  );

alter table public.commerce_order_transfers
  drop constraint if exists commerce_order_transfers_status_check;
alter table public.commerce_order_transfers
  add constraint commerce_order_transfers_status_check check (status in (
    'awaiting_transfer','partially_paid','confirmed','cancelled','owner_reversed'
  ));
alter table public.commerce_order_items
  drop constraint if exists commerce_order_items_payment_status_check;
alter table public.commerce_order_items
  add constraint commerce_order_items_payment_status_check check (payment_status in (
    'awaiting_payment','paid','cancelled','owner_reversed'
  ));
alter table public.commerce_orders
  drop constraint if exists commerce_orders_status_check;
alter table public.commerce_orders
  add constraint commerce_orders_status_check check (status in (
    'awaiting_payment','paid','partially_paid','cancelled','shipped',
    'partially_refunded','refunded','owner_reversed'
  ));

alter table public.payment_orders
  drop constraint if exists payment_orders_payment_status_check;
alter table public.payment_orders
  add constraint payment_orders_payment_status_check check (payment_status in (
    '대기중','가상계좌발급','결제완료','소유자철회'
  ));
alter table public.payment_orders
  drop constraint if exists payment_orders_status_mapping_check;
alter table public.payment_orders
  add constraint payment_orders_status_mapping_check check (
    payment_status='소유자철회'
    or (portone_status is null and payment_status='대기중')
    or (portone_status in ('READY','PAY_PENDING') and payment_status='대기중')
    or (portone_status='VIRTUAL_ACCOUNT_ISSUED' and payment_status='가상계좌발급')
    or (portone_status='PAID' and payment_status='결제완료')
    or (portone_status='FAILED' and payment_status='대기중')
    or (portone_status='PARTIAL_CANCELLED' and payment_status='결제완료')
    or (portone_status='CANCELLED' and payment_status='대기중')
  );

-- Only the Owner-only SECURITY DEFINER functions below set this transaction-local
-- marker. It lets them cross normal workflow guards while preserving constraints.
create or replace function app_private.owner_force_ledger_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_owner()
    and coalesce(current_setting('app.owner_force_ledger', true), '') = 'on'
$$;
revoke all on function app_private.owner_force_ledger_enabled()
from public,anon,authenticated,service_role;

create or replace function public.enforce_manual_transfer_ledger_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_received bigint; v_valid boolean := false;
begin
  if app_private.owner_force_ledger_enabled() then return new; end if;
  if tg_table_name='commerce_order_transfers' then
    select coalesce(sum(case when entry_type='receipt' then amount else -amount end),0)::bigint into v_received
    from public.manual_transfer_payment_ledger where commerce_order_transfer_id=new.id;
  elsif tg_table_name='manual_transfer_orders' then
    select coalesce(sum(case when entry_type='receipt' then amount else -amount end),0)::bigint into v_received
    from public.manual_transfer_payment_ledger where manual_transfer_order_id=new.id;
  elsif tg_table_name='shipping_fee_payments' then
    select coalesce(sum(case when entry_type='receipt' then amount else -amount end),0)::bigint into v_received
    from public.manual_transfer_payment_ledger where shipping_fee_payment_id=new.id;
  else
    raise exception using errcode='55000',message='지원하지 않는 수동 입금 확정 대상입니다.';
  end if;
  if tg_table_name='manual_transfer_orders' then
    v_valid := (new.status='awaiting_manual_transfer' and v_received=0 and new.payment_deadline_held_at is null and new.due_at_before_payment_hold is null and new.offer_due_at_before_payment_hold is null)
      or (new.status='awaiting_manual_transfer' and v_received between 1 and new.expected_amount-1 and new.payment_deadline_held_at is not null and new.due_at is null)
      or (new.status='confirmed' and v_received=new.expected_amount)
      or (new.status='cancelled_unpaid' and v_received=0 and new.payment_deadline_held_at is null and new.due_at_before_payment_hold is null and new.offer_due_at_before_payment_hold is null);
  else
    v_valid := (new.status='awaiting_transfer' and v_received=0)
      or (new.status='partially_paid' and v_received between 1 and new.expected_amount-1)
      or (new.status='confirmed' and v_received=new.expected_amount)
      or (new.status='cancelled' and v_received=0);
  end if;
  if not v_valid then raise exception using errcode='55000',message='수동 입금 상태와 원장 누적액이 일치하지 않습니다.'; end if;
  return new;
end;
$$;

create or replace function app_private.guard_legacy_provider_payment_history_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  if app_private.owner_force_ledger_enabled() then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  raise exception using errcode='55000',message='과거 결제대행 기록은 읽기 전용입니다.';
end;
$$;

create or replace function app_private.reject_inventory_paid_source_reversal()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_is_reversal boolean:=false; v_item public.customer_inventory_items%rowtype; v_f public.inventory_item_fulfillments%rowtype; v_key uuid:=gen_random_uuid();
begin
  if app_private.owner_force_ledger_enabled() then return new; end if;
  if tg_table_name='commerce_order_items' then
    v_is_reversal:=old.payment_status='paid' and new.payment_status<>'paid';
    if v_is_reversal then select * into v_item from public.customer_inventory_items where commerce_order_item_id=old.id for update; end if;
  elsif tg_table_name='manual_transfer_orders' then
    v_is_reversal:=old.status='confirmed' and new.status<>'confirmed';
    if v_is_reversal then select * into v_item from public.customer_inventory_items where manual_transfer_order_id=old.id for update; end if;
  elsif tg_table_name='payment_orders' then
    v_is_reversal:=old.payment_status='결제완료' and old.portone_status='PAID' and (new.payment_status<>'결제완료' or new.portone_status<>'PAID');
    if v_is_reversal then select * into v_item from public.customer_inventory_items where legacy_payment_order_id=old.id for update; end if;
  end if;
  if not v_is_reversal or v_item.id is null then return new; end if;
  select * into v_f from public.inventory_item_fulfillments where inventory_item_id=v_item.id for update;
  if v_item.ownership_status<>'active' or v_f.current_stage<>'entitled' or v_f.outbound_released or v_f.is_blocked
    or exists(select 1 from public.inventory_shipment_items x where x.inventory_item_id=v_item.id and x.line_status in ('requested','held','ready','packed'))
    or exists(select 1 from public.inventory_exception_cases e where e.inventory_item_id=v_item.id and e.status='open')
  then raise exception using errcode='55000',message='이동 또는 예외 처리가 시작된 보관 소유권은 결제 원천에서 되돌릴 수 없습니다. 수동 환불 절차를 사용해 주세요.'; end if;
  insert into public.inventory_item_fulfillment_events(inventory_item_id,sequence_no,event_type,from_stage,to_stage,from_location_kind,to_location_kind,actor_kind,idempotency_key,reason_code,metadata)
  values(v_item.id,coalesce((select max(sequence_no)+1 from public.inventory_item_fulfillment_events where inventory_item_id=v_item.id),1),'cancelled',v_f.current_stage,'cancelled',v_f.location_kind,'unknown','system',v_key,'payment_source_reversed',jsonb_build_object('sourceKind',v_item.source_kind));
  update public.customer_inventory_items set ownership_status='cancelled',version=version+1 where id=v_item.id;
  update public.inventory_item_fulfillments set current_stage='cancelled',location_kind='unknown',storage_location_code=null,outbound_released=false,is_blocked=false,block_reason=null,version=version+1,last_event_at=clock_timestamp(),updated_at=clock_timestamp() where inventory_item_id=v_item.id;
  insert into public.store_financial_entries(business_id,origin_store_id,inventory_item_id,entry_kind,amount,occurred_at,idempotency_key,metadata)
  values(v_item.business_id,v_item.origin_store_id,v_item.id,'payment_reversal',-v_item.paid_amount,clock_timestamp(),gen_random_uuid(),jsonb_build_object('sourceKind',v_item.source_kind,'reason','payment_source_reversed'));
  return new;
end;
$$;

create or replace function public.enforce_member_bid_eligibility()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_lock_key bigint; v_blocked_until timestamptz;
begin
  if app_private.owner_force_ledger_enabled() then return new; end if;
  if new.bidder_id is null then return new; end if;
  if public.effective_member_account_status(new.bidder_id)<>'active' then raise exception using errcode='42501',message='정지된 계정은 입찰할 수 없습니다.'; end if;
  v_lock_key:=hashtextextended('member-warning-enforcement:'||new.bidder_id::text,0);
  if not pg_try_advisory_xact_lock(v_lock_key) then raise exception using errcode='P0001',message='제재 상태를 갱신 중입니다.'; end if;
  select max(ends_at) into v_blocked_until from public.member_bid_sanctions where member_id=new.bidder_id and status='active' and ends_at>clock_timestamp();
  if v_blocked_until is not null then raise exception using errcode='42501',message=format('%s까지 입찰할 수 없습니다.',v_blocked_until); end if;
  return new;
end;
$$;

create or replace function app_private.reject_bids_during_emergency()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if app_private.owner_force_ledger_enabled() then return new; end if;
  if exists(select 1 from public.auction_emergency_control where singleton and paused) then raise exception using errcode='P0001',message='전사 경매가 비상 일시정지 상태입니다.'; end if;
  return new;
end;
$$;

create or replace function app_private.notify_previous_high_bidder()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_previous public.auction_bids%rowtype; v_title text;
begin
  if app_private.owner_force_ledger_enabled() then return new; end if;
  select * into v_previous from public.auction_bids b where b.product_id=new.product_id and b.id<>new.id and b.bidder_id is not null
    and not exists(select 1 from public.cancelled_auction_bids c where c.original_bid_id=b.id)
    order by b.amount desc,b.created_at desc,b.id desc limit 1;
  if v_previous.id is null or v_previous.bidder_id=new.bidder_id then return new; end if;
  select title into v_title from public.products where id=new.product_id;
  perform app_private.insert_targeted_notification(v_previous.bidder_id,'member','auction_outbid','[99 Live Auction] 입찰 추월 알림!',coalesce(left(v_title,120)||' · ','')||'회원님의 최고 입찰가가 추월당했습니다. 지금 확인하고 다시 입찰하세요.','/live/'||new.product_id::text);
  return new;
end;
$$;

create or replace function app_private.owner_force_ledger_snapshot(
  p_member uuid,p_product_ids uuid[],p_inventory_ids uuid[],p_shipment_ids uuid[],
  p_order_ids uuid[],p_manual_ids uuid[],p_legacy_ids uuid[]
) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
  'memberId',p_member,
  'products',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.products x where x.id=any(p_product_ids)),'[]'::jsonb),
  'auctionBids',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.auction_bids x where x.product_id=any(p_product_ids) and x.bidder_id=p_member),'[]'::jsonb),
  'cancelledBids',coalesce((select jsonb_agg(to_jsonb(x) order by x.cancelled_at,x.original_bid_id) from public.cancelled_auction_bids x where x.product_id=any(p_product_ids) and x.bidder_id=p_member),'[]'::jsonb),
  'purchaseOffers',coalesce((select jsonb_agg(to_jsonb(x) order by x.offered_at,x.id) from public.auction_purchase_offers x where x.product_id=any(p_product_ids) and x.bidder_id=p_member),'[]'::jsonb),
  'manualTransfers',coalesce((select jsonb_agg(to_jsonb(x) order by x.requested_at,x.id) from public.manual_transfer_orders x where x.id=any(p_manual_ids)),'[]'::jsonb),
  'commerceOrders',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.commerce_orders x where x.id=any(p_order_ids)),'[]'::jsonb),
  'commerceItems',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.commerce_order_items x where x.order_id=any(p_order_ids)),'[]'::jsonb),
  'commerceTransfers',coalesce((select jsonb_agg(to_jsonb(x) order by x.requested_at,x.id) from public.commerce_order_transfers x where x.order_id=any(p_order_ids)),'[]'::jsonb),
  'legacyPayments',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.payment_orders x where x.id=any(p_legacy_ids)),'[]'::jsonb),
  'inventory',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.customer_inventory_items x where x.id=any(p_inventory_ids)),'[]'::jsonb),
  'fulfillments',coalesce((select jsonb_agg(to_jsonb(x) order by x.inventory_item_id) from public.inventory_item_fulfillments x where x.inventory_item_id=any(p_inventory_ids)),'[]'::jsonb),
  'shipments',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.inventory_shipments x where x.id=any(p_shipment_ids)),'[]'::jsonb),
  'shipmentItems',coalesce((select jsonb_agg(to_jsonb(x) order by x.shipment_id,x.inventory_item_id) from public.inventory_shipment_items x where x.shipment_id=any(p_shipment_ids)),'[]'::jsonb),
  'shipmentWorks',coalesce((select jsonb_agg(to_jsonb(x) order by x.shipment_id,x.id) from public.inventory_shipment_store_works x where x.shipment_id=any(p_shipment_ids)),'[]'::jsonb),
  'shippingFeePayments',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.shipping_fee_payments x where x.inventory_shipment_id=any(p_shipment_ids)),'[]'::jsonb),
  'cashBalances',coalesce((select jsonb_agg(q order by q.kind,q.id) from (
    select 'auction' kind,m.id,coalesce(sum(case when l.entry_type='receipt' then l.amount else -l.amount end),0)::bigint balance,
      coalesce((array_agg(l.depositor_name order by l.created_at) filter(where l.entry_type='receipt'))[1],'소유자복구') depositor_name
    from public.manual_transfer_orders m left join public.manual_transfer_payment_ledger l on l.manual_transfer_order_id=m.id where m.id=any(p_manual_ids) group by m.id
    union all
    select 'commerce',t.id,coalesce(sum(case when l.entry_type='receipt' then l.amount else -l.amount end),0)::bigint,
      coalesce((array_agg(l.depositor_name order by l.created_at) filter(where l.entry_type='receipt'))[1],'소유자복구')
    from public.commerce_order_transfers t left join public.manual_transfer_payment_ledger l on l.commerce_order_transfer_id=t.id where t.order_id=any(p_order_ids) group by t.id
    union all
    select 'shipping',s.id,coalesce(sum(case when l.entry_type='receipt' then l.amount else -l.amount end),0)::bigint,
      coalesce((array_agg(l.depositor_name order by l.created_at) filter(where l.entry_type='receipt'))[1],'소유자복구')
    from public.shipping_fee_payments s left join public.manual_transfer_payment_ledger l on l.shipping_fee_payment_id=s.id where s.inventory_shipment_id=any(p_shipment_ids) group by s.id
  )q),'[]'::jsonb),
  'financialBalances',coalesce((select jsonb_agg(q order by q.inventory_item_id) from (
    select i.id inventory_item_id,coalesce(sum(f.amount),0)::bigint balance from public.customer_inventory_items i left join public.store_financial_entries f on f.inventory_item_id=i.id where i.id=any(p_inventory_ids) group by i.id
  )q),'[]'::jsonb),
  'shippingCreditCount',(select shipping_credit_count from public.member_accounts where member_id=p_member)
)
$$;
revoke all on function app_private.owner_force_ledger_snapshot(uuid,uuid[],uuid[],uuid[],uuid[],uuid[],uuid[])
from public,anon,authenticated,service_role;

create or replace function public.owner_force_ledger_rollback(
  p_action text,p_entity_id uuid,p_expected_version bigint,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_member uuid; v_product_ids uuid[]:='{}'; v_inventory_ids uuid[]:='{}'; v_shipment_ids uuid[]:='{}';
  v_order_ids uuid[]:='{}'; v_manual_ids uuid[]:='{}'; v_legacy_ids uuid[]:='{}'; v_bid_ids uuid[]:='{}';
  v_reason text:=btrim(coalesce(p_reason,'')); v_now timestamptz:=clock_timestamp(); v_before jsonb; v_after jsonb; v_result jsonb;
  v_existing public.owner_ledger_repair_events%rowtype; v_fp text; v_entity_type text; v_product_id uuid; v_row record; v_had_physical boolean:=false; v_had_cash boolean:=false;
begin
  if v_actor is null or not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if p_action not in ('cancel_bid','cancel_auction_payment','cancel_commerce_order','cancel_legacy_payment','cancel_inventory_item','cancel_shipment')
    or p_entity_id is null or p_idempotency_key is null or char_length(v_reason) not between 3 and 500
  then raise exception using errcode='22023',message='강제 철회 입력값을 확인해 주세요.'; end if;
  v_fp:=encode(extensions.digest(convert_to(jsonb_build_object('action',p_action,'entityId',p_entity_id,'expectedVersion',p_expected_version,'reason',v_reason)::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from public.owner_ledger_repair_events where actor_owner_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fp then raise exception using errcode='23505',message='같은 요청 키를 다른 강제 철회에 재사용할 수 없습니다.'; end if;
    return v_existing.result||jsonb_build_object('idempotentReplay',true);
  end if;
  perform set_config('app.owner_force_ledger','on',true);

  if p_action='cancel_bid' then
    select bidder_id,product_id into v_member,v_product_id from public.auction_bids where id=p_entity_id;
    v_entity_type:='auction_bid';
  elsif p_action='cancel_auction_payment' then
    select buyer_id,product_id into v_member,v_product_id from public.manual_transfer_orders where id=p_entity_id;
    v_manual_ids:=array[p_entity_id]; v_entity_type:='auction_payment';
  elsif p_action='cancel_commerce_order' then
    select member_id into v_member from public.commerce_orders where id=p_entity_id;
    v_order_ids:=array[p_entity_id]; v_entity_type:='commerce_order';
  elsif p_action='cancel_legacy_payment' then
    select buyer_id,product_id into v_member,v_product_id from public.payment_orders where id=p_entity_id;
    v_legacy_ids:=array[p_entity_id]; v_entity_type:='legacy_payment';
  elsif p_action='cancel_inventory_item' then
    select member_id,product_id into v_member,v_product_id from public.customer_inventory_items where id=p_entity_id;
    v_inventory_ids:=array[p_entity_id]; v_entity_type:='inventory_item';
  else
    select member_id into v_member from public.inventory_shipments where id=p_entity_id;
    v_shipment_ids:=array[p_entity_id]; v_entity_type:='shipment';
  end if;
  if v_member is null then raise exception using errcode='P0002',message='강제 철회 대상을 찾지 못했습니다.'; end if;

  if cardinality(v_product_ids)=0 then
    if v_product_id is not null then v_product_ids:=array[v_product_id];
    elsif cardinality(v_order_ids)>0 then select coalesce(array_agg(product_id order by product_id),'{}') into v_product_ids from public.commerce_order_items where order_id=any(v_order_ids);
    elsif cardinality(v_shipment_ids)>0 then select coalesce(array_agg(product_id order by product_id),'{}') into v_product_ids from public.inventory_shipment_items where shipment_id=any(v_shipment_ids);
    end if;
  end if;
  if cardinality(v_inventory_ids)=0 and p_action<>'cancel_shipment' then
    select coalesce(array_agg(id order by id),'{}') into v_inventory_ids from public.customer_inventory_items where member_id=v_member and product_id=any(v_product_ids);
  end if;
  if cardinality(v_inventory_ids)>0 then
    select coalesce(array_agg(distinct shipment_id order by shipment_id),'{}') into v_shipment_ids from public.inventory_shipment_items where inventory_item_id=any(v_inventory_ids);
  elsif cardinality(v_shipment_ids)>0 then
    select coalesce(array_agg(inventory_item_id order by inventory_item_id),'{}') into v_inventory_ids from public.inventory_shipment_items where shipment_id=any(v_shipment_ids);
  end if;
  if cardinality(v_order_ids)=0 then
    select coalesce(array_agg(distinct order_id order by order_id),'{}') into v_order_ids from public.commerce_order_items where id in (select commerce_order_item_id from public.customer_inventory_items where id=any(v_inventory_ids));
  end if;
  if cardinality(v_manual_ids)=0 then
    select coalesce(array_agg(id order by id),'{}') into v_manual_ids from public.manual_transfer_orders where buyer_id=v_member and (product_id=any(v_product_ids) or id in (select manual_transfer_order_id from public.customer_inventory_items where id=any(v_inventory_ids)));
  end if;
  if cardinality(v_legacy_ids)=0 then
    select coalesce(array_agg(id order by id),'{}') into v_legacy_ids from public.payment_orders where buyer_id=v_member and (product_id=any(v_product_ids) or id in (select legacy_payment_order_id from public.customer_inventory_items where id=any(v_inventory_ids)));
  end if;
  select coalesce(array_agg(id order by id),'{}') into v_bid_ids from public.auction_bids where bidder_id=v_member and product_id=any(v_product_ids);

  perform 1 from public.products where id=any(v_product_ids) order by id for update;
  perform 1 from public.manual_transfer_orders where id=any(v_manual_ids) order by id for update;
  perform 1 from public.commerce_orders where id=any(v_order_ids) order by id for update;
  perform 1 from public.customer_inventory_items where id=any(v_inventory_ids) order by id for update;
  perform 1 from public.inventory_shipments where id=any(v_shipment_ids) order by id for update;
  if p_expected_version is not null and p_action in ('cancel_auction_payment','cancel_inventory_item','cancel_shipment') then
    if p_action='cancel_auction_payment' and not exists(select 1 from public.manual_transfer_orders where id=p_entity_id and version=p_expected_version) then raise exception using errcode='PT409',message='결제 상태가 변경되었습니다.'; end if;
    if p_action='cancel_inventory_item' and not exists(select 1 from public.customer_inventory_items where id=p_entity_id and version=p_expected_version) then raise exception using errcode='PT409',message='보관 상태가 변경되었습니다.'; end if;
    if p_action='cancel_shipment' and not exists(select 1 from public.inventory_shipments where id=p_entity_id and version=p_expected_version) then raise exception using errcode='PT409',message='배송 상태가 변경되었습니다.'; end if;
  end if;
  v_before:=app_private.owner_force_ledger_snapshot(v_member,v_product_ids,v_inventory_ids,v_shipment_ids,v_order_ids,v_manual_ids,v_legacy_ids);
  v_had_physical:=exists(select 1 from public.inventory_shipments where id=any(v_shipment_ids) and (status in ('packed','shipped') or delivered_at is not null));
  v_had_cash:=exists(select 1 from jsonb_array_elements(v_before->'cashBalances') x where coalesce((x->>'balance')::bigint,0)>0);

  -- Cash receipts are never deleted. Reverse every still-live receipt.
  insert into public.manual_transfer_payment_ledger(transfer_kind,manual_transfer_order_id,commerce_order_transfer_id,shipping_fee_payment_id,entry_type,amount,memo,reversal_of,recorded_by,idempotency_key)
  select l.transfer_kind,l.manual_transfer_order_id,l.commerce_order_transfer_id,l.shipping_fee_payment_id,'reversal',l.amount,left('owner_force_ledger:'||v_reason,500),l.id,v_actor,gen_random_uuid()::text
  from public.manual_transfer_payment_ledger l
  where ((l.manual_transfer_order_id=any(v_manual_ids))
      or (l.commerce_order_transfer_id in (select id from public.commerce_order_transfers where order_id=any(v_order_ids)))
      or (l.shipping_fee_payment_id in (select id from public.shipping_fee_payments where inventory_shipment_id=any(v_shipment_ids))))
    and l.entry_type='receipt'
    and not exists(select 1 from public.manual_transfer_payment_ledger r where r.reversal_of=l.id);

  update public.shipping_fee_payments set status='cancelled',version=version+1 where inventory_shipment_id=any(v_shipment_ids);
  insert into public.shipping_credit_ledger(member_id,delta,reason,created_by,business_id)
  select s.member_id,1,'refund',v_actor,s.business_id from public.inventory_shipments s
  where s.id=any(v_shipment_ids) and s.settlement_method='shipping_credit';
  update public.inventory_shipment_items set line_status='cancelled',excluded_reason=left('owner_force_ledger:'||v_reason,1000),updated_at=v_now where shipment_id=any(v_shipment_ids);
  update public.inventory_shipment_store_works set status='cancelled',completed_at=null,completed_by=null,version=version+1,updated_at=v_now where shipment_id=any(v_shipment_ids);
  update public.inventory_shipments set status='cancelled',courier=null,tracking_number=null,packed_at=null,packed_by=null,shipped_at=null,shipped_by=null,
    cancelled_at=v_now,cancellation_reason=left('owner_force_ledger:'||v_reason,1000),delivery_status='pending',delivery_status_text=null,tracking_checked_at=null,tracking_error=null,delivered_at=null,auto_settle_at=null,
    settlement_status=case when settlement_status='settled' then 'refunded' else settlement_status end,version=version+1,updated_at=v_now where id=any(v_shipment_ids);

  insert into public.store_financial_entries(business_id,origin_store_id,inventory_item_id,entry_kind,amount,occurred_at,idempotency_key,metadata)
  select i.business_id,i.origin_store_id,i.id,'payment_reversal',-sum(f.amount),v_now,gen_random_uuid(),jsonb_build_object('reason','owner_force_ledger','ownerId',v_actor,'requestId',p_idempotency_key)
  from public.customer_inventory_items i join public.store_financial_entries f on f.inventory_item_id=i.id
  where i.id=any(v_inventory_ids) group by i.id,i.business_id,i.origin_store_id having sum(f.amount)>0;
  update public.customer_inventory_items set ownership_status='cancelled',version=version+1,updated_at=v_now where id=any(v_inventory_ids);
  update public.inventory_item_fulfillments set current_stage='cancelled',location_kind='unknown',storage_location_code=null,outbound_released=false,is_blocked=false,block_reason=null,version=version+1,last_event_at=v_now,updated_at=v_now where inventory_item_id=any(v_inventory_ids);

  update public.manual_transfer_orders set status='owner_reversed',cancelled_at=v_now,cancellation_reason=left('owner_force:'||v_reason,200),payment_deadline_held_at=null,due_at_before_payment_hold=null,offer_due_at_before_payment_hold=null,version=version+1,updated_at=v_now where id=any(v_manual_ids);
  update public.auction_purchase_offers set status='owner_reversed',updated_at=v_now where id in (select purchase_offer_id from public.manual_transfer_orders where id=any(v_manual_ids));
  update public.commerce_order_transfers set status='owner_reversed',cancelled_at=v_now,cancelled_by=v_actor,cancellation_reason=v_reason,version=version+1 where order_id=any(v_order_ids);
  update public.commerce_order_items set payment_status='owner_reversed',storage_expires_at=null where order_id=any(v_order_ids);
  update public.commerce_orders set status='owner_reversed',updated_at=v_now where id=any(v_order_ids);
  update public.payment_orders set payment_status='소유자철회',updated_at=v_now where id=any(v_legacy_ids);

  insert into public.cancelled_auction_bids(original_bid_id,product_id,bidder_id,bidder_display_name,amount,original_created_at,was_final,cancelled_at,cancellation_reason)
  select id,product_id,bidder_id,bidder_display_name,amount,created_at,is_final,v_now,left('owner_force_ledger:'||v_reason,500) from public.auction_bids where id=any(v_bid_ids)
  on conflict(original_bid_id) do nothing;
  delete from public.auction_bids where id=any(v_bid_ids);
  for v_product_id in select unnest(v_product_ids) loop
    perform set_config('app.authoritative_bid_product_id',v_product_id::text,true);
    update public.products p set
      current_price=coalesce((select max(amount) from public.auction_bids b where b.product_id=p.id),p.starting_price),
      participant_count=(select count(distinct bidder_id) from public.auction_bids b where b.product_id=p.id and b.bidder_id is not null),
      bid_locked_at=null,final_bid_id=null,final_bid_amount=null,sale_completed_at=null,updated_at=v_now
    where p.id=v_product_id;
  end loop;

  v_after:=app_private.owner_force_ledger_snapshot(v_member,v_product_ids,v_inventory_ids,v_shipment_ids,v_order_ids,v_manual_ids,v_legacy_ids);
  v_result:=jsonb_build_object('action',p_action,'entityId',p_entity_id,'memberId',v_member,'productIds',v_product_ids,'status','owner_reversed','restorable',true,
    'externalActionsRequired',jsonb_build_object('bankRefund',v_had_cash,'physicalShipmentRecall',v_had_physical),'idempotentReplay',false);
  insert into public.owner_ledger_repair_events(actor_owner_id,member_id,action,entity_type,entity_id,product_id,reason,idempotency_key,request_fingerprint,before_state,after_state,result)
  values(v_actor,v_member,p_action,v_entity_type,p_entity_id,v_product_ids[1],v_reason,p_idempotency_key,v_fp,v_before,v_after,v_result);
  perform app_private.write_security_activity(v_actor,v_member,'commerce','owner_force_ledger_rollback',p_action,'owner_force_ledger_rollback',v_entity_type,p_entity_id::text,'critical',null,null,jsonb_build_object('reason',v_reason,'productIds',v_product_ids,'externalActionsRequired',v_result->'externalActionsRequired'));
  return v_result;
end;
$$;
revoke all on function public.owner_force_ledger_rollback(text,uuid,bigint,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_force_ledger_rollback(text,uuid,bigint,text,uuid) to authenticated;

create or replace function public.owner_restore_ledger_repair_event(
  p_event_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_source public.owner_ledger_repair_events%rowtype; v_existing public.owner_ledger_repair_events%rowtype;
  v_reason text:=btrim(coalesce(p_reason,'')); v_fp text; v_now timestamptz:=clock_timestamp(); v_row jsonb; v_before jsonb; v_after jsonb; v_result jsonb;
  v_current bigint; v_target bigint; v_delta bigint; v_kind text; v_id uuid; v_member uuid; v_product_id uuid;
begin
  if v_actor is null or not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if p_event_id is null or p_idempotency_key is null or char_length(v_reason) not between 3 and 500 then raise exception using errcode='22023',message='복구 입력값을 확인해 주세요.'; end if;
  v_fp:=encode(extensions.digest(convert_to(jsonb_build_object('eventId',p_event_id,'reason',v_reason)::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from public.owner_ledger_repair_events where actor_owner_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fp then raise exception using errcode='23505',message='같은 요청 키를 다른 복구에 재사용할 수 없습니다.'; end if;
    return v_existing.result||jsonb_build_object('idempotentReplay',true);
  end if;
  select * into v_source from public.owner_ledger_repair_events where id=p_event_id for update;
  if not found then raise exception using errcode='P0002',message='복구할 감사 기록을 찾지 못했습니다.'; end if;
  if v_source.action not in ('cancel_bid','cancel_auction_payment','cancel_commerce_order','cancel_legacy_payment','cancel_inventory_item','cancel_shipment') then raise exception using errcode='55000',message='이 감사 기록은 강제 철회 복구 대상이 아닙니다.'; end if;
  if exists(select 1 from public.owner_ledger_repair_events e where e.action='restore_audit_event' and e.result->>'sourceEventId'=p_event_id::text) then raise exception using errcode='PT409',message='이미 복구된 감사 기록입니다.'; end if;
  if exists(select 1 from public.owner_ledger_repair_events e where e.member_id is not distinct from v_source.member_id and e.occurred_at>v_source.occurred_at and e.action<>'restore_audit_event' and (e.entity_id=v_source.entity_id or (e.product_id is not null and e.product_id=v_source.product_id))) then
    raise exception using errcode='PT409',message='철회 이후 같은 원장에 다른 변경이 있어 자동 복구할 수 없습니다.';
  end if;
  perform set_config('app.owner_force_ledger','on',true);
  v_member:=v_source.member_id; v_product_id:=v_source.product_id; v_before:=jsonb_build_object('sourceEvent',to_jsonb(v_source));

  -- Restore append-only cash balance with a compensating receipt or reversal.
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'cashBalances','[]'::jsonb)) loop
    v_kind:=v_row->>'kind'; v_id:=(v_row->>'id')::uuid; v_target:=coalesce((v_row->>'balance')::bigint,0);
    select coalesce(sum(case when entry_type='receipt' then amount else -amount end),0)::bigint into v_current from public.manual_transfer_payment_ledger
    where (v_kind='auction' and manual_transfer_order_id=v_id) or (v_kind='commerce' and commerce_order_transfer_id=v_id) or (v_kind='shipping' and shipping_fee_payment_id=v_id);
    v_delta:=v_target-v_current;
    if v_delta>0 then
      insert into public.manual_transfer_payment_ledger(transfer_kind,manual_transfer_order_id,commerce_order_transfer_id,shipping_fee_payment_id,entry_type,amount,depositor_name,memo,recorded_by,idempotency_key)
      values(v_kind,case when v_kind='auction' then v_id end,case when v_kind='commerce' then v_id end,case when v_kind='shipping' then v_id end,'receipt',v_delta,left(coalesce(v_row->>'depositor_name','소유자복구'),80),left('owner_restore:'||v_reason,500),v_actor,gen_random_uuid()::text);
    elsif v_delta<0 then
      select id,least(amount,-v_delta) into v_id,v_target from public.manual_transfer_payment_ledger l where ((v_kind='auction' and manual_transfer_order_id=(v_row->>'id')::uuid) or (v_kind='commerce' and commerce_order_transfer_id=(v_row->>'id')::uuid) or (v_kind='shipping' and shipping_fee_payment_id=(v_row->>'id')::uuid)) and entry_type='receipt' and not exists(select 1 from public.manual_transfer_payment_ledger r where r.reversal_of=l.id) order by created_at desc,id desc limit 1;
      if v_id is not null then insert into public.manual_transfer_payment_ledger(transfer_kind,manual_transfer_order_id,commerce_order_transfer_id,shipping_fee_payment_id,entry_type,amount,memo,reversal_of,recorded_by,idempotency_key) values(v_kind,case when v_kind='auction' then (v_row->>'id')::uuid end,case when v_kind='commerce' then (v_row->>'id')::uuid end,case when v_kind='shipping' then (v_row->>'id')::uuid end,'reversal',v_target,left('owner_restore_adjustment:'||v_reason,500),v_id,v_actor,gen_random_uuid()::text); end if;
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'auctionBids',v_source.before_state->'bids','[]'::jsonb)) loop
    perform set_config('app.fixed_purchase_product_id',v_row->>'product_id',true);
    delete from public.cancelled_auction_bids where original_bid_id=(v_row->>'id')::uuid and cancellation_reason like 'owner_%ledger:%';
    insert into public.auction_bids(id,product_id,bidder_id,bidder_display_name,amount,is_final,created_at)
    values((v_row->>'id')::uuid,(v_row->>'product_id')::uuid,(v_row->>'bidder_id')::uuid,v_row->>'bidder_display_name',(v_row->>'amount')::bigint,coalesce((v_row->>'is_final')::boolean,false),(v_row->>'created_at')::timestamptz)
    on conflict(id) do update set bidder_id=excluded.bidder_id,bidder_display_name=excluded.bidder_display_name,amount=excluded.amount,is_final=excluded.is_final;
  end loop;
  -- Restore the product winner pointers only after their bid rows exist again.
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'products',case when v_source.before_state?'product' then jsonb_build_array(v_source.before_state->'product') else '[]'::jsonb end)) loop
    perform set_config('app.authoritative_bid_product_id',v_row->>'id',true);
    update public.products set status=v_row->>'status',participant_count=(v_row->>'participant_count')::integer,starting_price=(v_row->>'starting_price')::bigint,current_price=(v_row->>'current_price')::bigint,
      bid_history=coalesce(v_row->'bid_history','[]'::jsonb),bid_locked_at=(v_row->>'bid_locked_at')::timestamptz,final_bid_id=(v_row->>'final_bid_id')::uuid,final_bid_amount=(v_row->>'final_bid_amount')::bigint,
      anti_sniping_base_closes_at=(v_row->>'anti_sniping_base_closes_at')::timestamptz,anti_sniping_extended_at=(v_row->>'anti_sniping_extended_at')::timestamptz,anti_sniping_extension_count=coalesce((v_row->>'anti_sniping_extension_count')::integer,0),
      sale_completed_at=(v_row->>'sale_completed_at')::timestamptz,updated_at=v_now where id=(v_row->>'id')::uuid;
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'purchaseOffers','[]'::jsonb)) loop
    update public.auction_purchase_offers set status=v_row->>'status',payment_due_at=(v_row->>'payment_due_at')::timestamptz,display_payment_due_at=(v_row->>'display_payment_due_at')::timestamptz,accepted_at=(v_row->>'accepted_at')::timestamptz,settled_at=(v_row->>'settled_at')::timestamptz,updated_at=v_now where id=(v_row->>'id')::uuid;
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'manualTransfers','[]'::jsonb)) loop
    update public.manual_transfer_orders set status=v_row->>'status',confirmed_at=(v_row->>'confirmed_at')::timestamptz,confirmed_by=(v_row->>'confirmed_by')::uuid,due_at=(v_row->>'due_at')::timestamptz,display_due_at=(v_row->>'display_due_at')::timestamptz,
      cancelled_at=(v_row->>'cancelled_at')::timestamptz,cancellation_reason=v_row->>'cancellation_reason',payment_deadline_held_at=(v_row->>'payment_deadline_held_at')::timestamptz,due_at_before_payment_hold=(v_row->>'due_at_before_payment_hold')::timestamptz,offer_due_at_before_payment_hold=(v_row->>'offer_due_at_before_payment_hold')::timestamptz,version=version+1,updated_at=v_now where id=(v_row->>'id')::uuid;
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'commerceOrders','[]'::jsonb)) loop update public.commerce_orders set status=v_row->>'status',updated_at=v_now where id=(v_row->>'id')::uuid; end loop;
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'commerceItems','[]'::jsonb)) loop update public.commerce_order_items set payment_status=v_row->>'payment_status',paid_at=(v_row->>'paid_at')::timestamptz,storage_expires_at=(v_row->>'storage_expires_at')::timestamptz where id=(v_row->>'id')::uuid; end loop;
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'commerceTransfers','[]'::jsonb)) loop update public.commerce_order_transfers set status=v_row->>'status',confirmed_at=(v_row->>'confirmed_at')::timestamptz,confirmed_by=(v_row->>'confirmed_by')::uuid,cancelled_at=(v_row->>'cancelled_at')::timestamptz,cancelled_by=(v_row->>'cancelled_by')::uuid,cancellation_reason=v_row->>'cancellation_reason',version=version+1 where id=(v_row->>'id')::uuid; end loop;
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'legacyPayments','[]'::jsonb)) loop update public.payment_orders set payment_status=v_row->>'payment_status',portone_status=v_row->>'portone_status',paid_at=(v_row->>'paid_at')::timestamptz,updated_at=v_now where id=(v_row->>'id')::uuid; end loop;

  for v_row in select value from jsonb_array_elements(case
    when jsonb_typeof(v_source.before_state->'inventory')='array' then v_source.before_state->'inventory'
    when jsonb_typeof(v_source.before_state->'inventory')='object' then jsonb_build_array(v_source.before_state->'inventory')
    else '[]'::jsonb end) loop
    update public.customer_inventory_items set ownership_status=v_row->>'ownership_status',storage_duration_days=(v_row->>'storage_duration_days')::integer,storage_started_at=(v_row->>'storage_started_at')::timestamptz,storage_expires_at=(v_row->>'storage_expires_at')::timestamptz,version=version+1,updated_at=v_now where id=(v_row->>'id')::uuid;
  end loop;
  for v_row in select value from jsonb_array_elements(case
    when jsonb_typeof(v_source.before_state->'fulfillments')='array' then v_source.before_state->'fulfillments'
    when jsonb_typeof(v_source.before_state->'fulfillment')='object' then jsonb_build_array(v_source.before_state->'fulfillment')
    else '[]'::jsonb end) loop
    update public.inventory_item_fulfillments set current_stage=v_row->>'current_stage',location_kind=v_row->>'location_kind',storage_location_code=v_row->>'storage_location_code',outbound_released=coalesce((v_row->>'outbound_released')::boolean,false),is_blocked=coalesce((v_row->>'is_blocked')::boolean,false),block_reason=v_row->>'block_reason',version=version+1,last_event_at=v_now,updated_at=v_now where inventory_item_id=(v_row->>'inventory_item_id')::uuid;
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'shipmentItems',v_source.before_state->'items','[]'::jsonb)) loop
    update public.inventory_shipment_items set line_status=v_row->>'line_status',excluded_reason=v_row->>'excluded_reason',updated_at=v_now where shipment_id=(v_row->>'shipment_id')::uuid and inventory_item_id=(v_row->>'inventory_item_id')::uuid;
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'shipmentWorks','[]'::jsonb)) loop update public.inventory_shipment_store_works set status=v_row->>'status',completed_at=(v_row->>'completed_at')::timestamptz,completed_by=(v_row->>'completed_by')::uuid,version=version+1,updated_at=v_now where id=(v_row->>'id')::uuid; end loop;
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'shipments',case when v_source.before_state?'shipment' then jsonb_build_array(v_source.before_state->'shipment') else '[]'::jsonb end)) loop
    update public.inventory_shipments set status=v_row->>'status',courier=v_row->>'courier',tracking_number=v_row->>'tracking_number',packed_at=(v_row->>'packed_at')::timestamptz,packed_by=(v_row->>'packed_by')::uuid,shipped_at=(v_row->>'shipped_at')::timestamptz,shipped_by=(v_row->>'shipped_by')::uuid,cancelled_at=(v_row->>'cancelled_at')::timestamptz,cancellation_reason=v_row->>'cancellation_reason',delivery_status=coalesce(v_row->>'delivery_status','pending'),delivery_status_text=v_row->>'delivery_status_text',tracking_checked_at=(v_row->>'tracking_checked_at')::timestamptz,tracking_error=v_row->>'tracking_error',delivered_at=(v_row->>'delivered_at')::timestamptz,auto_settle_at=(v_row->>'auto_settle_at')::timestamptz,settlement_status=coalesce(v_row->>'settlement_status','pending'),version=version+1,updated_at=v_now where id=(v_row->>'id')::uuid;
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'shippingFeePayments','[]'::jsonb)) loop update public.shipping_fee_payments set status=v_row->>'status',confirmed_at=(v_row->>'confirmed_at')::timestamptz,confirmed_by=(v_row->>'confirmed_by')::uuid,version=version+1 where id=(v_row->>'id')::uuid; end loop;

  for v_row in select value from jsonb_array_elements(coalesce(v_source.before_state->'financialBalances','[]'::jsonb)) loop
    v_id:=(v_row->>'inventory_item_id')::uuid; v_target:=(v_row->>'balance')::bigint;
    select coalesce(sum(amount),0)::bigint into v_current from public.store_financial_entries where inventory_item_id=v_id; v_delta:=v_target-v_current;
    if v_delta<>0 then
      insert into public.store_financial_entries(business_id,origin_store_id,inventory_item_id,entry_kind,amount,occurred_at,idempotency_key,metadata)
      select i.business_id,i.origin_store_id,i.id,case when v_delta>0 then 'item_payment' else 'payment_reversal' end,v_delta,v_now,gen_random_uuid(),jsonb_build_object('reason','owner_restore','sourceEventId',p_event_id) from public.customer_inventory_items i where i.id=v_id;
    end if;
  end loop;
  if v_source.before_state?'shippingCreditCount' then
    select shipping_credit_count into v_current from public.member_accounts where member_id=v_member; v_target:=(v_source.before_state->>'shippingCreditCount')::bigint; v_delta:=v_target-v_current;
    if v_delta<>0 then insert into public.shipping_credit_ledger(member_id,delta,reason,created_by) values(v_member,v_delta::integer,'adjustment',v_actor); end if;
  end if;

  v_after:=v_source.before_state;
  v_result:=jsonb_build_object('action','restore_audit_event','sourceEventId',p_event_id,'entityId',v_source.entity_id,'status','restored','idempotentReplay',false);
  insert into public.owner_ledger_repair_events(actor_owner_id,member_id,action,entity_type,entity_id,product_id,reason,idempotency_key,request_fingerprint,before_state,after_state,result)
  values(v_actor,v_member,'restore_audit_event',v_source.entity_type,v_source.entity_id,v_source.product_id,v_reason,p_idempotency_key,v_fp,v_before,v_after,v_result);
  perform app_private.write_security_activity(v_actor,v_member,'commerce','owner_ledger_restore','restore_audit_event','owner_restore_ledger_repair_event',v_source.entity_type,v_source.entity_id::text,'critical',null,null,jsonb_build_object('sourceEventId',p_event_id,'reason',v_reason));
  return v_result;
end;
$$;
revoke all on function public.owner_restore_ledger_repair_event(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_restore_ledger_repair_event(uuid,text,uuid) to authenticated;

comment on function public.owner_force_ledger_rollback(text,uuid,bigint,text,uuid) is
  'Grade-zero Owner-only atomic rollback of buyer/seller platform state. Physical delivery and bank movement remain external actions; immutable money history is compensated, never erased.';
comment on function public.owner_restore_ledger_repair_event(uuid,text,uuid) is
  'Grade-zero Owner-only restoration from an append-only repair snapshot, with conflict detection and a new reversal audit event.';

commit;
