begin;

alter table public.inventory_shipments
  add column if not exists tracker_carrier_id text,
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists delivery_status_text text,
  add column if not exists tracking_checked_at timestamptz,
  add column if not exists tracking_error text,
  add column if not exists delivered_at timestamptz,
  add column if not exists auto_settle_at timestamptz,
  add column if not exists settlement_status text not null default 'pending';

alter table public.inventory_shipments
  drop constraint if exists inventory_shipments_delivery_status_check,
  add constraint inventory_shipments_delivery_status_check
    check (delivery_status in ('pending','in_transit','delivered','lookup_failed')),
  drop constraint if exists inventory_shipments_delivery_timestamps_check,
  add constraint inventory_shipments_delivery_timestamps_check check (
    (delivery_status = 'delivered' and delivered_at is not null and auto_settle_at = delivered_at + interval '24 hours')
    or (delivery_status <> 'delivered' and delivered_at is null and auto_settle_at is null)
  ),
  drop constraint if exists inventory_shipments_settlement_status_check,
  add constraint inventory_shipments_settlement_status_check
    check (settlement_status in ('pending','settled','refunded'));

create index if not exists inventory_shipments_tracking_poll_idx
  on public.inventory_shipments(tracking_checked_at, shipped_at, id)
  where status = 'shipped' and delivered_at is null and tracking_number is not null;

create index if not exists inventory_shipments_auto_settle_idx
  on public.inventory_shipments(auto_settle_at, id)
  where delivery_status = 'delivered' and settlement_status = 'pending';

create or replace function app_private.assert_inventory_shipment_mutation_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_internal_delivery boolean := coalesce(current_setting('app.inventory_delivery_tracking',true),'')='on';
begin
  if (
    new.status in ('packed','shipped') or old.status in ('packed','shipped')
    or old.courier is distinct from new.courier or old.tracking_number is distinct from new.tracking_number
  ) and not (
    v_internal_delivery and old.status=new.status and old.courier is not distinct from new.courier
      and old.tracking_number is not distinct from new.tracking_number
  ) and not app_private.can_access_inventory_shipment(new.id,'create_shipments',auth.uid())
  then raise exception using errcode='42501',message='택배 발송 권한이 없습니다.'; end if;
  return new;
end; $$;
revoke all on function app_private.assert_inventory_shipment_mutation_gate()
from public,anon,authenticated,service_role;

create or replace function app_private.require_service_role()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' then
    raise exception using errcode='42501',message='서버 작업 권한이 필요합니다.';
  end if;
end; $$;
revoke all on function app_private.require_service_role() from public,anon,authenticated,service_role;

