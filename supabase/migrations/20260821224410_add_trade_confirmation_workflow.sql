begin;

create table public.store_business_holidays (
  holiday_date date primary key,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default clock_timestamp()
);

create table public.inventory_shipment_trade_confirmations (
  shipment_id uuid primary key references public.inventory_shipments(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  tracking_registered_at timestamptz not null,
  confirmation_due_at timestamptz not null,
  confirmed_at timestamptz,
  confirmed_by_kind text check (confirmed_by_kind in ('member','automatic')),
  confirmed_by uuid references public.profiles(id) on delete restrict,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((confirmed_at is null and confirmed_by_kind is null and confirmed_by is null)
    or (confirmed_at is not null and confirmed_by_kind is not null
      and (confirmed_by_kind = 'automatic' or confirmed_by is not null)))
);

create index inventory_shipment_trade_confirmation_due_idx
  on public.inventory_shipment_trade_confirmations(confirmation_due_at, shipment_id)
  where confirmed_at is null;

alter table public.store_business_holidays enable row level security;
alter table public.store_business_holidays force row level security;
alter table public.inventory_shipment_trade_confirmations enable row level security;
alter table public.inventory_shipment_trade_confirmations force row level security;
revoke all on public.store_business_holidays from public, anon, authenticated;
revoke all on public.inventory_shipment_trade_confirmations from public, anon, authenticated;
grant select on public.store_business_holidays to service_role;
grant select, insert, update on public.inventory_shipment_trade_confirmations to service_role;

create or replace function app_private.trade_confirmation_due_at(p_from timestamptz)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare
  v_local timestamp := p_from at time zone 'Asia/Seoul';
  v_date date := (p_from at time zone 'Asia/Seoul')::date;
  v_count integer := 0;
begin
  if p_from is null then raise exception using errcode='22023',message='송장 등록 시각이 필요합니다.'; end if;
  while v_count < 2 loop
    v_date := v_date + 1;
    if extract(dow from v_date) <> 0 and not exists (
      select 1 from public.store_business_holidays holidays where holidays.holiday_date=v_date
    ) then v_count := v_count + 1; end if;
  end loop;
  return (v_date + v_local::time) at time zone 'Asia/Seoul';
end; $$;
revoke all on function app_private.trade_confirmation_due_at(timestamptz) from public,anon,authenticated,service_role;

create or replace function app_private.confirm_inventory_shipment_trade(
  p_shipment_id uuid, p_kind text, p_actor uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_row public.inventory_shipment_trade_confirmations%rowtype;
begin
  select * into v_row from public.inventory_shipment_trade_confirmations where shipment_id=p_shipment_id for update;
  if not found then raise exception using errcode='P0002',message='구매 확정 가능한 배송을 찾을 수 없습니다.'; end if;
  if v_row.confirmed_at is not null then return true; end if;
  if p_kind='member' and (p_actor is null or p_actor<>v_row.member_id) then
    raise exception using errcode='42501',message='본인의 배송 상품만 구매 확정할 수 있습니다.';
  end if;
  if p_kind='automatic' and clock_timestamp()<v_row.confirmation_due_at then return false; end if;
  update public.inventory_shipment_trade_confirmations set confirmed_at=clock_timestamp(),confirmed_by_kind=p_kind,
    confirmed_by=case when p_kind='member' then p_actor end,version=version+1,updated_at=clock_timestamp()
    where shipment_id=p_shipment_id;
  update public.store_settlement_entries entries set eligible_at=clock_timestamp()
    where entries.settlement_batch_id is null and entries.source_kind='inventory_item' and entries.source_id in (
      select items.inventory_item_id from public.inventory_shipment_items items
      where items.shipment_id=p_shipment_id and items.origin_store_id=v_row.store_id
        and items.line_status not in ('excluded','cancelled')
    );
  insert into public.notifications(member_id,audience_role,kind,title,body,href)
    values(v_row.member_id,'member','purchase_confirmed','구매가 확정되었습니다.','거래가 확정되어 판매자 정산 절차가 시작되었습니다.','/account#shipping');
  return true;
end; $$;
revoke all on function app_private.confirm_inventory_shipment_trade(uuid,text,uuid) from public,anon,authenticated,service_role;

create or replace function public.confirm_my_inventory_shipment_purchase(p_shipment_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='로그인이 필요합니다.'; end if;
  return app_private.confirm_inventory_shipment_trade(p_shipment_id,'member',auth.uid());
end; $$;
revoke all on function public.confirm_my_inventory_shipment_purchase(uuid) from public,anon,service_role;
grant execute on function public.confirm_my_inventory_shipment_purchase(uuid) to authenticated;

create or replace function app_private.capture_inventory_shipment_trade_state()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_store uuid; v_store_count integer; v_now timestamptz:=clock_timestamp();
begin
  select min(items.origin_store_id::text)::uuid,count(distinct items.origin_store_id)
    into v_store,v_store_count from public.inventory_shipment_items items
    where items.shipment_id=new.id and items.line_status not in ('excluded','cancelled');
  if old.status is distinct from new.status and new.status='packed' then
    insert into public.notifications(member_id,audience_role,kind,title,body,href)
      values(new.member_id,'member','shipment_preparing','상품이 준비 중입니다.','판매자가 상품 포장을 완료하고 송장 등록을 준비하고 있습니다.','/account#shipping');
  end if;
  if new.tracking_number is not null and new.courier is not null and
    (old.tracking_number is distinct from new.tracking_number or old.courier is distinct from new.courier) then
    if v_store is null or v_store_count<>1 then raise exception using errcode='55000',message='배송 상품의 센터 범위를 확인할 수 없습니다.'; end if;
    insert into public.inventory_shipment_trade_confirmations(shipment_id,member_id,store_id,tracking_registered_at,confirmation_due_at)
      values(new.id,new.member_id,v_store,v_now,app_private.trade_confirmation_due_at(v_now))
      on conflict(shipment_id) do update set store_id=excluded.store_id,tracking_registered_at=v_now,
        confirmation_due_at=app_private.trade_confirmation_due_at(v_now),confirmed_at=null,confirmed_by_kind=null,
        confirmed_by=null,version=public.inventory_shipment_trade_confirmations.version+1,updated_at=v_now;
    insert into public.notifications(member_id,audience_role,kind,title,body,href)
      values(new.member_id,'member',case when old.tracking_number is null then 'shipment_tracking_registered' else 'shipment_tracking_updated' end,
        case when old.tracking_number is null then '송장이 등록되었습니다.' else '송장 정보가 수정되었습니다.' end,
        'MY 배송 정보에서 택배사와 송장번호를 확인해 주세요.','/account#shipping');
  end if;
  return new;
end; $$;
revoke all on function app_private.capture_inventory_shipment_trade_state() from public,anon,authenticated,service_role;
drop trigger if exists capture_inventory_shipment_trade_state on public.inventory_shipments;
create trigger capture_inventory_shipment_trade_state after update on public.inventory_shipments
for each row execute function app_private.capture_inventory_shipment_trade_state();

create or replace function app_private.confirm_due_inventory_shipment_trades()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count integer:=0;
begin
  for v_id in select shipment_id from public.inventory_shipment_trade_confirmations
    where confirmed_at is null and confirmation_due_at<=clock_timestamp() order by confirmation_due_at for update skip locked
  loop if app_private.confirm_inventory_shipment_trade(v_id,'automatic',null) then v_count:=v_count+1; end if; end loop;
  return v_count;
end; $$;
revoke all on function app_private.confirm_due_inventory_shipment_trades() from public,anon,authenticated,service_role;
do $$ begin
  if exists(select 1 from cron.job where jobname='confirm-due-inventory-shipment-trades') then
    perform cron.unschedule((select jobid from cron.job where jobname='confirm-due-inventory-shipment-trades' limit 1));
  end if;
  perform cron.schedule('confirm-due-inventory-shipment-trades','*/5 * * * *',$job$select app_private.confirm_due_inventory_shipment_trades()$job$);
exception when undefined_table then null; end $$;

commit;
