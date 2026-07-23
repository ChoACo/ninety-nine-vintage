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
  if exists(select 1 from public.fulfillment_center_staff_assignments) then
    raise exception 'cutover must remove owner and anonymous center assignments';
  end if;
  if not exists(
    select 1
    from pg_catalog.pg_constraint as constraints
    where constraints.contype='f'
      and constraints.conrelid='public.profiles'::regclass
      and constraints.confrelid='app_private.ledger_principals'::regclass
  ) then
    raise exception 'profiles must belong to a ledger principal after auth separation';
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
    'public.configure_managed_fulfillment_center(text,uuid,text,text,boolean,text,text,text,text,text,bigint,uuid)'::regprocedure,
    'public.get_my_center_management()'::regprocedure,
    'public.configure_assigned_fulfillment_center(text,uuid,text,text,boolean,text,text,text,text,text,bigint)'::regprocedure,
    'public.pause_managed_product(uuid,timestamptz)'::regprocedure,
    'public.set_site_status(text,text)'::regprocedure,
    'public.set_managed_staff_role(uuid,text,uuid)'::regprocedure
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
delete from public.nickname_change_requests
where member_id=(select user_id from public.account_access_roles where role_code='owner');
update public.profiles
set nickname_initialized_at=null,nickname_self_change_used_at=null
where id=(select user_id from public.account_access_roles where role_code='owner');
set local role authenticated;

do $$
declare
  v_owner uuid:=auth.uid();
  v_nickname_request uuid;
  v_created jsonb;
  v_replay jsonb;
  v_updated jsonb;
  v_site jsonb;
begin
  if not exists(select 1 from public.get_manager_member_directory(500,0) d where d.id=v_owner and d.access_role='owner') then
    raise exception 'owner directory must include the owner row';
  end if;
  if public.set_my_initial_nickname('소유자 검증')<>'소유자 검증' then
    raise exception 'owner initial nickname save failed';
  end if;
  v_nickname_request:=public.request_my_nickname_change('소유자 검증 변경');
  if v_nickname_request is null then
    raise exception 'owner nickname review request failed';
  end if;
  perform public.update_managed_member(v_owner,'','010-1234-5678');
  if not exists(
    select 1 from public.member_accounts
    where member_id=v_owner and phone='010-1234-5678'
  ) then
    raise exception 'owner self contact update failed';
  end if;
  begin
    perform public.set_managed_member_status(v_owner,'suspended',null,'owner protection test');
    raise exception 'owner status mutation should have failed';
  exception when sqlstate '42501' then null;
  end;

  v_site := public.set_site_status('maintenance', '관리자 저장 검증');
  if v_site->>'status' <> 'maintenance'
    or v_site->>'message' <> '관리자 저장 검증'
    or (v_site->>'updatedBy')::uuid <> v_owner
  then
    raise exception 'site status RPC must persist the authenticated owner save';
  end if;

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
update public.profiles
set deleted_at=null,anonymized_reference=null
where id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
update public.member_accounts
set account_status='active',suspended_until=null,suspension_reason=null
where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
insert into public.account_access_roles(user_id,role_code)
values('9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d','member');
delete from public.member_sanction_events
where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
delete from public.member_bid_sanctions
where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
delete from public.member_warnings
where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
delete from app_private.withdrawn_member_retention
where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
update app_private.ledger_principals
set principal_kind='account',anonymized_at=null
where id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
set local role authenticated;
do $$
declare
  v_member uuid := '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
  v_sanction jsonb;
  v_status_result jsonb;
