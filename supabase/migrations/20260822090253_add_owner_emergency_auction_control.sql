create table public.auction_emergency_control (
  singleton boolean primary key default true check (singleton),
  paused boolean not null default false,
  paused_at timestamptz,
  reason text not null default '',
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id)
);
insert into public.auction_emergency_control(singleton) values (true);
alter table public.auction_emergency_control enable row level security;
alter table public.auction_emergency_control force row level security;
revoke all on public.auction_emergency_control from public, anon, authenticated;
grant select on public.auction_emergency_control to authenticated;
create policy "Owner reads auction emergency state" on public.auction_emergency_control for select to authenticated using ((select public.is_owner()));

create function app_private.reject_bids_during_emergency() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.auction_emergency_control where singleton and paused) then
    raise exception using errcode='P0001', message='전사 경매가 비상 일시정지 상태입니다.';
  end if;
  return new;
end $$;
create trigger reject_bids_during_emergency before insert on public.auction_bids for each row execute function app_private.reject_bids_during_emergency();

create function public.owner_control_all_auctions(p_action text, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_state public.auction_emergency_control%rowtype; v_count integer:=0; v_duration interval;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자만 실행할 수 있습니다.'; end if;
  if p_action not in ('pause','resume','extend_60') or length(trim(coalesce(p_reason,'')))<2 then raise exception using errcode='22023',message='작업과 사유를 확인해 주세요.'; end if;
  select * into v_state from public.auction_emergency_control where singleton for update;
  if p_action='pause' then
    update public.auction_emergency_control set paused=true,paused_at=coalesce(paused_at,v_now),reason=trim(p_reason),updated_at=v_now,updated_by=auth.uid() where singleton;
  elsif p_action='resume' then
    v_duration:=case when v_state.paused and v_state.paused_at is not null then v_now-v_state.paused_at else interval '0' end;
    update public.products set closes_at=closes_at+v_duration where sale_type='auction' and status='active' and closes_at>v_state.paused_at;
    get diagnostics v_count=row_count;
    update public.auction_emergency_control set paused=false,paused_at=null,reason=trim(p_reason),updated_at=v_now,updated_by=auth.uid() where singleton;
  else
    update public.products set closes_at=closes_at+interval '1 hour' where sale_type='auction' and status='active' and closes_at>v_now;
    get diagnostics v_count=row_count;
    update public.auction_emergency_control set reason=trim(p_reason),updated_at=v_now,updated_by=auth.uid() where singleton;
  end if;
  insert into public.security_activity_logs(actor_user_id,category,event_type,action,source,entity_type,entity_id,severity,metadata)
  values(auth.uid(),'auction','owner.auction.'||p_action,p_action,'owner_center','auction_platform','all',case when p_action='pause' then 'critical' else 'warning' end,jsonb_build_object('reason',trim(p_reason),'affectedCount',v_count,'at',v_now));
  return jsonb_build_object('action',p_action,'paused',(select paused from public.auction_emergency_control where singleton),'affectedCount',v_count,'updatedAt',v_now);
end $$;
revoke all on function public.owner_control_all_auctions(text,text) from public,anon,service_role;
grant execute on function public.owner_control_all_auctions(text,text) to authenticated;
