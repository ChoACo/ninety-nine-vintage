-- Store-specific two-tier shipping, Owner-only nickname review, and support
-- messages that distinguish a staff principal from the same session's buyer role.

begin;

alter table public.stores
  add column if not exists regular_shipping_fee bigint,
  add column if not exists remote_area_shipping_fee bigint;

alter table public.commerce_orders
  add column if not exists shipping_region text;
alter table public.commerce_orders
  add constraint commerce_orders_shipping_region_check
  check (shipping_region is null or shipping_region in ('regular','remote_area'));

update public.stores stores
set regular_shipping_fee = coalesce(stores.regular_shipping_fee, settings.shipping_fee_amount),
    remote_area_shipping_fee = coalesce(stores.remote_area_shipping_fee, settings.shipping_fee_amount)
from public.inventory_fulfillment_rollout_settings settings
where settings.business_id = stores.business_id
  and (stores.regular_shipping_fee is null or stores.remote_area_shipping_fee is null);

alter table public.stores
  add constraint stores_regular_shipping_fee_check
    check (regular_shipping_fee is null or regular_shipping_fee between 1 and 1000000),
  add constraint stores_remote_area_shipping_fee_check
    check (remote_area_shipping_fee is null or remote_area_shipping_fee between 1 and 1000000),
  add constraint stores_remote_area_shipping_fee_order_check
    check (regular_shipping_fee is null or remote_area_shipping_fee is null
      or remote_area_shipping_fee >= regular_shipping_fee);