begin
  v_status_result:=public.set_managed_member_status(
    v_member,
    'suspended',
    null,
    '무기한 정지 버튼 검증'
  );
  if v_status_result->>'status'<>'suspended'
    or not exists(
      select 1 from public.get_manager_member_directory(500,0)
      where id=v_member and account_status='suspended'
    )
  then
    raise exception 'member suspended action failed';
  end if;

  v_status_result:=public.set_managed_member_status(
    v_member,
    'temporary_suspended',
    clock_timestamp()+interval '2 hours',
    '일시 정지 버튼 검증'
  );
  if v_status_result->>'status'<>'temporary_suspended'
    or not exists(
      select 1 from public.get_manager_member_directory(500,0)
      where id=v_member and account_status='temporary_suspended'
        and suspended_until>clock_timestamp()
    )
  then
    raise exception 'member temporary suspension action failed';
  end if;

  v_status_result:=public.set_managed_member_status(
    v_member,
    'active',
    null,
    '활성 버튼 검증'
  );
  if v_status_result->>'status'<>'active'
    or not exists(
      select 1 from public.get_manager_member_directory(500,0)
      where id=v_member and account_status='active'
        and suspended_until is null and suspension_reason is null
    )
  then
    raise exception 'member activation action failed';
  end if;

  perform public.add_member_warning(v_member,'manual','경고 버튼 검증');
  perform public.create_member_24_hour_sanction(v_member,'24시간 제재 버튼 검증');
  select active_sanctions->0 into strict v_sanction
  from public.get_manager_member_directory(500,0)
  where id=v_member;
  if (v_sanction->>'endsAt')::timestamptz
      -(v_sanction->>'startsAt')::timestamptz<>interval '24 hours'
  then
    raise exception '24 hour sanction must use the database clock exactly';
  end if;

  perform public.clear_member_enforcement_history(
    v_member,
    'warnings',
    '경고 누적 삭제 버튼 검증'
  );
  perform public.clear_member_enforcement_history(
    v_member,
    'sanctions',
    '제재 누적 삭제 버튼 검증'
  );
  if exists(
    select 1 from public.get_manager_member_directory(500,0)
    where id=v_member and (warning_count<>0 or sanction_count<>0)
  )
  then
    raise exception 'enforcement reset actions failed';
  end if;

  perform public.prepare_managed_member_deletion(
    v_member,
    '탈퇴 회원 7일 보관 검증'
  );
  if exists(
    select 1 from public.get_manager_member_directory(500,0)
    where id=v_member
  ) or not exists(
    select 1 from public.get_owner_withdrawn_member_retention(500,0)
    where member_id=v_member and retention_status='retained'
  ) then
    raise exception 'withdrawn member separation failed';
  end if;

  begin
    perform public.retry_withdrawn_member_cleanup(v_member);
    raise exception 'retention cleanup before seven days should have failed';
  exception when sqlstate '55000' then null;
  end;
end;
$$;
reset role;

delete from auth.users
where id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';

do $$
begin
  if exists(
    select 1 from auth.users
    where id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'
  ) or not exists(
    select 1 from public.profiles
    where id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'
      and deleted_at is not null
  ) then
    raise exception 'auth deletion must retain the anonymized profile for seven days';
  end if;
end;
$$;

update app_private.withdrawn_member_retention
set
  deleted_at=statement_timestamp()-interval '8 days',
  purge_due_at=statement_timestamp()-interval '1 day'
where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';

set local role authenticated;
select public.retry_withdrawn_member_cleanup(
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'
);
reset role;
do $$
declare v_member uuid := '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
begin
  if exists(select 1 from public.profiles where id=v_member)
    or exists(
      select 1 from app_private.withdrawn_member_retention
      where member_id=v_member
    )
    or not exists(
      select 1 from app_private.ledger_principals
      where id=v_member and principal_kind='anonymous_ledger'
    )
  then
    raise exception 'withdrawn member retained cleanup failed';
  end if;
end;
$$;
rollback;

begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.account_access_roles where role_code='owner'),true);
update public.profiles
set deleted_at=null,anonymized_reference=null
where id='4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee';
insert into public.account_access_roles(user_id,role_code)
values('4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee','operator');
set local role authenticated;
do $$
declare
  v_center uuid := (
    select id from public.fulfillment_centers
    where status='active'
    order by name,id
    limit 1
  );
  v_user uuid := '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee';
  v_created jsonb;
  v_updated jsonb;
  v_deleted jsonb;
begin
  v_created := public.configure_fulfillment_center_staff_assignment(
    v_center,
    v_user,
    false,
    false,
    'active',
    0,
    'a2000000-0000-4000-8000-000000000001'
  );
  if not (v_created->>'receiveAtCenter')::boolean
    or not (v_created->>'createShipments')::boolean
  then
    raise exception 'center capabilities must derive from the staff role';
  end if;
  v_updated := public.configure_fulfillment_center_staff_assignment(
    v_center,
    v_user,
    false,
    false,
    'inactive',
    (v_created->>'version')::bigint,
    'a2000000-0000-4000-8000-000000000002'
  );
  if v_updated->>'status'<>'inactive' then
    raise exception 'center assignment edit failed';
  end if;
  v_deleted := public.delete_fulfillment_center_staff_assignment(
    v_center,
    v_user,
    (v_updated->>'version')::bigint,
    'a2000000-0000-4000-8000-000000000003'
  );
  if not (v_deleted->>'deleted')::boolean then
    raise exception 'center assignment delete failed';
  end if;
