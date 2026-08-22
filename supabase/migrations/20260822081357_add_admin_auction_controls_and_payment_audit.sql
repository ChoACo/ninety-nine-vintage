begin;

create table public.auction_operation_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  bid_id uuid,
  action text not null check (action in ('extend_10','extend_30','close_now','cancel_bid')),
  reason text not null check (char_length(btrim(reason)) between 2 and 500),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object'),
  occurred_at timestamptz not null default clock_timestamp()
);

create index auction_operation_audit_product_time_idx on public.auction_operation_audit(product_id, occurred_at desc);
create index auction_operation_audit_store_time_idx on public.auction_operation_audit(store_id, occurred_at desc);
alter table public.auction_operation_audit enable row level security;
alter table public.auction_operation_audit force row level security;
revoke all on table public.auction_operation_audit from public, anon, authenticated;
grant select on table public.auction_operation_audit to authenticated;
create policy "Owner reads auction operation audit" on public.auction_operation_audit for select to authenticated using ((select public.is_owner()));
create trigger auction_operation_audit_append_only before update or delete or truncate on public.auction_operation_audit for each statement execute function app_private.reject_security_history_mutation();

create function public.operator_extend_live_auction(p_product_id uuid, p_minutes integer, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_product public.products%rowtype; v_after public.products%rowtype; v_action text;
begin
  if v_actor is null or p_minutes not in (10,30) or char_length(btrim(coalesce(p_reason,''))) not between 2 and 500 then
    raise exception using errcode='22023',message='연장 시간과 사유를 확인해 주세요.';
  end if;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception using errcode='P0002',message='경매 상품을 찾을 수 없습니다.'; end if;
  if public.access_role_for_user(v_actor) not in ('owner','operator') or not public.can_manage_product_store(v_product.store_id) then
    raise exception using errcode='42501',message='담당 매장의 경매만 관리할 수 있습니다.';
  end if;
  if v_product.sale_type<>'auction' or v_product.status<>'active' or v_product.bid_locked_at is not null then
    raise exception using errcode='P0001',message='진행 중인 경매만 연장할 수 있습니다.';
  end if;
  update public.products set closes_at=greatest(closes_at,clock_timestamp())+make_interval(mins=>p_minutes),updated_by=v_actor where id=p_product_id returning * into v_after;
  v_action:=case when p_minutes=10 then 'extend_10' else 'extend_30' end;
  insert into public.auction_operation_audit(actor_id,store_id,product_id,action,reason,before_state,after_state)
  values(v_actor,v_product.store_id,p_product_id,v_action,btrim(p_reason),to_jsonb(v_product),to_jsonb(v_after));
  return jsonb_build_object('productId',p_product_id,'action',v_action,'closesAt',v_after.closes_at);
end $$;

create function public.operator_close_live_auction(p_product_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_product public.products%rowtype; v_after public.products%rowtype; v_winner public.auction_bids%rowtype;
begin
  if v_actor is null or char_length(btrim(coalesce(p_reason,''))) not between 2 and 500 then raise exception using errcode='22023',message='즉시 마감 사유를 확인해 주세요.'; end if;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception using errcode='P0002',message='경매 상품을 찾을 수 없습니다.'; end if;
  if public.access_role_for_user(v_actor) not in ('owner','operator') or not public.can_manage_product_store(v_product.store_id) then raise exception using errcode='42501',message='담당 매장의 경매만 관리할 수 있습니다.'; end if;
  if v_product.sale_type<>'auction' or v_product.status<>'active' or v_product.publish_at>v_now then raise exception using errcode='P0001',message='진행 중인 경매만 마감할 수 있습니다.'; end if;
  select * into v_winner from public.auction_bids where product_id=p_product_id order by amount desc,created_at,id limit 1;
  update public.auction_bids set is_final=(v_winner.id is not null and id=v_winner.id) where product_id=p_product_id;
  update public.products set status='closed',closes_at=greatest(v_now,v_product.publish_at+interval '1 microsecond'),bid_locked_at=case when v_winner.id is null then null else v_now end,final_bid_id=v_winner.id,final_bid_amount=v_winner.amount,updated_by=v_actor where id=p_product_id returning * into v_after;
  insert into public.auction_operation_audit(actor_id,store_id,product_id,bid_id,action,reason,before_state,after_state)
  values(v_actor,v_product.store_id,p_product_id,v_winner.id,'close_now',btrim(p_reason),to_jsonb(v_product),to_jsonb(v_after));
  return jsonb_build_object('productId',p_product_id,'action','close_now','winnerBidId',v_winner.id,'winnerId',v_winner.bidder_id,'winningAmount',v_winner.amount,'closedAt',v_after.closes_at);
end $$;

create function public.operator_cancel_auction_bid(p_bid_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_bid public.auction_bids%rowtype; v_product public.products%rowtype; v_after public.products%rowtype; v_top public.auction_bids%rowtype; v_count integer; v_history jsonb;
begin
  if v_actor is null or char_length(btrim(coalesce(p_reason,''))) not between 2 and 500 then raise exception using errcode='22023',message='입찰 취소 사유를 확인해 주세요.'; end if;
  select * into v_bid from public.auction_bids where id=p_bid_id;
  if not found then raise exception using errcode='P0002',message='입찰 기록을 찾을 수 없습니다.'; end if;
  select * into v_product from public.products where id=v_bid.product_id for update;
  if public.access_role_for_user(v_actor) not in ('owner','operator') or not public.can_manage_product_store(v_product.store_id) then raise exception using errcode='42501',message='담당 매장의 입찰만 취소할 수 있습니다.'; end if;
  if v_product.status<>'active' then raise exception using errcode='P0001',message='진행 중인 경매 입찰만 취소할 수 있습니다.'; end if;
  insert into public.cancelled_auction_bids(original_bid_id,product_id,bidder_id,bidder_display_name,amount,original_created_at,was_final,cancelled_at,cancellation_reason)
  values(v_bid.id,v_bid.product_id,v_bid.bidder_id,v_bid.bidder_display_name,v_bid.amount,v_bid.created_at,v_bid.is_final,clock_timestamp(),left('operator:'||btrim(p_reason),500));
  delete from public.auction_bids where id=p_bid_id;
  select * into v_top from public.auction_bids where product_id=v_product.id order by amount desc,created_at,id limit 1;
  select count(distinct bidder_id)::integer into v_count from public.auction_bids where product_id=v_product.id and bidder_id is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'bidAt',h.created_at,'bidderName',h.name,'amount',h.amount,'outcome',h.outcome) order by h.created_at desc,h.id desc),'[]'::jsonb) into v_history from (
    select id::text,created_at,bidder_display_name name,amount,'active'::text outcome from public.auction_bids where product_id=v_product.id
    union all select original_bid_id::text,original_created_at,bidder_display_name,amount,'cancelled'::text from public.cancelled_auction_bids where product_id=v_product.id
  ) h;
  update public.products set current_price=coalesce(v_top.amount,starting_price),participant_count=coalesce(v_count,0),bid_history=v_history,bid_locked_at=null,final_bid_id=null,final_bid_amount=null,updated_by=v_actor where id=v_product.id returning * into v_after;
  insert into public.auction_operation_audit(actor_id,store_id,product_id,bid_id,action,reason,before_state,after_state)
  values(v_actor,v_product.store_id,v_product.id,v_bid.id,'cancel_bid',btrim(p_reason),to_jsonb(v_product),to_jsonb(v_after));
  return jsonb_build_object('productId',v_product.id,'action','cancel_bid','cancelledBidId',v_bid.id,'currentPrice',v_after.current_price,'participantCount',v_after.participant_count);
