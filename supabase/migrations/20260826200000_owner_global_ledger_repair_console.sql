begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';

create table public.owner_ledger_repair_events (
  id uuid primary key default gen_random_uuid(),
  actor_owner_id uuid not null references public.profiles(id) on delete restrict,
  member_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in (
    'cancel_bid',
    'update_auction_due_at',
    'cancel_inventory_item',
    'restore_inventory_item',
    'update_storage_duration',
    'cancel_shipment',
    'correct_shipment_tracking'
  )),
  entity_type text not null check (entity_type in ('auction_bid', 'auction_payment', 'inventory_item', 'shipment')),
  entity_id uuid not null,
  product_id uuid references public.products(id) on delete set null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (actor_owner_id, idempotency_key)
);

create index owner_ledger_repair_events_member_time_idx
  on public.owner_ledger_repair_events(member_id, occurred_at desc, id);
create index owner_ledger_repair_events_entity_time_idx
  on public.owner_ledger_repair_events(entity_type, entity_id, occurred_at desc, id);

alter table public.owner_ledger_repair_events enable row level security;
alter table public.owner_ledger_repair_events force row level security;
revoke all on table public.owner_ledger_repair_events from public, anon, authenticated, service_role;
grant select on table public.owner_ledger_repair_events to authenticated, service_role;

create policy "Owners read ledger repair events"
on public.owner_ledger_repair_events for select to authenticated
using ((select public.is_owner()));

create policy "Service reads ledger repair events"
on public.owner_ledger_repair_events for select to service_role
using (true);

create trigger owner_ledger_repair_events_append_only
before update or delete or truncate on public.owner_ledger_repair_events
for each statement execute function app_private.reject_inventory_v2_append_only_mutation();

-- Payment and routing identity remains immutable. Owners may change only the
-- storage-duration snapshot through the audited RPC below; authenticated users
-- still have no direct UPDATE grant on this table.
create or replace function app_private.guard_inventory_item_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.member_id, old.business_id, old.origin_store_id, old.product_id,
      old.source_kind,
      old.commerce_order_item_id, old.manual_transfer_order_id, old.legacy_payment_order_id,
      old.paid_amount, old.currency, old.paid_at, old.storage_class_snapshot,
      old.work_due_date)
    is distinct from
    row(new.member_id, new.business_id, new.origin_store_id, new.product_id,
      new.source_kind,
      new.commerce_order_item_id, new.manual_transfer_order_id, new.legacy_payment_order_id,
      new.paid_amount, new.currency, new.paid_at, new.storage_class_snapshot,
      new.work_due_date)
  then
    raise exception using errcode = '55000', message = '결제 시점의 보관 상품 스냅샷은 변경할 수 없습니다.';
  end if;
  if old.storage_duration_days is distinct from new.storage_duration_days
    and not public.is_owner()
  then
    raise exception using errcode = '42501', message = '보관 기간 정정은 소유자 복구 원장에서만 가능합니다.';
  end if;
  if old.fulfillment_center_id is not null
    and row(old.fulfillment_center_id,old.route_mode,old.route_version)
      is distinct from row(new.fulfillment_center_id,new.route_mode,new.route_version)
  then
    raise exception using errcode='55000',message='확정된 출고 경로 스냅샷은 변경할 수 없습니다.';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function app_private.guard_inventory_item_snapshot()
from public,anon,authenticated,service_role;

