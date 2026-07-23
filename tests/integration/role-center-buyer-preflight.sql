\set ON_ERROR_STOP on

do $$
begin
  if (select count(*) from public.account_access_roles where role_code='owner')<>1 then
    raise exception 'cutover must retain exactly one owner';
  end if;
  if exists(select 1 from public.account_access_roles where role_code<>'owner') then
    raise exception 'cutover must remove every non-owner access role';
  end if;
  if (select count(*) from public.fulfillment_centers where status='active')<>2
    or (select count(*) from public.fulfillment_centers where status='active' and name in ('나인티 나인 빈티지','다미네 옷가게'))<>2 then
    raise exception 'cutover must expose exactly the two canonical centers';
  end if;
  if (select count(*) from public.stores where is_active)<>2
    or (select count(*) from public.stores where is_active and name in ('나인티 나인 빈티지','다미네 옷가게'))<>2
    or (select count(*) from public.stores where is_active and slug in ('ninety-nine-vintage','dami-clothing-shop-b'))<>2 then
    raise exception 'cutover must expose exactly the two canonical stores';
  end if;
  if exists(select 1 from public.stores where not is_active) then
    raise exception 'cutover must remove every legacy store';
  end if;
  if exists(select 1 from public.products) then
    raise exception 'cutover must remove every test product';
  end if;
  if (select count(*) from public.fulfillment_center_staff_assignments a
      join public.account_access_roles r on r.user_id=a.user_id and r.role_code='owner'
      join public.fulfillment_centers c on c.id=a.fulfillment_center_id and c.status='active'
      where a.status='active')<>2 then
    raise exception 'owner must be assigned to both canonical centers';
  end if;
  if not exists(
    select 1 from public.stores s join public.store_fulfillment_routes r on r.store_id=s.id
    join public.fulfillment_centers c on c.id=r.fulfillment_center_id
    where s.name='나인티 나인 빈티지' and c.name='다미네 옷가게' and r.route_mode='transfer' and r.status='active'
  ) or not exists(
    select 1 from public.stores s join public.store_fulfillment_routes r on r.store_id=s.id
    join public.fulfillment_centers c on c.id=r.fulfillment_center_id
    where s.name='다미네 옷가게' and c.name='다미네 옷가게' and r.route_mode='co_located' and r.status='active'
  ) then
    raise exception 'canonical A to B and B to B routes are required';
  end if;
end;
$$;

do $$
declare v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.add_member_warning(uuid,text,text)'::regprocedure,
    'public.adjust_member_shipping_credits(uuid,integer)'::regprocedure,
    'public.update_managed_member(uuid,text,text)'::regprocedure,
    'public.can_manage_members()'::regprocedure,
    'public.get_manager_member_directory(integer,integer)'::regprocedure,
    'public.get_operator_member_directory(integer,integer)'::regprocedure,
    'public.configure_managed_fulfillment_center(text,uuid,text,text,boolean,text,text,text,text,text,bigint,uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon',v_signature,'execute') then
      raise exception 'anonymous role must not execute manager RPC %',v_signature;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.release_paid_inventory_items(uuid[],bigint[],uuid,text)'::regprocedure,
    'public.release_inventory_shipment_items(uuid,uuid[],bigint,uuid,text)'::regprocedure,
    'public.record_inventory_center_items(text,uuid[],bigint[],text,uuid,text)'::regprocedure
  ] loop
    if has_function_privilege('anon',v_signature,'execute')
      or has_function_privilege('authenticated',v_signature,'execute') then
      raise exception 'raw fulfillment RPC must remain private %',v_signature;
    end if;
  end loop;
end;
$$;

begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.account_access_roles where role_code='owner'),true);
set local role authenticated;