end;
$$;
reset role;
do $$
begin
  if exists(
    select 1 from public.fulfillment_center_staff_assignments
    where user_id='4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'
  ) then
    raise exception 'deleted center assignment row must not remain';
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
update public.profiles
set
  display_name='가입 전 이름',
  nickname_initialized_at=null,
  nickname_self_change_used_at=null
where id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
delete from public.member_sanction_events where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
delete from public.member_bid_sanctions where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
delete from public.member_warnings where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';

set local role authenticated;
select set_config('request.jwt.claim.sub','9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',true);
do $$
declare v_request uuid;
begin
  if public.set_my_initial_nickname('첫 닉네임') <> '첫 닉네임' then
    raise exception 'initial nickname save failed';
  end if;
  if exists(
    select 1 from public.get_my_nickname_state()
    where not is_initialized or can_change_once
  ) then
    raise exception 'initial nickname state must require review for every later change';
  end if;
  v_request := public.request_my_nickname_change('승인 닉네임');
  if v_request is null then raise exception 'nickname review request was not created'; end if;
end;
$$;
select set_config('request.jwt.claim.sub','4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',true);
do $$
declare v_member uuid:='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'; v_sanction uuid;
begin
  if public.review_nickname_change_request(
    (select request_id from public.get_pending_nickname_change_requests()
      where member_id=v_member limit 1),
    true,
    '운영자 승인 검증'
  ) <> 'approved' then
    raise exception 'operator nickname approval failed';
  end if;
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
  if (select display_name from public.profiles where id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d') <> '승인 닉네임' then
    raise exception 'approved nickname was not persisted';
  end if;
  if (select count(*) from public.member_sanction_events where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d')<>3 then
    raise exception 'sanction lifecycle audit is incomplete';
  end if;
end;
$$;
update public.member_accounts set account_status='temporary_suspended',suspended_until=clock_timestamp()-interval '1 minute' where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
do $$ begin if public.effective_member_account_status('9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d')<>'active' then raise exception 'expired temporary suspension must resolve to active'; end if; end $$;
rollback;

begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.account_access_roles where role_code='owner'),true);
update public.profiles set deleted_at=null,anonymized_reference=null where id='4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee';
insert into public.account_access_roles(user_id,role_code) values('4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee','operator');
update public.profiles set deleted_at=null,anonymized_reference=null where id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
insert into public.account_access_roles(user_id,role_code) values('9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d','band_member');
delete from public.member_sanction_events where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
delete from public.member_bid_sanctions where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
delete from public.member_warnings where member_id='9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
set local role authenticated;
select set_config('request.jwt.claim.sub','4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',true);
select * from public.add_member_warning(
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  'late_payment',
  '자동 미입금 검증'
);
reset role;
do $$
declare
  v_band uuid := '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
begin
  if exists(select 1 from public.member_warnings where member_id=v_band) then
    raise exception 'band late payment must not create an automatic warning';
  end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',true);
select * from public.add_member_warning(
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  'manual',
  '운영자 수동 경고'
);
reset role;
do $$
declare
  v_band uuid := '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
begin
  if (select count(*) from public.member_warnings where member_id=v_band)<>1
    or exists(select 1 from public.member_bid_sanctions where member_id=v_band)
  then
    raise exception 'band manual warning must persist without automatic sanction';
  end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',true);
select public.manage_member_sanction(
  'create',
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  null,
  clock_timestamp(),
  clock_timestamp()+interval '1 day',
  '운영자 수동 제재'
);
reset role;
do $$
declare
  v_band uuid := '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';
begin
  if not exists(
    select 1 from public.member_bid_sanctions
    where member_id=v_band and source='manual' and status='active'
  ) then
    raise exception 'band manual sanction must remain available';
  end if;
end;
$$;
rollback;