create or replace function public.get_pending_inventory_delivery_tracking(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform app_private.require_service_role();
  select coalesce(jsonb_agg(jsonb_build_object(
    'shipmentId', candidates.id,
    'courier', candidates.courier,
    'trackerCarrierId', candidates.tracker_carrier_id,
    'trackingNumber', candidates.tracking_number,
    'shippedAt', candidates.shipped_at,
    'trackingCheckedAt', candidates.tracking_checked_at
  ) order by candidates.tracking_checked_at nulls first,candidates.shipped_at,candidates.id),'[]'::jsonb)
  into v_result
  from (
    select shipments.* from public.inventory_shipments shipments
    where shipments.status='shipped' and shipments.delivered_at is null
      and shipments.tracking_number is not null and shipments.courier is not null
      and (shipments.tracking_checked_at is null or shipments.tracking_checked_at <= clock_timestamp()-interval '45 minutes')
    order by shipments.tracking_checked_at nulls first,shipments.shipped_at,shipments.id
    limit greatest(1,least(coalesce(p_limit,50),100))
  ) candidates;
  return jsonb_build_object('shipments',v_result,'serverTime',clock_timestamp());
end; $$;
revoke all on function public.get_pending_inventory_delivery_tracking(integer) from public,anon,authenticated;
grant execute on function public.get_pending_inventory_delivery_tracking(integer) to service_role;

create or replace function public.record_inventory_delivery_tracking(
  p_shipment_id uuid,
  p_expected_tracking_number text,
  p_tracker_carrier_id text,
  p_status_text text,
  p_delivered_at timestamptz default null,
  p_error text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_shipment public.inventory_shipments%rowtype; v_now timestamptz:=clock_timestamp();
begin
  perform app_private.require_service_role();
  if p_shipment_id is null or nullif(btrim(coalesce(p_expected_tracking_number,'')),'') is null
    or char_length(coalesce(p_status_text,'')) > 160 or char_length(coalesce(p_error,'')) > 500
  then raise exception using errcode='22023',message='배송조회 결과를 확인해 주세요.'; end if;
  select * into v_shipment from public.inventory_shipments where id=p_shipment_id for update;
  if not found then raise exception using errcode='P0002',message='배송을 찾지 못했습니다.'; end if;
  if v_shipment.status<>'shipped' or v_shipment.tracking_number is distinct from btrim(p_expected_tracking_number)
  then raise exception using errcode='PT409',message='송장 정보가 변경되었습니다.'; end if;

  perform set_config('app.inventory_delivery_tracking','on',true);

  if p_delivered_at is not null then
    update public.inventory_shipments set tracker_carrier_id=nullif(btrim(p_tracker_carrier_id),''),
      delivery_status='delivered',delivery_status_text=coalesce(nullif(btrim(p_status_text),''),'배송완료'),
      tracking_checked_at=v_now,tracking_error=null,
      delivered_at=p_delivered_at,auto_settle_at=p_delivered_at+interval '24 hours',updated_at=v_now
    where id=p_shipment_id returning * into v_shipment;
    update public.inventory_shipment_trade_confirmations set confirmation_due_at=p_delivered_at+interval '24 hours',
      updated_at=v_now where shipment_id=p_shipment_id and confirmed_at is null;
    insert into public.notifications(member_id,audience_role,kind,title,body,href)
      values(v_shipment.member_id,'member','shipment_delivered','배송이 완료되었습니다.',
        '상품을 확인하고 구매 확정을 눌러주세요. 24시간 뒤 자동으로 구매 확정됩니다.','/my/orders');
  else
    update public.inventory_shipments set tracker_carrier_id=nullif(btrim(p_tracker_carrier_id),''),
      delivery_status=case when p_error is null then 'in_transit' else 'lookup_failed' end,
      delivery_status_text=nullif(btrim(p_status_text),''),
      tracking_checked_at=v_now,tracking_error=nullif(left(btrim(coalesce(p_error,'')),500),''),updated_at=v_now
    where id=p_shipment_id returning * into v_shipment;
  end if;
  return jsonb_build_object('id',v_shipment.id,'deliveryStatus',v_shipment.delivery_status,
    'deliveredAt',v_shipment.delivered_at,'autoSettleAt',v_shipment.auto_settle_at);
end; $$;
revoke all on function public.record_inventory_delivery_tracking(uuid,text,text,text,timestamptz,text)
from public,anon,authenticated;
grant execute on function public.record_inventory_delivery_tracking(uuid,text,text,text,timestamptz,text)
to service_role;

create or replace function app_private.defer_shipment_settlement_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_shipment_id uuid;
begin
  begin v_shipment_id := nullif(new.metadata->>'shipmentId','')::uuid;
  exception when invalid_text_representation then v_shipment_id := null; end;
  if v_shipment_id is not null and exists(
    select 1 from public.inventory_shipments shipments
    where shipments.id=v_shipment_id and shipments.settlement_status='pending'
  ) then new.eligible_at:='infinity'::timestamptz; end if;
  return new;
end; $$;
revoke all on function app_private.defer_shipment_settlement_entry() from public,anon,authenticated,service_role;
drop trigger if exists defer_shipment_settlement_entry on public.store_settlement_entries;
create trigger defer_shipment_settlement_entry before insert on public.store_settlement_entries
for each row execute function app_private.defer_shipment_settlement_entry();

update public.store_settlement_entries entries set eligible_at='infinity'::timestamptz
where entries.settlement_batch_id is null and coalesce(entries.metadata->>'shipmentId','') ~* '^[0-9a-f-]{36}$'
  and exists(select 1 from public.inventory_shipments shipments
    where shipments.id=(entries.metadata->>'shipmentId')::uuid and shipments.settlement_status='pending');

create or replace function app_private.confirm_inventory_shipment_trade(
  p_shipment_id uuid, p_kind text, p_actor uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_row public.inventory_shipment_trade_confirmations%rowtype; v_now timestamptz:=clock_timestamp();
begin
  select * into v_row from public.inventory_shipment_trade_confirmations where shipment_id=p_shipment_id for update;
  if not found then raise exception using errcode='P0002',message='구매 확정 가능한 배송을 찾을 수 없습니다.'; end if;
  if v_row.confirmed_at is not null then return true; end if;
  if p_kind='member' and (p_actor is null or p_actor<>v_row.member_id) then
    raise exception using errcode='42501',message='본인의 배송 상품만 구매 확정할 수 있습니다.';
  end if;
  if p_kind='member' and not exists(
    select 1 from public.inventory_shipments shipments
    where shipments.id=p_shipment_id and shipments.delivered_at is not null
  ) then raise exception using errcode='55000',message='배송 완료 확인 후 구매 확정할 수 있습니다.'; end if;
  if p_kind='automatic' and (v_row.confirmation_due_at='infinity'::timestamptz or v_now<v_row.confirmation_due_at) then return false; end if;
  update public.inventory_shipment_trade_confirmations set confirmed_at=v_now,confirmed_by_kind=p_kind,
    confirmed_by=case when p_kind='member' then p_actor end,version=version+1,updated_at=v_now
    where shipment_id=p_shipment_id;
  perform set_config('app.inventory_delivery_tracking','on',true);
  update public.inventory_shipments set settlement_status='settled',updated_at=v_now
    where id=p_shipment_id and settlement_status='pending';
  update public.store_settlement_entries entries set eligible_at=v_now
    where entries.settlement_batch_id is null and entries.metadata->>'shipmentId'=p_shipment_id::text;
  insert into public.notifications(member_id,audience_role,kind,title,body,href)
    values(v_row.member_id,'member','purchase_confirmed','구매가 확정되었습니다.',
      '거래가 확정되어 판매자 정산 절차가 시작되었습니다.','/my/orders');
  return true;
end; $$;
revoke all on function app_private.confirm_inventory_shipment_trade(uuid,text,uuid)
from public,anon,authenticated,service_role;

create or replace function app_private.capture_inventory_shipment_trade_state()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_store uuid; v_store_count integer; v_now timestamptz:=clock_timestamp();
begin
  select min(items.origin_store_id::text)::uuid,count(distinct items.origin_store_id)
    into v_store,v_store_count from public.inventory_shipment_items items
    where items.shipment_id=new.id and items.line_status not in ('excluded','cancelled');
  if old.status is distinct from new.status and new.status='packed' then
    insert into public.notifications(member_id,audience_role,kind,title,body,href)
      values(new.member_id,'member','shipment_preparing','상품이 준비 중입니다.',
        '판매자가 상품 포장을 완료하고 송장 등록을 준비하고 있습니다.','/my/orders');
  end if;
  if new.tracking_number is not null and new.courier is not null and
    (old.tracking_number is distinct from new.tracking_number or old.courier is distinct from new.courier) then
    if v_store is null or v_store_count<>1 then raise exception using errcode='55000',message='배송 상품의 센터 범위를 확인할 수 없습니다.'; end if;
    insert into public.inventory_shipment_trade_confirmations(shipment_id,member_id,store_id,tracking_registered_at,confirmation_due_at)
      values(new.id,new.member_id,v_store,v_now,'infinity'::timestamptz)
      on conflict(shipment_id) do update set store_id=excluded.store_id,tracking_registered_at=v_now,
        confirmation_due_at='infinity'::timestamptz,confirmed_at=null,confirmed_by_kind=null,
        confirmed_by=null,version=public.inventory_shipment_trade_confirmations.version+1,updated_at=v_now;
    update public.inventory_shipments set tracker_carrier_id=null,delivery_status='pending',delivery_status_text=null,tracking_checked_at=null,
      tracking_error=null,delivered_at=null,auto_settle_at=null,settlement_status='pending'
      where id=new.id;
    insert into public.notifications(member_id,audience_role,kind,title,body,href)
      values(new.member_id,'member',case when old.tracking_number is null then 'shipment_tracking_registered' else 'shipment_tracking_updated' end,
        case when old.tracking_number is null then '송장이 등록되었습니다.' else '송장 정보가 수정되었습니다.' end,
        'MY 배송 정보에서 택배사와 송장번호를 확인해 주세요.','/my/orders');
  end if;
  return new;
end; $$;
revoke all on function app_private.capture_inventory_shipment_trade_state()
from public,anon,authenticated,service_role;

update public.inventory_shipment_trade_confirmations confirmations
set confirmation_due_at='infinity'::timestamptz,updated_at=clock_timestamp()
where confirmations.confirmed_at is null and exists(
  select 1 from public.inventory_shipments shipments
  where shipments.id=confirmations.shipment_id and shipments.delivered_at is null
);

create or replace function public.settle_due_delivered_inventory_shipments(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count integer:=0;
begin
  perform app_private.require_service_role();
  for v_id in select shipments.id from public.inventory_shipments shipments
    where shipments.delivery_status='delivered' and shipments.settlement_status='pending'
      and shipments.auto_settle_at<=clock_timestamp()
    order by shipments.auto_settle_at,shipments.id
    limit greatest(1,least(coalesce(p_limit,100),500)) for update skip locked
  loop
    if app_private.confirm_inventory_shipment_trade(v_id,'automatic',null) then v_count:=v_count+1; end if;
  end loop;
  return jsonb_build_object('settledCount',v_count,'serverTime',clock_timestamp());
end; $$;
revoke all on function public.settle_due_delivered_inventory_shipments(integer)
from public,anon,authenticated;
grant execute on function public.settle_due_delivered_inventory_shipments(integer) to service_role;

commit;
