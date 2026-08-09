begin;

set local lock_timeout = '10s';

create table public.commerce_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid references public.commerce_order_items(id) on delete restrict,
  inventory_item_id uuid references public.customer_inventory_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  order_id uuid references public.commerce_orders(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  origin_store_id uuid not null references public.stores(id) on delete restrict,
  sale_type text not null check (sale_type in ('fixed', 'auction')),
  requested_by text not null check (requested_by in ('buyer', 'store')),
  requested_by_user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null check (status in (
    'requested_by_buyer', 'requested_by_store', 'awaiting_counterparty',
    'owner_attention_required', 'accepted', 'rejected',
    'expired_auto_accepted', 'refund_pending', 'completed'
  )),
  reason_code text not null check (reason_code in (
    'buyer_changed_mind', 'duplicate_order', 'wrong_item',
    'offline_sale', 'condition_changed', 'lost', 'inventory_error', 'other'
  )),
  reason_detail text not null check (char_length(btrim(reason_detail)) between 3 and 500),
  response_due_at timestamptz not null,
  responded_at timestamptz,
  responded_by uuid references public.profiles(id) on delete restrict,
  refund_amount bigint check (refund_amount is null or refund_amount > 0),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (num_nonnulls(order_item_id, inventory_item_id) >= 1),
  check (requested_by <> 'buyer' or sale_type = 'fixed')
);

create unique index commerce_cancellation_requests_one_active_item_idx
on public.commerce_cancellation_requests(product_id)
where status in (
  'requested_by_buyer', 'requested_by_store', 'awaiting_counterparty',
  'owner_attention_required', 'accepted', 'expired_auto_accepted', 'refund_pending'
);

create table public.commerce_cancellation_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.commerce_cancellation_requests(id) on delete restrict,
  event_kind text not null,
  actor_user_id uuid references public.profiles(id) on delete restrict,
  from_status text,
  to_status text not null,
  idempotency_key uuid not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp(),
  unique(actor_user_id, idempotency_key)
);