create or replace function public.owner_repair_global_ledger(
  p_action text,
  p_entity_id uuid,
  p_expected_version bigint,
  p_payload jsonb,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_fingerprint text;
  v_existing public.owner_ledger_repair_events%rowtype;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_result jsonb := '{}'::jsonb;
  v_member uuid;
  v_product_id uuid;
  v_entity_type text;
  v_product public.products%rowtype;
  v_bid public.auction_bids%rowtype;
  v_top public.auction_bids%rowtype;
  v_manual public.manual_transfer_orders%rowtype;
  v_inventory public.customer_inventory_items%rowtype;
  v_fulfillment public.inventory_item_fulfillments%rowtype;
  v_shipment public.inventory_shipments%rowtype;
  v_count integer;
  v_history jsonb;
  v_received bigint;
  v_duration integer;
  v_due_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_previous_event public.owner_ledger_repair_events%rowtype;
  v_previous_stage text;
  v_previous_location text;
  v_previous_blocked boolean;
  v_previous_block_reason text;
  v_previous_storage_code text;
  v_previous_outbound_released boolean;
  v_courier text;
  v_tracking text;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_action not in (
    'cancel_bid', 'update_auction_due_at', 'cancel_inventory_item',
    'restore_inventory_item', 'update_storage_duration', 'cancel_shipment',
    'correct_shipment_tracking'
  ) or p_entity_id is null or p_idempotency_key is null
    or jsonb_typeof(v_payload) <> 'object'
    or char_length(v_reason) not between 3 and 500
  then
    raise exception using errcode = '22023', message = '원장 복구 입력값을 확인해 주세요.';
  end if;

  v_fingerprint := encode(extensions.digest(
    convert_to(jsonb_build_object(
      'action', p_action,
      'entityId', p_entity_id,
      'expectedVersion', p_expected_version,
      'payload', v_payload,
      'reason', v_reason
    )::text, 'UTF8'),
    'sha256'
  ), 'hex');

  select * into v_existing
  from public.owner_ledger_repair_events
  where actor_owner_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = '같은 요청 키를 다른 원장 복구에 재사용할 수 없습니다.';
    end if;
    return v_existing.result || jsonb_build_object('idempotentReplay', true);
  end if;

  if p_action = 'cancel_bid' then
    select * into v_bid from public.auction_bids where id = p_entity_id;
    if not found then raise exception using errcode = 'P0002', message = '입찰을 찾지 못했습니다.'; end if;
    select * into v_product from public.products where id = v_bid.product_id for update;
    if not found then raise exception using errcode = 'P0002', message = '경매 상품을 찾지 못했습니다.'; end if;
    perform 1 from public.auction_bids where product_id = v_product.id order by id for update;
    v_member := v_bid.bidder_id;
    v_product_id := v_product.id;
    v_entity_type := 'auction_bid';
    v_before := jsonb_build_object(
      'product', to_jsonb(v_product),
      'bids', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at, b.id) from public.auction_bids b where b.product_id=v_product.id and b.bidder_id is not distinct from v_bid.bidder_id), '[]'::jsonb)
    );

    if v_product.status = 'active' then
      v_result := public.operator_cancel_auction_bid(p_entity_id, v_reason);
    elsif v_product.status = 'closed' then
      if v_bid.bidder_id is null then
        raise exception using errcode = '55000', message = '탈퇴 회원의 마감 입찰은 직접 복구할 수 없습니다.';
      end if;
      select coalesce(sum(case when ledger.entry_type='receipt' then ledger.amount else -ledger.amount end),0)::bigint
      into v_received
      from public.manual_transfer_payment_ledger ledger
      join public.manual_transfer_orders orders on orders.id=ledger.manual_transfer_order_id
      where orders.product_id=v_product.id and orders.buyer_id=v_bid.bidder_id;
      if coalesce(v_received,0) <> 0 or exists (
        select 1 from public.customer_inventory_items items
        where items.product_id=v_product.id and items.member_id=v_bid.bidder_id
          and items.ownership_status in ('active','refund_pending')
      ) then
        raise exception using errcode='55000', message='입금 또는 보관 권리가 있는 낙찰은 환불 절차로 처리해 주세요.';
      end if;

      select * into v_manual from public.manual_transfer_orders
      where product_id=v_product.id and buyer_id=v_bid.bidder_id
        and status='awaiting_manual_transfer'
      order by requested_at desc, id desc limit 1 for update;
      if found then
        update public.manual_transfer_orders
        set status='cancelled_unpaid', cancelled_at=v_now,
            cancellation_reason=left('owner_repair:' || v_reason, 200),
            version=version+1
        where id=v_manual.id;
        update public.auction_purchase_offers
        set status='expired_unpaid', updated_at=v_now
        where id=v_manual.purchase_offer_id and status in ('payment_due','accepted','offered');
      end if;

      update public.products set bid_locked_at=null, final_bid_id=null, final_bid_amount=null, updated_at=v_now
      where id=v_product.id and final_bid_id in (
        select id from public.auction_bids where product_id=v_product.id and bidder_id=v_bid.bidder_id
      );
      insert into public.cancelled_auction_bids(
        original_bid_id, product_id, bidder_id, bidder_display_name, amount,
        original_created_at, was_final, cancelled_at, cancellation_reason
      )
      select id, product_id, bidder_id, bidder_display_name, amount, created_at,
             is_final, v_now, left('owner_ledger_repair:' || v_reason, 500)
      from public.auction_bids
      where product_id=v_product.id and bidder_id=v_bid.bidder_id
      on conflict (original_bid_id) do nothing;
      delete from public.auction_bids
      where product_id=v_product.id and bidder_id=v_bid.bidder_id;

      select * into v_top from public.auction_bids
      where product_id=v_product.id order by amount desc, created_at, id limit 1;
      select count(distinct bidder_id)::integer into v_count
      from public.auction_bids where product_id=v_product.id and bidder_id is not null;
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id, 'bidAt', h.bid_at, 'bidderName', h.bidder_name,
        'amount', h.amount, 'outcome', h.outcome
      ) order by h.bid_at desc, h.id desc), '[]'::jsonb) into v_history
      from (
        select id::text, created_at bid_at, bidder_display_name bidder_name, amount, 'active'::text outcome
        from public.auction_bids where product_id=v_product.id
        union all
        select original_bid_id::text, original_created_at, bidder_display_name, amount, 'cancelled'::text
        from public.cancelled_auction_bids where product_id=v_product.id
      ) h;
      update public.auction_bids set is_final=false where product_id=v_product.id and is_final;
      update public.products
      set current_price=coalesce(v_top.amount, starting_price),
          participant_count=coalesce(v_count,0), bid_history=v_history,
          bid_locked_at=null, final_bid_id=null, final_bid_amount=null, updated_at=v_now
      where id=v_product.id;
      v_result := jsonb_build_object(
        'action', p_action, 'entityId', p_entity_id, 'productId', v_product.id,
        'status', 'cancelled', 'nextBidId', v_top.id, 'nextAmount', v_top.amount,
        'requiresAuctionResolution', true, 'idempotentReplay', false
      );
    else
      raise exception using errcode='55000', message='진행 중이거나 마감된 경매 입찰만 취소할 수 있습니다.';
    end if;
    select jsonb_build_object(
      'product', to_jsonb(p),
      'remainingBids', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at,b.id) from public.auction_bids b where b.product_id=p.id), '[]'::jsonb)
    ) into v_after from public.products p where p.id=v_product.id;

  elsif p_action = 'update_auction_due_at' then
    v_due_at := nullif(v_payload->>'dueAt','')::timestamptz;
    if v_due_at is null or v_due_at < v_now or v_due_at > v_now + interval '30 days' then
      raise exception using errcode='22023', message='결제 마감은 현재부터 30일 이내로 입력해 주세요.';
    end if;
    select * into v_manual from public.manual_transfer_orders where id=p_entity_id for update;
    if not found then raise exception using errcode='P0002', message='낙찰 결제 원장을 찾지 못했습니다.'; end if;
    if v_manual.status <> 'awaiting_manual_transfer' or v_manual.version is distinct from p_expected_version then
      raise exception using errcode='PT409', message='결제 상태 또는 버전이 변경되었습니다.';
    end if;
    v_member:=v_manual.buyer_id; v_product_id:=v_manual.product_id; v_entity_type:='auction_payment';
    v_before:=jsonb_build_object('manualTransfer',to_jsonb(v_manual));
    update public.manual_transfer_orders
    set due_at=v_due_at, display_due_at=v_due_at, version=version+1, updated_at=v_now
    where id=v_manual.id returning * into v_manual;
    update public.auction_purchase_offers
    set payment_due_at=v_due_at, updated_at=v_now
    where id=v_manual.purchase_offer_id and status in ('payment_due','accepted');
    v_after:=jsonb_build_object('manualTransfer',to_jsonb(v_manual));
    v_result:=jsonb_build_object('action',p_action,'entityId',p_entity_id,'dueAt',v_due_at,'version',v_manual.version,'idempotentReplay',false);

  elsif p_action in ('cancel_inventory_item','restore_inventory_item','update_storage_duration') then
    select * into v_inventory from public.customer_inventory_items where id=p_entity_id for update;
    if not found then raise exception using errcode='P0002', message='보관 상품을 찾지 못했습니다.'; end if;
    select * into v_fulfillment from public.inventory_item_fulfillments where inventory_item_id=p_entity_id for update;
    if not found then raise exception using errcode='P0002', message='보관 이행 상태를 찾지 못했습니다.'; end if;
    if v_inventory.version is distinct from p_expected_version then
      raise exception using errcode='PT409', message='보관 상품 상태가 변경되었습니다.';
    end if;
    v_member:=v_inventory.member_id; v_product_id:=v_inventory.product_id; v_entity_type:='inventory_item';
    v_before:=jsonb_build_object('inventory',to_jsonb(v_inventory),'fulfillment',to_jsonb(v_fulfillment));

    if p_action='cancel_inventory_item' then
      if v_inventory.ownership_status not in ('active','refund_pending') or v_fulfillment.current_stage in ('packed','shipped')
        or exists(select 1 from public.inventory_shipment_items si join public.inventory_shipments s on s.id=si.shipment_id where si.inventory_item_id=v_inventory.id and s.status in ('packed','shipped'))
      then raise exception using errcode='55000', message='포장·발송 이후 상품은 배송 예외 또는 환불 절차로 처리해 주세요.'; end if;
      update public.inventory_shipment_items
      set line_status='cancelled', excluded_reason=v_reason, updated_at=v_now
      where inventory_item_id=v_inventory.id and line_status in ('requested','held','ready');
      perform app_private.refresh_inventory_shipment_status(active_lines.shipment_id, gen_random_uuid())
      from (
        select distinct shipment_id
        from public.inventory_shipment_items
        where inventory_item_id=v_inventory.id
      ) active_lines;
      update public.customer_inventory_items
      set ownership_status='cancelled', version=version+1, updated_at=v_now
      where id=v_inventory.id returning * into v_inventory;
      update public.inventory_item_fulfillments
      set current_stage='cancelled', location_kind='unknown', is_blocked=false,
          block_reason=null, storage_location_code=null, outbound_released=false,
          version=version+1, last_event_at=v_now, updated_at=v_now
      where inventory_item_id=v_inventory.id returning * into v_fulfillment;
    elsif p_action='restore_inventory_item' then
      if v_inventory.ownership_status <> 'cancelled' or v_fulfillment.current_stage <> 'cancelled'
        or exists(select 1 from public.customer_inventory_items i where i.product_id=v_inventory.product_id and i.id<>v_inventory.id and i.ownership_status in ('active','refund_pending'))
      then raise exception using errcode='55000', message='소유자 복구로 취소된 단독 보관 상품만 복원할 수 있습니다.'; end if;
      select * into v_previous_event from public.owner_ledger_repair_events
      where entity_type='inventory_item' and entity_id=v_inventory.id and action='cancel_inventory_item'
      order by occurred_at desc,id desc limit 1;
      if not found then raise exception using errcode='55000', message='복원할 취소 감사 기록이 없습니다.'; end if;
      v_previous_stage:=coalesce(v_previous_event.before_state#>>'{fulfillment,current_stage}','entitled');
      if v_previous_stage in ('packed','shipped','cancelled') then v_previous_stage:='entitled'; end if;
      v_previous_location:=coalesce(v_previous_event.before_state#>>'{fulfillment,location_kind}','store');
      v_previous_blocked:=coalesce((v_previous_event.before_state#>>'{fulfillment,is_blocked}')::boolean,false);
      v_previous_block_reason:=v_previous_event.before_state#>>'{fulfillment,block_reason}';
      v_previous_storage_code:=v_previous_event.before_state#>>'{fulfillment,storage_location_code}';
      v_previous_outbound_released:=coalesce((v_previous_event.before_state#>>'{fulfillment,outbound_released}')::boolean,false);
      update public.customer_inventory_items set ownership_status='active',version=version+1,updated_at=v_now
      where id=v_inventory.id returning * into v_inventory;
      update public.inventory_item_fulfillments
      set current_stage=v_previous_stage,location_kind=v_previous_location,is_blocked=v_previous_blocked,
          block_reason=v_previous_block_reason,storage_location_code=case when v_previous_stage='center_stored' then v_previous_storage_code else null end,
          outbound_released=v_previous_outbound_released,version=version+1,last_event_at=v_now,updated_at=v_now
      where inventory_item_id=v_inventory.id returning * into v_fulfillment;
    else
      v_duration:=nullif(v_payload->>'storageDurationDays','')::integer;
      if v_duration not in (7,14) or v_inventory.storage_started_at is null then
        raise exception using errcode='22023', message='보관 시작 상품의 기간은 7일 또는 14일로만 변경할 수 있습니다.';
      end if;
      update public.customer_inventory_items
      set storage_duration_days=v_duration,
          storage_expires_at=storage_started_at+make_interval(days=>v_duration),
          version=version+1,updated_at=v_now
      where id=v_inventory.id returning * into v_inventory;
    end if;
    v_after:=jsonb_build_object('inventory',to_jsonb(v_inventory),'fulfillment',to_jsonb(v_fulfillment));
    v_result:=jsonb_build_object('action',p_action,'entityId',p_entity_id,'status',v_inventory.ownership_status,'version',v_inventory.version,'idempotentReplay',false);

  elsif p_action in ('cancel_shipment','correct_shipment_tracking') then
    perform app_private.lock_inventory_shipment(p_entity_id);
    select * into v_shipment from public.inventory_shipments where id=p_entity_id for update;
    if not found then raise exception using errcode='P0002', message='배송 원장을 찾지 못했습니다.'; end if;
    if v_shipment.version is distinct from p_expected_version then
      raise exception using errcode='PT409', message='배송 상태가 변경되었습니다.';
    end if;
    v_member:=v_shipment.member_id; v_entity_type:='shipment';
    select product_id into v_product_id from public.inventory_shipment_items where shipment_id=v_shipment.id order by product_id limit 1;
    v_before:=jsonb_build_object(
      'shipment',to_jsonb(v_shipment),
      'items',coalesce((select jsonb_agg(to_jsonb(si) order by si.product_id,si.inventory_item_id) from public.inventory_shipment_items si where si.shipment_id=v_shipment.id),'[]'::jsonb)
    );
    if p_action='cancel_shipment' then
      if v_shipment.status in ('packed','shipped','cancelled') then
        raise exception using errcode='55000', message='포장·발송 완료 배송은 취소 대신 배송 예외를 사용해 주세요.';
      end if;
      update public.inventory_shipment_items
      set line_status='cancelled',excluded_reason=v_reason,updated_at=v_now
      where shipment_id=v_shipment.id and line_status not in ('excluded','cancelled','shipped');
      update public.inventory_item_fulfillments f
      set current_stage=case when f.outbound_released then 'center_stored' else 'entitled' end,
          location_kind=case when f.outbound_released then 'center' else 'store' end,
          is_blocked=false,block_reason=null,version=f.version+1,last_event_at=v_now,updated_at=v_now
      where f.inventory_item_id in (select inventory_item_id from public.inventory_shipment_items where shipment_id=v_shipment.id)
        and f.current_stage not in ('packed','shipped','cancelled');
      perform app_private.refresh_inventory_shipment_status(v_shipment.id,p_idempotency_key);
      select * into v_shipment from public.inventory_shipments where id=p_entity_id;
    else
      v_courier:=btrim(coalesce(v_payload->>'courier',''));
      v_tracking:=btrim(coalesce(v_payload->>'trackingNumber',''));
      if v_shipment.status<>'shipped' or char_length(v_courier) not between 1 and 80
        or char_length(v_tracking) not between 1 and 120 or v_courier ~ '[[:cntrl:]]' or v_tracking ~ '[[:cntrl:]]'
      then raise exception using errcode='22023', message='발송 완료 배송의 택배사와 운송장 번호를 확인해 주세요.'; end if;
      update public.inventory_shipments
      set courier=v_courier,tracking_number=v_tracking,tracking_checked_at=null,
          tracking_error=null,version=version+1,updated_at=v_now
      where id=v_shipment.id returning * into v_shipment;
      insert into public.inventory_shipment_events(
        shipment_id,sequence_no,event_type,from_status,to_status,actor_kind,actor_user_id,
        idempotency_key,reason,metadata
      ) values (
        v_shipment.id,coalesce((select max(sequence_no)+1 from public.inventory_shipment_events where shipment_id=v_shipment.id),1),
        'tracking_updated','shipped','shipped','user',v_actor,p_idempotency_key,v_reason,
        jsonb_build_object('courier',v_courier,'trackingNumber',v_tracking)
      );
    end if;
    v_after:=jsonb_build_object(
      'shipment',to_jsonb(v_shipment),
      'items',coalesce((select jsonb_agg(to_jsonb(si) order by si.product_id,si.inventory_item_id) from public.inventory_shipment_items si where si.shipment_id=v_shipment.id),'[]'::jsonb)
    );
    v_result:=jsonb_build_object('action',p_action,'entityId',p_entity_id,'status',v_shipment.status,'version',v_shipment.version,'idempotentReplay',false);
  end if;

  insert into public.owner_ledger_repair_events(
    actor_owner_id,member_id,action,entity_type,entity_id,product_id,reason,
    idempotency_key,request_fingerprint,before_state,after_state,result
  ) values (
    v_actor,v_member,p_action,v_entity_type,p_entity_id,v_product_id,v_reason,
    p_idempotency_key,v_fingerprint,v_before,v_after,v_result
  );

  perform app_private.write_security_activity(
    v_actor,v_member,'commerce','owner_ledger_repair',p_action,
    'owner_repair_global_ledger',v_entity_type,p_entity_id::text,'warning',
    null,null,jsonb_build_object('reason',v_reason,'productId',v_product_id)
  );
  return v_result;
end;
$$;

revoke all on function public.owner_repair_global_ledger(text,uuid,bigint,jsonb,text,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.owner_repair_global_ledger(text,uuid,bigint,jsonb,text,uuid)
to authenticated;

comment on table public.owner_ledger_repair_events is
  'Append-only before/after snapshots for owner corrections to member commerce, inventory, and shipment ledgers.';
comment on function public.owner_repair_global_ledger(text,uuid,bigint,jsonb,text,uuid) is
  'Owner-only atomic repair surface. Financial receipts remain append-only; member-visible obligations and fulfillment projections are corrected with audit snapshots.';

commit;