create or replace function public.configure_store_shipping_fees(
  p_store_id uuid,
  p_regular_shipping_fee bigint,
  p_remote_area_shipping_fee bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_store public.stores%rowtype;
begin
  if auth.uid() is null or not (
    public.is_owner()
    or public.has_store_permission(p_store_id, 'manage_products')
  ) then
    raise exception using errcode = '42501', message = '센터 택배비 설정 권한이 없습니다.';
  end if;
  if p_regular_shipping_fee not between 1 and 1000000
    or p_remote_area_shipping_fee not between p_regular_shipping_fee and 1000000
  then
    raise exception using errcode = '22023', message = '택배비는 1원 이상 100만원 이하로 입력해 주세요.';
  end if;
  update public.stores set
    regular_shipping_fee = p_regular_shipping_fee,
    remote_area_shipping_fee = p_remote_area_shipping_fee,
    updated_at = clock_timestamp()
  where id = p_store_id and is_active
  returning * into v_store;
  if not found then
    raise exception using errcode = 'P0002', message = '설정할 센터를 찾지 못했습니다.';
  end if;
  return jsonb_build_object(
    'storeId', v_store.id,
    'regularShippingFee', v_store.regular_shipping_fee,
    'remoteAreaShippingFee', v_store.remote_area_shipping_fee
  );
end;
$$;

revoke all on function public.configure_store_shipping_fees(uuid,bigint,bigint)
from public, anon, authenticated, service_role;
grant execute on function public.configure_store_shipping_fees(uuid,bigint,bigint)
to authenticated;

create or replace function public.quote_commerce_shipping_fee(
  p_product_ids uuid[], p_shipping_region text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_requested integer; v_valid integer; v_products bigint; v_shipping bigint; v_charges jsonb; v_missing boolean;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='로그인이 필요합니다.'; end if;
  if p_shipping_region not in ('regular','remote_area') then
    raise exception using errcode='22023',message='배송 지역 구분을 확인해 주세요.';
  end if;
  v_requested:=coalesce(array_length(p_product_ids,1),0);
  if v_requested=0 or v_requested>50 or v_requested<>(select count(distinct value) from unnest(p_product_ids) value)
  then raise exception using errcode='22023',message='배송비 견적 상품을 확인해 주세요.'; end if;
  select count(*)::integer,sum(current_price)::bigint into v_valid,v_products from public.products
  where id=any(p_product_ids) and sale_type='fixed' and status='active'
    and publish_at<=clock_timestamp() and public.can_purchase_product(id);
  if v_valid<>v_requested then raise exception using errcode='42501',message='구매할 수 없는 센터 상품이 포함되어 있습니다.'; end if;
  with scoped as (
    select p.id product_id,p.title,p.current_price,s.id store_id,s.name store_name,
      case when p_shipping_region='remote_area' then s.remote_area_shipping_fee else s.regular_shipping_fee end amount
    from public.products p join public.stores s on s.id=p.store_id where p.id=any(p_product_ids)
  ), charges as (
    select 'store:'||store_id::text charge_key,store_id billing_store_id,max(store_name) unit_name,max(amount) amount,
      sum(current_price)::bigint product_subtotal,
      jsonb_agg(product_id order by product_id) product_ids,
      jsonb_agg(jsonb_build_object('id',product_id,'title',title,'amount',current_price) order by product_id) products
    from scoped group by store_id
  )
  select coalesce(sum(amount),0),coalesce(bool_or(amount is null),true),coalesce(jsonb_agg(jsonb_build_object(
    'chargeKey',charge_key,'mode','per_store','unitKind','store','unitName',unit_name,
    'billingStoreId',billing_store_id,'billingStoreName',unit_name,'amount',amount,
    'productSubtotal',product_subtotal,'storeIds',jsonb_build_array(billing_store_id),
    'storeNames',jsonb_build_array(unit_name),'productIds',product_ids,'products',products,
    'shippingRegion',p_shipping_region) order by charge_key),'[]'::jsonb)
  into v_shipping,v_missing,v_charges from charges;
  if v_missing or v_shipping<1 then raise exception using errcode='55000',message='센터의 일반·제주 및 도서산간 택배비 설정을 확인해 주세요.'; end if;
  return jsonb_build_object('productSubtotal',v_products,'shippingFee',v_shipping,'total',v_products+v_shipping,
    'shippingRegion',p_shipping_region,'chargeCount',jsonb_array_length(v_charges),'charges',v_charges);
end;
$$;

create or replace function public.quote_commerce_shipping_fee(p_product_ids uuid[])
returns jsonb language sql volatile security definer set search_path='' as $$
  select public.quote_commerce_shipping_fee(p_product_ids,'regular');
$$;
revoke all on function public.quote_commerce_shipping_fee(uuid[],text) from public,anon,service_role;
grant execute on function public.quote_commerce_shipping_fee(uuid[],text) to authenticated;

create or replace function public.create_commerce_manual_transfer_checkout(
  p_product_ids uuid[],p_idempotency_key text,p_apply_shipping_credit boolean,
  p_include_shipping_fee boolean,p_shipping_region text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order jsonb; v_order_id uuid; v_transfer jsonb; v_existing public.commerce_order_transfers%rowtype;
  v_allow boolean; v_surcharge bigint:=0;
begin
  if p_shipping_region not in ('regular','remote_area') then raise exception using errcode='22023',message='배송 지역 구분을 확인해 주세요.'; end if;
  v_order:=app_private.create_commerce_order(p_product_ids,p_idempotency_key,p_apply_shipping_credit);
  if jsonb_typeof(v_order)<>'object' or nullif(v_order->>'id','') is null then raise exception using errcode='XX000',message='주문 생성 결과가 올바르지 않습니다.'; end if;
  v_order_id:=(v_order->>'id')::uuid;
  if coalesce(p_include_shipping_fee,false) then
    if exists(select 1 from public.commerce_orders where id=v_order_id and shipping_region is not null
      and shipping_region is distinct from p_shipping_region)
    then raise exception using errcode='22000',message='같은 주문 요청 키의 배송 지역 선택이 다릅니다.'; end if;
    update public.commerce_orders set shipping_region=p_shipping_region where id=v_order_id and shipping_region is null;
  end if;
  v_allow:=not exists(select 1 from public.commerce_order_transfers where order_id=v_order_id)
    and not exists(select 1 from public.payment_orders where commerce_order_id=v_order_id);
  v_order:=app_private.apply_commerce_checkout_shipping_fee(v_order_id,coalesce(p_include_shipping_fee,false),v_allow);
  if coalesce(p_include_shipping_fee,false) and p_shipping_region='remote_area' then
    if exists(select 1 from public.commerce_order_shipping_fee_allocations where order_id=v_order_id and charge_key like 'remote:%') then
      null;
    elsif v_allow then
      with scoped as (
        select s.id store_id,s.business_id,max(s.remote_area_shipping_fee-s.regular_shipping_fee) surcharge
        from public.commerce_order_items i join public.stores s on s.id=i.store_id
        where i.order_id=v_order_id group by s.id,s.business_id
      )
      insert into public.commerce_order_shipping_fee_allocations(order_id,business_id,amount,charge_key,charge_mode,
        origin_store_id,billing_store_id,policy_snapshot)
      select v_order_id,business_id,surcharge,'remote:'||store_id::text,'per_store',store_id,store_id,
        jsonb_build_object('shippingRegion','remote_area','remoteAreaSurcharge',surcharge)
      from scoped where surcharge>0;
      select coalesce(sum(amount),0) into v_surcharge from public.commerce_order_shipping_fee_allocations
      where order_id=v_order_id and charge_key like 'remote:%';
      update public.commerce_orders orders set shipping_fee=orders.shipping_fee+v_surcharge,total=orders.total+v_surcharge,
        updated_at=clock_timestamp() where orders.id=v_order_id returning to_jsonb(orders.*) into v_order;
    else
      raise exception using errcode='22000',message='같은 주문 요청 키의 배송 지역 선택이 다릅니다.';
    end if;
  end if;
  select * into v_existing from public.commerce_order_transfers where order_id=v_order_id for update;
  if found then
    if v_existing.member_id is distinct from auth.uid() or v_existing.expected_amount is distinct from (v_order->>'total')::bigint
    then raise exception using errcode='22000',message='같은 주문 요청 키의 배송 지역 선택이 다릅니다.'; end if;
    v_transfer:=to_jsonb(v_existing);
  else v_transfer:=public.create_commerce_order_transfer(v_order_id); end if;
  return jsonb_build_object('order',v_order,'transfer',v_transfer);
end; $$;
revoke all on function public.create_commerce_manual_transfer_checkout(uuid[],text,boolean,boolean,text)
from public,anon,service_role;
grant execute on function public.create_commerce_manual_transfer_checkout(uuid[],text,boolean,boolean,text) to authenticated;

-- Nickname requests are global identity changes, so only the site Owner may list or decide them.
create or replace function public.get_pending_nickname_change_requests()
returns table(request_id uuid,member_id uuid,current_nickname text,requested_nickname text,requested_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_owner() then raise exception using errcode='42501',message='닉네임 요청 조회는 소유자만 할 수 있습니다.'; end if;
  return query select r.id,r.member_id,p.display_name,r.requested_nickname,r.created_at
  from public.nickname_change_requests r join public.profiles p on p.id=r.member_id
  where r.status='pending' order by r.created_at,r.id;
end; $$;

create or replace function public.review_nickname_change_request(p_request_id uuid,p_approve boolean,p_review_note text default null)
returns text language plpgsql security definer set search_path='' as $$
declare v_member uuid; v_name text; v_note text:=nullif(btrim(coalesce(p_review_note,'')),'');
begin
  if not public.is_owner() then raise exception using errcode='42501',message='닉네임 요청 처리는 소유자만 할 수 있습니다.'; end if;
  if v_note is not null and char_length(v_note)>300 then raise exception using errcode='22023',message='검토 메모는 300자 이하로 입력해 주세요.'; end if;
  select member_id,requested_nickname into v_member,v_name from public.nickname_change_requests
  where id=p_request_id and status='pending' for update;
  if not found then raise exception using errcode='P0002',message='처리할 닉네임 요청을 찾지 못했습니다.'; end if;
  if p_approve then update public.profiles set display_name=v_name where id=v_member; end if;
  update public.nickname_change_requests set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=auth.uid(),review_note=v_note,reviewed_at=clock_timestamp() where id=p_request_id;
  return case when p_approve then 'approved' else 'rejected' end;
end; $$;

-- Any active account may be the customer side of a conversation, including
-- Owner/operator/employee accounts. Staff access remains store-assignment scoped.
create or replace function public.is_support_member(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
  select p_user_id is not null and exists(select 1 from public.member_accounts a
    where a.member_id=p_user_id and a.account_status='active');
$$;

create or replace function public.can_send_support_message(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  with actor as (select auth.uid() session_id,public.current_authorization_principal() principal_id)
  select exists(select 1 from public.support_conversations c cross join actor
    where c.id=p_conversation_id and c.status='open' and (
      (c.member_id=actor.session_id and c.conversation_type in ('general','product') and public.is_support_member(actor.session_id))
      or (public.support_access_role(actor.principal_id)='operator' and c.assigned_staff_id=actor.principal_id
        and public.support_store_operator(c.store_id)=actor.principal_id)
      or (public.support_access_role(actor.principal_id)='employee' and exists(select 1 from public.store_memberships m
        where m.store_id=c.store_id and m.user_id=actor.principal_id and m.membership_role='employee' and m.status='active'))
      or public.is_owner()
    ));
$$;

create or replace function public.send_support_message(p_conversation_id uuid,p_body text,p_client_nonce uuid)
returns setof public.support_messages language plpgsql security definer set search_path='' as $$
declare v_sender uuid; v_body text:=btrim(coalesce(p_body,''));
begin
  if not public.can_send_support_message(p_conversation_id) then raise exception using errcode='42501',message='이 상담에 메시지를 보낼 권한이 없습니다.'; end if;
  if char_length(v_body) not between 1 and 2000 or p_client_nonce is null then raise exception using errcode='22023',message='메시지와 전송 식별자를 확인해 주세요.'; end if;
  select case when c.member_id=auth.uid() then auth.uid() else public.current_authorization_principal() end into v_sender
  from public.support_conversations c where c.id=p_conversation_id;
  return query insert into public.support_messages(conversation_id,sender_id,body,client_nonce)
    values(p_conversation_id,v_sender,v_body,p_client_nonce)
    on conflict(sender_id,client_nonce) do update set body=excluded.body
    where public.support_messages.conversation_id=excluded.conversation_id and public.support_messages.body=excluded.body
    returning public.support_messages.*;
end; $$;

revoke all on function public.send_support_message(uuid,text,uuid) from public,anon,service_role;
grant execute on function public.send_support_message(uuid,text,uuid) to authenticated;

commit;