do $$
declare v_owner uuid:=auth.uid(); v_created jsonb; v_replay jsonb; v_updated jsonb;
begin
  if not exists(select 1 from public.get_manager_member_directory(500,0) d where d.id=v_owner and d.access_role='owner') then
    raise exception 'owner directory must include the owner row';
  end if;
  begin
    perform public.set_managed_member_status(v_owner,'suspended',null,'owner protection test');
    raise exception 'owner status mutation should have failed';
  exception when sqlstate '42501' then null;
  end;

  v_created:=public.configure_managed_fulfillment_center(
    'create',null,'preflight-center','배포 전 검증 센터',false,'12345','서울시 검증로 1','2층','검증 담당','010-0000-0000',0,
    'a1000000-0000-4000-8000-000000000001'
  );
  v_replay:=public.configure_managed_fulfillment_center(
    'create',null,'preflight-center','배포 전 검증 센터',false,'12345','서울시 검증로 1','2층','검증 담당','010-0000-0000',0,
    'a1000000-0000-4000-8000-000000000001'
  );
  if not coalesce((v_replay->>'idempotent_replay')::boolean,false) then raise exception 'center create replay must be idempotent'; end if;
  v_updated:=public.configure_managed_fulfillment_center(
    'update',(v_created->>'id')::uuid,'preflight-center','배포 전 검증 센터 수정',false,'54321','서울시 검증로 2','3층','새 담당','010-1111-1111',
    (v_created->>'version')::bigint,'a1000000-0000-4000-8000-000000000002'
  );
  if not exists(select 1 from public.fulfillment_centers where id=(v_created->>'id')::uuid and address_line1='서울시 검증로 2' and contact_name='새 담당') then
    raise exception 'center address and contact update failed';
  end if;
  perform public.configure_managed_fulfillment_center(
    'archive',(v_created->>'id')::uuid,'preflight-center','배포 전 검증 센터 수정',false,'54321','서울시 검증로 2','3층','새 담당','010-1111-1111',
    (v_updated->>'version')::bigint,'a1000000-0000-4000-8000-000000000003'
  );
  if not exists(select 1 from public.fulfillment_centers where id=(v_created->>'id')::uuid and status='archived') then
    raise exception 'center archival failed';
  end if;
end;
$$;
rollback;

begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.account_access_roles where role_code='owner'),true);
update public.profiles set deleted_at=null,anonymized_reference=null where id='4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee';
insert into public.account_access_roles(user_id,role_code) values('4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee','operator');
update public.profiles set deleted_at=null,anonymized_reference=null where id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
insert into public.account_access_roles(user_id,role_code) values('9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d','member');
update public.member_accounts set account_status='active',suspended_until=null where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
delete from public.member_sanction_events where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
delete from public.member_bid_sanctions where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
delete from public.member_warnings where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';

set local role authenticated;
select set_config('request.jwt.claim.sub','4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',true);
do $$
declare v_member uuid:='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'; v_sanction uuid;
begin
  if public.can_manage_members() or not public.can_manage_member_enforcement() then raise exception 'operator privilege split is invalid'; end if;
  begin perform * from public.get_manager_member_directory(10,0); raise exception 'operator full directory should fail'; exception when sqlstate '42501' then null; end;
  if not exists(select 1 from public.get_operator_member_directory(50,0) where id=v_member) then raise exception 'operator limited directory must include a normal member'; end if;
  if exists(select 1 from public.profiles where id=v_member) then raise exception 'operator must not read another member profile directly'; end if;
  begin perform public.set_managed_member_status(v_member,'suspended',null,'denied'); raise exception 'operator status mutation should fail'; exception when sqlstate '42501' then null; end;
  perform public.add_member_warning(v_member,'manual','첫 번째 경고');
  perform public.add_member_warning(v_member,'manual','두 번째 경고');
  perform public.add_member_warning(v_member,'manual','세 번째 경고');
  select (active_sanctions->0->>'id')::uuid into strict v_sanction
  from public.get_operator_member_directory(50,0) where id=v_member;
  perform public.manage_member_sanction('update',v_member,v_sanction,null,clock_timestamp()+interval '2 days','기간 수정');
  perform public.manage_member_sanction('cancel',v_member,v_sanction,null,null,'제재 취소');
end;
$$;
reset role;
do $$
begin
  if (select count(*) from public.member_sanction_events where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d')<>3 then
    raise exception 'sanction lifecycle audit is incomplete';
  end if;
end;
$$;
update public.member_accounts set account_status='temporary_suspended',suspended_until=clock_timestamp()-interval '1 minute' where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
do $$ begin if public.effective_member_account_status('9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d')<>'active' then raise exception 'expired temporary suspension must resolve to active'; end if; end $$;
rollback;