create table public.auction_store_cancellation_penalties (
  cancellation_request_id uuid primary key references public.commerce_cancellation_requests(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  default_points integer not null check (default_points between 0 and 100),
  applied_points integer not null check (applied_points between 0 and 100),
  adjusted_by uuid references public.profiles(id) on delete restrict,
  adjustment_reason text,
  adjusted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check ((adjusted_by is null and adjustment_reason is null and adjusted_at is null)
    or (adjusted_by is not null and char_length(btrim(adjustment_reason)) between 3 and 500 and adjusted_at is not null))
);

alter table public.commerce_cancellation_requests enable row level security;
alter table public.commerce_cancellation_requests force row level security;
alter table public.commerce_cancellation_events enable row level security;
alter table public.commerce_cancellation_events force row level security;
alter table public.auction_store_cancellation_penalties enable row level security;
alter table public.auction_store_cancellation_penalties force row level security;

revoke all on table public.commerce_cancellation_requests,
  public.commerce_cancellation_events,
  public.auction_store_cancellation_penalties
from public, anon, authenticated, service_role;
grant select on table public.commerce_cancellation_requests to authenticated, service_role;
grant select on table public.commerce_cancellation_events to authenticated, service_role;
grant select on table public.auction_store_cancellation_penalties to authenticated, service_role;

create policy "Participants read cancellation requests"
on public.commerce_cancellation_requests for select to authenticated
using (
  buyer_id = auth.uid() or public.is_owner()
  or public.has_store_permission(origin_store_id, 'prepare_orders')
);
create policy "Participants read cancellation events"
on public.commerce_cancellation_events for select to authenticated
using (exists (
  select 1 from public.commerce_cancellation_requests requests
  where requests.id = request_id and (
    requests.buyer_id = auth.uid() or public.is_owner()
    or public.has_store_permission(requests.origin_store_id, 'prepare_orders')
  )
));
create policy "Authorized users read cancellation penalties"
on public.auction_store_cancellation_penalties for select to authenticated
using (public.is_owner() or public.has_store_permission(store_id, 'prepare_orders'));

create policy "Service reads cancellation requests"
on public.commerce_cancellation_requests for select to service_role using (true);
create policy "Service reads cancellation events"
on public.commerce_cancellation_events for select to service_role using (true);
create policy "Service reads cancellation penalties"
on public.auction_store_cancellation_penalties for select to service_role using (true);

comment on table public.commerce_cancellation_events is
  'Append-only cancellation audit; accepted requests move to refund ledgers without rewriting payment history.';

create or replace function public.request_commerce_cancellation(
  p_product_id uuid,
  p_requested_by text,
  p_reason_code text,
  p_reason_detail text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products%rowtype;
  v_order_item public.commerce_order_items%rowtype;
  v_order public.commerce_orders%rowtype;
  v_inventory public.customer_inventory_items%rowtype;
  v_request public.commerce_cancellation_requests%rowtype;
  v_buyer uuid;
  v_status text;
  v_replay jsonb;
begin
  if v_actor is null or p_idempotency_key is null
    or p_requested_by not in ('buyer', 'store')
    or char_length(btrim(coalesce(p_reason_detail, ''))) not between 3 and 500
  then
    raise exception using errcode = '22023', message = '취소 요청 입력값을 확인해 주세요.';
  end if;
  select jsonb_build_object('id', requests.id, 'status', requests.status,
    'responseDueAt', requests.response_due_at, 'version', requests.version)
  into v_replay
  from public.commerce_cancellation_events events
  join public.commerce_cancellation_requests requests on requests.id=events.request_id
  where events.actor_user_id=v_actor and events.idempotency_key=p_idempotency_key;
  if v_replay is not null then return v_replay; end if;
  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception using errcode = 'P0002', message = '상품을 찾지 못했습니다.'; end if;

  select items.* into v_order_item
  from public.commerce_order_items as items
  join public.commerce_orders as orders on orders.id = items.order_id
  where items.product_id = p_product_id
    and items.payment_status not in ('cancelled', 'refunded')
  order by items.created_at desc limit 1 for update of items;
  if found then
    select * into v_order from public.commerce_orders where id = v_order_item.order_id for update;
    v_buyer := v_order.member_id;
  end if;
  select * into v_inventory
  from public.customer_inventory_items
  where product_id = p_product_id and ownership_status = 'active'
  order by paid_at desc limit 1 for update;
  if v_buyer is null and found then v_buyer := v_inventory.member_id; end if;
  if v_buyer is null then raise exception using errcode = 'P0002', message = '취소할 판매 항목을 찾지 못했습니다.'; end if;

  if p_requested_by = 'buyer' then
    if v_actor <> v_buyer then raise exception using errcode = '42501', message = '구매자 본인만 취소를 요청할 수 있습니다.'; end if;
    if v_product.sale_type <> 'fixed' then raise exception using errcode = '42501', message = '경매 낙찰자는 취소를 요청할 수 없습니다.'; end if;
    v_status := 'requested_by_buyer';
  else
    if not public.is_owner() and not public.has_store_permission(v_product.store_id, 'prepare_orders') then
      raise exception using errcode = '42501', message = '판매 매장 취소 권한이 없습니다.';
    end if;
    v_status := 'requested_by_store';
  end if;

  if exists (
    select 1 from public.inventory_shipment_items as shipment_items
    join public.inventory_shipments as shipments on shipments.id = shipment_items.shipment_id
    where shipment_items.product_id = p_product_id
      and shipments.status in ('packed', 'shipped')
  ) then
    raise exception using errcode = '55000', message = '송장 등록 이후에는 배송 예외 또는 환불 절차를 이용해 주세요.';
  end if;

  insert into public.commerce_cancellation_requests(
    order_item_id, inventory_item_id, product_id, order_id, buyer_id,
    origin_store_id, sale_type, requested_by, requested_by_user_id,
    status, reason_code, reason_detail, response_due_at
  ) values (
    v_order_item.id, v_inventory.id, p_product_id, v_order_item.order_id, v_buyer,
    v_product.store_id, v_product.sale_type, p_requested_by, v_actor,
    v_status, p_reason_code, btrim(p_reason_detail), clock_timestamp() + interval '12 hours'
  ) returning * into v_request;

  insert into public.commerce_cancellation_events(
    request_id, event_kind, actor_user_id, to_status, idempotency_key, reason
  ) values (v_request.id, 'requested', v_actor, v_status, p_idempotency_key, btrim(p_reason_detail));

  if v_inventory.id is not null then
    update public.inventory_item_fulfillments
    set is_blocked = true, blocked_reason = 'active_cancellation_request',
        version = version + 1, updated_at = clock_timestamp()
    where inventory_item_id = v_inventory.id;
  end if;
  if v_product.sale_type = 'auction' and p_requested_by = 'store' then
    insert into public.auction_store_cancellation_penalties(
      cancellation_request_id, store_id, default_points, applied_points
    ) values (v_request.id, v_product.store_id, 10, 10);
  end if;
  if p_requested_by='store' then
    perform app_private.insert_targeted_notification(v_buyer,'member','cancellation_requested',
      '판매 매장에서 취소를 요청했습니다.','12시간 안에 수락 또는 거절해 주세요.','/account/orders');
  else
    perform app_private.insert_staff_notifications(v_product.business_id,null,'cancellation_requested',
      '구매자가 취소를 요청했습니다.','12시간 안에 취소 요청을 검토해 주세요.','/admin/operator/orders');
  end if;
  return jsonb_build_object('id', v_request.id, 'status', v_request.status,
    'responseDueAt', v_request.response_due_at, 'version', v_request.version);
end;
$$;

revoke all on function public.request_commerce_cancellation(uuid,text,text,text,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.request_commerce_cancellation(uuid,text,text,text,uuid) to authenticated;

create or replace function public.respond_commerce_cancellation(
  p_request_id uuid,
  p_accept boolean,
  p_expected_version bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.commerce_cancellation_requests%rowtype;
  v_next text;
  v_replay jsonb;
begin
  if v_actor is null or p_idempotency_key is null then raise exception using errcode='22023',message='취소 응답을 확인해 주세요.'; end if;
  select jsonb_build_object('id',requests.id,'status',requests.status,'version',requests.version)
  into v_replay from public.commerce_cancellation_events events
  join public.commerce_cancellation_requests requests on requests.id=events.request_id
  where events.actor_user_id=v_actor and events.idempotency_key=p_idempotency_key;
  if v_replay is not null then return v_replay; end if;
  select * into v_request from public.commerce_cancellation_requests where id=p_request_id for update;
  if not found then raise exception using errcode='P0002',message='취소 요청을 찾지 못했습니다.'; end if;
  if v_request.version<>p_expected_version or v_request.status not in ('requested_by_buyer','requested_by_store','awaiting_counterparty') then
    raise exception using errcode='PT409',message='취소 요청 상태가 변경되었습니다.';
  end if;
  if (v_request.requested_by='buyer' and not public.is_owner() and not public.has_store_permission(v_request.origin_store_id,'prepare_orders'))
    or (v_request.requested_by='store' and v_actor<>v_request.buyer_id)
  then raise exception using errcode='42501',message='취소 요청 응답 권한이 없습니다.'; end if;
  v_next:=case when p_accept then 'refund_pending' else 'rejected' end;
  update public.commerce_cancellation_requests set status=v_next,responded_at=clock_timestamp(),responded_by=v_actor,
    version=version+1,updated_at=clock_timestamp() where id=v_request.id returning * into v_request;
  insert into public.commerce_cancellation_events(request_id,event_kind,actor_user_id,from_status,to_status,idempotency_key,reason)
  values(v_request.id,case when p_accept then 'accepted' else 'rejected' end,v_actor,
    case when v_request.requested_by='buyer' then 'requested_by_buyer' else 'requested_by_store' end,v_next,p_idempotency_key,p_reason);
  if not p_accept and v_request.inventory_item_id is not null then
    update public.inventory_item_fulfillments set is_blocked=false,blocked_reason=null,version=version+1,updated_at=clock_timestamp()
    where inventory_item_id=v_request.inventory_item_id and blocked_reason='active_cancellation_request';
  end if;
  if v_request.requested_by='store' then
    perform app_private.insert_staff_notifications((select business_id from public.stores where id=v_request.origin_store_id),null,
      'cancellation_responded','구매자가 취소 요청에 응답했습니다.',case when p_accept then '취소 요청이 수락되었습니다.' else '취소 요청이 거절되었습니다.' end,'/admin/operator/orders');
  else
    perform app_private.insert_targeted_notification(v_request.buyer_id,'member','cancellation_responded',
      '판매 매장이 취소 요청에 응답했습니다.',case when p_accept then '취소가 수락되어 환불 확인 단계로 이동했습니다.' else '취소 요청이 거절되었습니다.' end,'/account/orders');
  end if;
  return jsonb_build_object('id',v_request.id,'status',v_request.status,'version',v_request.version);
end;
$$;

revoke all on function public.respond_commerce_cancellation(uuid,boolean,bigint,text,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.respond_commerce_cancellation(uuid,boolean,bigint,text,uuid) to authenticated;

create or replace function public.process_expired_commerce_cancellations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=auth.uid(); v_request record; v_count integer:=0;
begin
  if auth.role()<>'service_role' and not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  for v_request in select * from public.commerce_cancellation_requests
    where status in ('requested_by_buyer','requested_by_store','awaiting_counterparty') and response_due_at<=clock_timestamp()
    order by response_due_at,id for update skip locked
  loop
    if v_request.requested_by='buyer' then
      update public.commerce_cancellation_requests set status='owner_attention_required',version=version+1,updated_at=clock_timestamp() where id=v_request.id;
      insert into public.commerce_cancellation_events(request_id,event_kind,actor_user_id,from_status,to_status,idempotency_key)
      values(v_request.id,'expired',v_actor,v_request.status,'owner_attention_required',gen_random_uuid());
    else
      update public.commerce_cancellation_requests set status='expired_auto_accepted',responded_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=v_request.id;
      insert into public.commerce_cancellation_events(request_id,event_kind,actor_user_id,from_status,to_status,idempotency_key)
      values(v_request.id,'expired_auto_accepted',v_actor,v_request.status,'expired_auto_accepted',gen_random_uuid());
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.process_expired_commerce_cancellations() from public,anon,authenticated;
grant execute on function public.process_expired_commerce_cancellations() to service_role;

create or replace function app_private.block_shipment_for_active_cancellation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('packed','shipped') and new.status is distinct from old.status and exists(
    select 1 from public.inventory_shipment_items shipment_items
    join public.commerce_cancellation_requests requests on requests.product_id=shipment_items.product_id
    where shipment_items.shipment_id=new.id and requests.status in (
      'requested_by_buyer','requested_by_store','awaiting_counterparty','owner_attention_required','accepted','expired_auto_accepted','refund_pending'
    )
  ) then raise exception using errcode='55000',message='활성 취소 요청이 있어 포장 또는 발송할 수 없습니다.'; end if;
  return new;
end; $$;
revoke all on function app_private.block_shipment_for_active_cancellation() from public,anon,authenticated,service_role;
create trigger inventory_shipments_block_active_cancellation
before update of status on public.inventory_shipments
for each row execute function app_private.block_shipment_for_active_cancellation();

create or replace function public.adjust_auction_cancellation_penalty(
  p_request_id uuid,p_points integer,p_reason text,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.auction_store_cancellation_penalties%rowtype;
begin
  if not public.is_owner() or p_points not between 0 and 100 or char_length(btrim(coalesce(p_reason,''))) not between 3 and 500
  then raise exception using errcode='42501',message='소유자 감점 조정 입력을 확인해 주세요.'; end if;
  update public.auction_store_cancellation_penalties set applied_points=p_points,adjusted_by=auth.uid(),
    adjustment_reason=btrim(p_reason),adjusted_at=clock_timestamp() where cancellation_request_id=p_request_id returning * into v_row;
  if not found then raise exception using errcode='P0002',message='경매 취소 감점을 찾지 못했습니다.'; end if;
  insert into public.commerce_cancellation_events(request_id,event_kind,actor_user_id,to_status,idempotency_key,reason,metadata)
  select requests.id,'penalty_adjusted',auth.uid(),requests.status,p_idempotency_key,btrim(p_reason),jsonb_build_object('points',p_points)
  from public.commerce_cancellation_requests requests where requests.id=p_request_id;
  return jsonb_build_object('requestId',p_request_id,'points',v_row.applied_points);
end; $$;
revoke all on function public.adjust_auction_cancellation_penalty(uuid,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.adjust_auction_cancellation_penalty(uuid,integer,text,uuid) to authenticated;

commit;