end $$;

revoke all on function public.operator_extend_live_auction(uuid,integer,text),public.operator_close_live_auction(uuid,text),public.operator_cancel_auction_bid(uuid,text) from public,anon,service_role;
grant execute on function public.operator_extend_live_auction(uuid,integer,text),public.operator_close_live_auction(uuid,text),public.operator_cancel_auction_bid(uuid,text) to authenticated;

alter function public.confirm_unified_manual_payment_v2(text,uuid,bigint,text,bigint,integer,uuid) rename to confirm_unified_manual_payment_v2_without_activity_audit;
revoke all on function public.confirm_unified_manual_payment_v2_without_activity_audit(text,uuid,bigint,text,bigint,integer,uuid) from public,anon,authenticated,service_role;
create function public.confirm_unified_manual_payment_v2(p_payment_kind text,p_payment_id uuid,p_expected_version bigint,p_depositor_name text,p_observed_received_amount bigint,p_observed_ledger_entry_count integer,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_result jsonb;
begin
  v_result:=public.confirm_unified_manual_payment_v2_without_activity_audit(p_payment_kind,p_payment_id,p_expected_version,p_depositor_name,p_observed_received_amount,p_observed_ledger_entry_count,p_idempotency_key);
  if coalesce((v_result->>'idempotent_replay')::boolean,false)=false then
    perform app_private.write_security_activity(v_actor,null,'payment','manual_payment_approved','approve','confirm_unified_manual_payment_v2',p_payment_kind,p_payment_id::text,'notice',null,null,jsonb_build_object('admin_id',v_actor,'order_id',p_payment_id,'amount',coalesce((v_result->>'received_amount')::bigint,p_observed_received_amount),'timestamp',clock_timestamp(),'note','입금자명 확인: '||left(btrim(p_depositor_name),80)));
  end if;
  return v_result;
end $$;
revoke all on function public.confirm_unified_manual_payment_v2(text,uuid,bigint,text,bigint,integer,uuid) from public,anon,service_role;
grant execute on function public.confirm_unified_manual_payment_v2(text,uuid,bigint,text,bigint,integer,uuid) to authenticated;

commit;
