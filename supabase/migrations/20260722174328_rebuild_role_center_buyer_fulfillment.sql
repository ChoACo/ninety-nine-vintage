-- Rebuild access control, center ownership, and buyer-safe fulfillment without
-- relying on generated user UUIDs. The single owner role is the management
-- boundary; operators receive only subordinate-role and sanction permissions.

alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists anonymized_reference text;

-- Deleted authentication subjects leave an anonymized profile tombstone so
-- immutable order, inventory, refund and shipment foreign keys remain valid.
alter table public.profiles drop constraint if exists profiles_id_fkey;
create unique index if not exists profiles_anonymized_reference_idx
  on public.profiles (anonymized_reference)
  where anonymized_reference is not null;

-- Retire the former protected hidden-test-member apparatus. Its append-only
-- audit remains historical, but dummy accounts are no longer mutation-proof.
drop trigger if exists account_access_roles_protect_hidden_test on public.account_access_roles;
drop trigger if exists profiles_protect_hidden_test_write on public.profiles;
drop trigger if exists member_accounts_protect_hidden_test_write on public.member_accounts;
drop trigger if exists shipping_addresses_protect_hidden_test_write on public.shipping_addresses;
drop trigger if exists shipping_requests_protect_hidden_test_write on public.shipping_requests;
drop trigger if exists payment_orders_protect_hidden_test_write on public.payment_orders;
drop trigger if exists manual_transfer_orders_protect_hidden_test_write on public.manual_transfer_orders;
drop trigger if exists member_warnings_protect_hidden_test_write on public.member_warnings;
drop trigger if exists member_bid_sanctions_protect_hidden_test_write on public.member_bid_sanctions;
drop trigger if exists support_conversations_protect_hidden_test_write on public.support_conversations;

alter table public.member_accounts
  add column if not exists suspended_until timestamptz,
  add column if not exists suspension_reason text,
  add column if not exists status_updated_by uuid references public.profiles(id) on delete set null;
alter table public.member_accounts drop constraint if exists member_accounts_account_status_check;
alter table public.member_accounts add constraint member_accounts_account_status_check
  check (account_status in ('active','suspended','temporary_suspended','deleted'));
alter table public.member_accounts add constraint member_accounts_temporary_suspension_check
  check (
    (account_status = 'temporary_suspended' and suspended_until is not null)
    or (account_status <> 'temporary_suspended')
  );

alter table public.fulfillment_centers drop constraint if exists fulfillment_centers_status_check;
alter table public.fulfillment_centers add constraint fulfillment_centers_status_check
  check (status in ('configuration_required','active','inactive','archived'));
alter table public.fulfillment_centers drop constraint if exists fulfillment_centers_default_status_check;
alter table public.fulfillment_centers add constraint fulfillment_centers_default_status_check
  check (not is_default or status = 'active');

alter table public.stores
  add column if not exists home_fulfillment_center_id uuid references public.fulfillment_centers(id) on delete restrict;
create index if not exists stores_home_fulfillment_center_idx
  on public.stores(home_fulfillment_center_id)
  where home_fulfillment_center_id is not null;

alter table public.member_bid_sanctions
  add column if not exists source text not null default 'automatic',
  add column if not exists reason text,
  add column if not exists status text not null default 'active',
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default clock_timestamp(),
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;
alter table public.member_bid_sanctions alter column warning_id drop not null;
alter table public.member_bid_sanctions add constraint member_bid_sanctions_source_check
  check (source in ('automatic','manual'));
alter table public.member_bid_sanctions add constraint member_bid_sanctions_status_check
  check (status in ('active','cancelled','completed'));
create index if not exists member_bid_sanctions_effective_idx
  on public.member_bid_sanctions(member_id,status,ends_at desc);

create table if not exists public.member_sanction_events (
  id uuid primary key default gen_random_uuid(),
  sanction_id uuid not null references public.member_bid_sanctions(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('created','updated','cancelled')),
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists member_sanction_events_member_time_idx
  on public.member_sanction_events(member_id,created_at desc);
alter table public.member_sanction_events enable row level security;
revoke all on table public.member_sanction_events from public,anon,authenticated;
grant select,insert on table public.member_sanction_events to service_role;

create or replace function public.audit_automatic_member_sanction()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.source='automatic' then
    insert into public.member_sanction_events(
      sanction_id,member_id,actor_user_id,event_type,after_snapshot,reason
    ) values(
      new.id,new.member_id,auth.uid(),'created',to_jsonb(new),new.reason
    );
  end if;
  return new;
end;
$$;
revoke all on function public.audit_automatic_member_sanction() from public,anon,authenticated;
drop trigger if exists member_bid_sanctions_audit_automatic on public.member_bid_sanctions;
create trigger member_bid_sanctions_audit_automatic
after insert on public.member_bid_sanctions
for each row execute function public.audit_automatic_member_sanction();

create or replace function public.access_role_for_user(p_user_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when p.deleted_at is not null then null
    when r.role_code = 'owner' and exists (
      select 1 from auth.users u where u.id = r.user_id
    ) then 'owner'
    when r.role_code <> 'owner' and public.auth_user_has_kakao_identity(r.user_id)
      then r.role_code
    else null
  end
  from public.account_access_roles r
  join public.profiles p on p.id = r.user_id
  where r.user_id = p_user_id;
$$;
revoke all on function public.access_role_for_user(uuid) from public,anon;
grant execute on function public.access_role_for_user(uuid) to authenticated,service_role;

create or replace function public.validate_account_access_role()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.role_code = 'owner' and
     row(new.user_id,new.role_code,new.reports_to_operator_id)
       is distinct from row(old.user_id,old.role_code,old.reports_to_operator_id)
  then
    raise exception using errcode='42501',message='소유자 역할은 변경하거나 이전할 수 없습니다.';
  end if;
  if new.role_code = 'owner' then
    if new.reports_to_operator_id is not null or not exists(select 1 from auth.users where id=new.user_id) then
      raise exception using errcode='23514',message='유효한 인증 계정만 소유자 역할을 유지할 수 있습니다.';
    end if;
  elsif not public.auth_user_has_kakao_identity(new.user_id) then
    raise exception using errcode='23514',message='Kakao 인증 계정에만 운영 역할을 부여할 수 있습니다.';
  end if;
  if new.role_code <> 'employee' and new.reports_to_operator_id is not null then
    raise exception using errcode='23514',message='담당 운영자는 직원 역할에만 지정할 수 있습니다.';
  end if;
  if new.role_code = 'employee' and new.reports_to_operator_id is null then
    raise exception using errcode='23514',message='직원에게 담당 운영자를 지정해 주세요.';
  end if;
  if new.reports_to_operator_id is not null and not exists(
    select 1 from public.account_access_roles r
    where r.user_id=new.reports_to_operator_id and r.role_code='operator'
  ) then
    raise exception using errcode='23514',message='유효한 운영자를 지정해 주세요.';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_account_access_role() from public,anon,authenticated;

create or replace function public.protect_owner_auth_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists(select 1 from public.account_access_roles r where r.user_id=old.id and r.role_code='owner') then
    raise exception using errcode='42501',message='소유자 인증 계정은 삭제할 수 없습니다.';
  end if;
  return old;
end;
$$;
revoke all on function public.protect_owner_auth_delete() from public,anon,authenticated;

create or replace function public.can_manage_members()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.access_role_for_user(auth.uid())='owner',false); $$;
revoke all on function public.can_manage_members() from public,anon;
grant execute on function public.can_manage_members() to authenticated;

create or replace function public.can_manage_member_enforcement()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.access_role_for_user(auth.uid()) in ('owner','operator'),false); $$;
revoke all on function public.can_manage_member_enforcement() from public,anon;
grant execute on function public.can_manage_member_enforcement() to authenticated;

-- Legacy payment and catalog commands use is_staff(), while full member
-- management now has its own owner-only predicate above. Keep these concerns
-- separate so operators retain operational commands without inheriting the
-- owner member directory.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.access_role_for_user(auth.uid()) in ('owner','operator'),false); $$;
revoke all on function public.is_staff() from public,anon;
grant execute on function public.is_staff() to authenticated;

drop policy if exists "Staff read member profiles" on public.profiles;
drop policy if exists "Operators read non-owner profiles" on public.profiles;
drop policy if exists "Owners read all profiles" on public.profiles;
create policy "Owners read all profiles" on public.profiles
for select to authenticated using ((select public.is_owner()));

create or replace function public.effective_member_account_status(p_member_id uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when a.account_status='temporary_suspended' and a.suspended_until <= clock_timestamp() then 'active'
    else a.account_status end
  from public.member_accounts a where a.member_id=p_member_id;
$$;
revoke all on function public.effective_member_account_status(uuid) from public,anon;
grant execute on function public.effective_member_account_status(uuid) to authenticated,service_role;

create or replace function public.get_manager_member_directory(p_limit integer default 200,p_offset integer default 0)
returns table(
  id uuid,display_name text,legal_name text,email text,phone text,gender text,birth_year smallint,
  kakao_profile_complete boolean,kakao_synced_at timestamptz,account_status text,suspended_until timestamptz,
  suspension_reason text,shipping_credit_count integer,address_count bigint,bid_count bigint,support_status text,
  created_at timestamptz,last_seen_at timestamptz,access_role text,warning_count integer,sanction_count integer,
  bid_blocked_until timestamptz,payment_deadline_exempt boolean,active_sanctions jsonb,is_deleted boolean
)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.'; end if;
  if p_limit is null or p_limit not between 1 and 500 or p_offset is null or p_offset<0 then
    raise exception using errcode='22023',message='페이지 범위를 확인해 주세요.';
  end if;
  return query
  select p.id,p.display_name,k.full_name,u.email::text,a.phone,k.gender,k.birth_year,
    coalesce(k.profile_complete,false),k.last_synced_at,public.effective_member_account_status(p.id),
    a.suspended_until,a.suspension_reason,a.shipping_credit_count,
    (select count(*) from public.shipping_addresses x where x.member_id=p.id),
    (select count(*) from public.auction_bids x where x.bidder_id=p.id),
    (select c.status from public.support_conversations c where c.member_id=p.id order by (c.status='open') desc,c.last_message_at desc nulls last limit 1),
    p.created_at,coalesce(ls.last_seen_at,u.last_sign_in_at),r.role_code,
    (select count(*)::integer from public.member_warnings w where w.member_id=p.id),
    (select count(*)::integer from public.member_bid_sanctions s where s.member_id=p.id),
    (select max(s.ends_at) from public.member_bid_sanctions s where s.member_id=p.id and s.status='active' and s.ends_at>clock_timestamp()),
    r.role_code='band_member',
    coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'startsAt',s.starts_at,'endsAt',s.ends_at,'reason',s.reason,'source',s.source
    ) order by s.ends_at desc,s.id) from public.member_bid_sanctions s
      where s.member_id=p.id and s.status='active' and s.ends_at>clock_timestamp()),'[]'::jsonb),
    p.deleted_at is not null
  from public.profiles p
  left join auth.users u on u.id=p.id
  left join public.member_accounts a on a.member_id=p.id
  left join public.account_access_roles r on r.user_id=p.id
  left join public.kakao_member_profiles k on k.member_id=p.id
  left join public.account_last_seen ls on ls.user_id=p.id
  order by (r.role_code='owner') desc,p.created_at desc,p.id
  limit p_limit offset p_offset;
end;
$$;
revoke all on function public.get_manager_member_directory(integer,integer) from public,anon;
grant execute on function public.get_manager_member_directory(integer,integer) to authenticated;

create or replace function public.get_operator_member_directory(p_limit integer default 200,p_offset integer default 0)
returns table(id uuid,display_name text,access_role text,reports_to_operator_id uuid,warning_count integer,sanction_count integer,bid_blocked_until timestamptz,active_sanctions jsonb)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if public.access_role_for_user(auth.uid())<>'operator' then raise exception using errcode='42501',message='운영자 권한이 필요합니다.'; end if;
  return query
  select p.id,p.display_name,r.role_code,r.reports_to_operator_id,
    (select count(*)::integer from public.member_warnings w where w.member_id=p.id),
    (select count(*)::integer from public.member_bid_sanctions s where s.member_id=p.id),
    (select max(s.ends_at) from public.member_bid_sanctions s where s.member_id=p.id and s.status='active' and s.ends_at>clock_timestamp()),
    coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'startsAt',s.starts_at,'endsAt',s.ends_at,'reason',s.reason,'source',s.source
    ) order by s.ends_at desc,s.id) from public.member_bid_sanctions s
      where s.member_id=p.id and s.status='active' and s.ends_at>clock_timestamp()),'[]'::jsonb)
  from public.profiles p join public.account_access_roles r on r.user_id=p.id
  where p.deleted_at is null and (
    r.role_code in ('band_member','member')
    or (r.role_code='employee' and r.reports_to_operator_id=auth.uid())
  )
  order by p.display_name,p.id limit greatest(1,least(coalesce(p_limit,200),500)) offset greatest(coalesce(p_offset,0),0);
end;
$$;
revoke all on function public.get_operator_member_directory(integer,integer) from public,anon;
grant execute on function public.get_operator_member_directory(integer,integer) to authenticated;

create or replace function public.set_member_access_role(p_member_id uuid,p_role_code text)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_actor text:=public.access_role_for_user(auth.uid()); v_current text; v_requested text:=lower(btrim(coalesce(p_role_code,''))); v_manager uuid;
begin
  if v_actor not in ('owner','operator') then raise exception using errcode='42501',message='역할 변경 권한이 없습니다.'; end if;
  if v_requested not in ('operator','employee','band_member','member') then raise exception using errcode='22023',message='지원하지 않는 역할입니다.'; end if;
  select role_code into v_current from public.account_access_roles where user_id=p_member_id for update;
  if v_current is null then raise exception using errcode='P0002',message='계정을 찾을 수 없습니다.'; end if;
  if v_current='owner' or (v_actor='operator' and (v_current='operator' or v_requested='operator')) then
    raise exception using errcode='42501',message='해당 역할은 변경할 수 없습니다.';
  end if;
  if v_actor='operator' and v_current='employee' and exists(
    select 1 from public.account_access_roles where user_id=p_member_id and reports_to_operator_id is distinct from auth.uid()
  ) then raise exception using errcode='42501',message='다른 운영자의 직원을 변경할 수 없습니다.'; end if;
  v_manager:=case when v_requested='employee' and v_actor='operator' then auth.uid()
    when v_requested='employee' then (select user_id from public.account_access_roles where role_code='operator' order by created_at,user_id limit 1)
    else null end;
  if v_requested='employee' and v_manager is null then raise exception using errcode='23514',message='운영자를 먼저 지정해 주세요.'; end if;
  update public.account_access_roles set role_code=v_requested,reports_to_operator_id=v_manager where user_id=p_member_id;
  return v_requested;
end;
$$;
revoke all on function public.set_member_access_role(uuid,text) from public,anon;
grant execute on function public.set_member_access_role(uuid,text) to authenticated;

create or replace function public.set_managed_member_status(p_member_id uuid,p_status text,p_suspended_until timestamptz default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_status text:=lower(btrim(coalesce(p_status,''))); v_role text;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.'; end if;
  select role_code into v_role from public.account_access_roles where user_id=p_member_id for update;
  if v_role is null then raise exception using errcode='P0002',message='계정을 찾을 수 없습니다.'; end if;
  if v_role='owner' then raise exception using errcode='42501',message='소유자 계정 상태는 변경할 수 없습니다.'; end if;
  if v_status not in ('active','suspended','temporary_suspended') then raise exception using errcode='22023',message='계정 상태를 확인해 주세요.'; end if;
  if v_status='temporary_suspended' and (p_suspended_until is null or p_suspended_until<=clock_timestamp()) then
    raise exception using errcode='22023',message='현재 이후의 정지 만료일을 입력해 주세요.';
  end if;
  update public.member_accounts set account_status=v_status,suspended_until=case when v_status='temporary_suspended' then p_suspended_until end,
    suspension_reason=nullif(btrim(coalesce(p_reason,'')),''),status_updated_by=auth.uid(),updated_at=clock_timestamp()
  where member_id=p_member_id;
  return jsonb_build_object('memberId',p_member_id,'status',v_status,'suspendedUntil',case when v_status='temporary_suspended' then p_suspended_until end);
end;
$$;
revoke all on function public.set_managed_member_status(uuid,text,timestamptz,text) from public,anon;
grant execute on function public.set_managed_member_status(uuid,text,timestamptz,text) to authenticated;

create or replace function public.prepare_managed_member_deletion(p_member_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_role text; v_ref text:='deleted-'||replace(gen_random_uuid()::text,'-','');
begin
  if not public.is_owner() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.'; end if;
  select role_code into v_role from public.account_access_roles where user_id=p_member_id for update;
  if v_role is null then raise exception using errcode='P0002',message='계정을 찾을 수 없습니다.'; end if;
  if v_role='owner' then raise exception using errcode='42501',message='소유자 계정은 삭제할 수 없습니다.'; end if;
  update public.stores set operator_id=auth.uid(),updated_at=clock_timestamp() where operator_id=p_member_id;
  update public.support_conversations set assigned_staff_id=null where assigned_staff_id=p_member_id;
  delete from public.shipping_addresses where member_id=p_member_id;
  delete from public.kakao_member_profiles where member_id=p_member_id;
  update public.member_accounts set phone=null,account_status='deleted',suspended_until=null,
    suspension_reason=left(coalesce(nullif(btrim(p_reason),''),'관리자 삭제'),500),status_updated_by=auth.uid(),updated_at=clock_timestamp()
  where member_id=p_member_id;
  update public.profiles set display_name='탈퇴 회원 '||right(v_ref,8),deleted_at=clock_timestamp(),anonymized_reference=v_ref where id=p_member_id;
  delete from public.account_access_roles where user_id=p_member_id;
  return jsonb_build_object('memberId',p_member_id,'anonymizedReference',v_ref,'prepared',true);
end;
$$;
revoke all on function public.prepare_managed_member_deletion(uuid,text) from public,anon;
grant execute on function public.prepare_managed_member_deletion(uuid,text) to authenticated;

create or replace function public.manage_member_sanction(p_action text,p_member_id uuid,p_sanction_id uuid default null,p_starts_at timestamptz default null,p_ends_at timestamptz default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_actor text:=public.access_role_for_user(auth.uid()); v_target text; v_row public.member_bid_sanctions%rowtype; v_before jsonb; v_action text:=lower(btrim(coalesce(p_action,''))); v_round integer;
begin
  if v_actor not in ('owner','operator') then raise exception using errcode='42501',message='제재 관리 권한이 없습니다.'; end if;
  select role_code into v_target from public.account_access_roles where user_id=p_member_id;
  if v_target not in ('band_member','member') then raise exception using errcode='42501',message='일반 회원 제재만 관리할 수 있습니다.'; end if;
  if v_action='create' then
    if p_ends_at is null or p_ends_at<=coalesce(p_starts_at,clock_timestamp()) or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
      raise exception using errcode='22023',message='제재 기간과 사유를 확인해 주세요.';
    end if;
    select coalesce(max(sanction_round),0)+1 into v_round from public.member_bid_sanctions where member_id=p_member_id;
    insert into public.member_bid_sanctions(member_id,warning_id,sanction_round,starts_at,ends_at,source,reason,status,updated_by)
    values(p_member_id,null,v_round,coalesce(p_starts_at,clock_timestamp()),p_ends_at,'manual',btrim(p_reason),'active',auth.uid()) returning * into v_row;
    insert into public.member_sanction_events(sanction_id,member_id,actor_user_id,event_type,after_snapshot,reason)
    values(v_row.id,p_member_id,auth.uid(),'created',to_jsonb(v_row),p_reason);
  else
    select * into v_row from public.member_bid_sanctions where id=p_sanction_id and member_id=p_member_id for update;
    if not found then raise exception using errcode='P0002',message='제재를 찾을 수 없습니다.'; end if;
    v_before:=to_jsonb(v_row);
    if v_action='update' then
      if p_ends_at is null or p_ends_at<=coalesce(p_starts_at,v_row.starts_at) then raise exception using errcode='22023',message='제재 기간을 확인해 주세요.'; end if;
      update public.member_bid_sanctions set starts_at=coalesce(p_starts_at,starts_at),ends_at=p_ends_at,
        reason=coalesce(nullif(btrim(p_reason),''),reason),status='active',updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=v_row.id returning * into v_row;
      insert into public.member_sanction_events(sanction_id,member_id,actor_user_id,event_type,before_snapshot,after_snapshot,reason)
      values(v_row.id,p_member_id,auth.uid(),'updated',v_before,to_jsonb(v_row),p_reason);
    elsif v_action='cancel' then
      update public.member_bid_sanctions set status='cancelled',starts_at=least(starts_at,clock_timestamp()-interval '1 second'),
        ends_at=clock_timestamp(),cancelled_by=auth.uid(),cancelled_at=clock_timestamp(),
        cancellation_reason=left(coalesce(nullif(btrim(p_reason),''),'관리자 취소'),500),updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=v_row.id returning * into v_row;
      insert into public.member_sanction_events(sanction_id,member_id,actor_user_id,event_type,before_snapshot,after_snapshot,reason)
      values(v_row.id,p_member_id,auth.uid(),'cancelled',v_before,to_jsonb(v_row),p_reason);
    else raise exception using errcode='22023',message='제재 작업을 확인해 주세요.'; end if;
  end if;
  return jsonb_build_object('id',v_row.id,'memberId',v_row.member_id,'status',v_row.status,'startsAt',v_row.starts_at,'endsAt',v_row.ends_at,'reason',v_row.reason);
end;
$$;
revoke all on function public.manage_member_sanction(text,uuid,uuid,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.manage_member_sanction(text,uuid,uuid,timestamptz,timestamptz,text) to authenticated;

-- Supabase default privileges granted these legacy manager RPCs directly to
-- anon when they were first created. They all enforce an authenticated actor,
-- but the exposed EXECUTE privilege is unnecessary and fails the API boundary.
revoke all on function public.add_member_warning(uuid,text,text) from public,anon;
revoke all on function public.adjust_member_shipping_credits(uuid,integer) from public,anon;
revoke all on function public.update_managed_member(uuid,text,text) from public,anon;
grant execute on function public.add_member_warning(uuid,text,text) to authenticated;
grant execute on function public.adjust_member_shipping_credits(uuid,integer) to authenticated;
grant execute on function public.update_managed_member(uuid,text,text) to authenticated;

create or replace function public.enforce_member_bid_eligibility()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_lock_key bigint; v_blocked_until timestamptz;
begin
  if new.bidder_id is null then return new; end if;
  if public.effective_member_account_status(new.bidder_id)<>'active' then
    raise exception using errcode='42501',message='정지된 계정은 입찰할 수 없습니다.';
  end if;
  v_lock_key:=hashtextextended('member-warning-enforcement:'||new.bidder_id::text,0);
  if not pg_try_advisory_xact_lock(v_lock_key) then raise exception using errcode='P0001',message='제재 상태를 갱신 중입니다.'; end if;
  select max(ends_at) into v_blocked_until from public.member_bid_sanctions
  where member_id=new.bidder_id and status='active' and ends_at>clock_timestamp();
  if v_blocked_until is not null then raise exception using errcode='42501',message=format('%s까지 입찰할 수 없습니다.',v_blocked_until); end if;
  return new;
end;
$$;
revoke all on function public.enforce_member_bid_eligibility() from public,anon,authenticated;

create or replace function public.has_store_permission(p_store_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(exists(
    select 1 from public.stores s join public.businesses b on b.id=s.business_id and b.status='active'
    where s.id=p_store_id and s.is_active and (
      public.is_owner()
      or exists(select 1 from public.store_memberships m where m.store_id=s.id and m.business_id=s.business_id and m.user_id=auth.uid() and m.status='active' and
        case lower(btrim(coalesce(p_permission,'')))
          when 'manage_products' then m.manage_products when 'publish_products' then m.publish_products
          when 'prepare_orders' then m.prepare_orders when 'confirm_payments' then m.confirm_payments
          when 'receive_at_center' then m.receive_at_center when 'create_shipments' then m.create_shipments
          when 'manage_staff' then m.manage_staff when 'view_reports' then m.view_reports else false end)
      or (lower(btrim(coalesce(p_permission,'')))='prepare_orders' and s.home_fulfillment_center_id is not null and exists(
        select 1 from public.fulfillment_center_staff_assignments a
        join public.fulfillment_centers c on c.id=a.fulfillment_center_id and c.status='active'
        where a.fulfillment_center_id=s.home_fulfillment_center_id and a.user_id=auth.uid() and a.status='active' and a.create_shipments
      ))
    )
  ),false);
$$;
revoke all on function public.has_store_permission(uuid,text) from public,anon;
grant execute on function public.has_store_permission(uuid,text) to authenticated;

create or replace function public.can_view_shared_fulfillment()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(public.is_owner() or exists(
    select 1 from public.fulfillment_center_staff_assignments a
    join public.fulfillment_centers c on c.id=a.fulfillment_center_id and c.status='active'
    where a.user_id=auth.uid() and a.status='active' and (a.receive_at_center or a.create_shipments)
  ),false);
$$;
revoke all on function public.can_view_shared_fulfillment() from public,anon;
grant execute on function public.can_view_shared_fulfillment() to authenticated;

create or replace function public.get_owner_fulfillment_staff_directory()
returns table(id uuid,display_name text,email text,role_code text,last_seen_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.'; end if;
  return query select p.id,p.display_name,u.email::text,r.role_code,coalesce(ls.last_seen_at,u.last_sign_in_at)
  from public.account_access_roles r join public.profiles p on p.id=r.user_id join auth.users u on u.id=r.user_id
  left join public.account_last_seen ls on ls.user_id=r.user_id
  where r.role_code in ('owner','operator','employee') and p.deleted_at is null
  order by case r.role_code when 'owner' then 0 when 'operator' then 1 else 2 end,p.display_name,p.id;
end;
$$;
revoke all on function public.get_owner_fulfillment_staff_directory() from public,anon;
grant execute on function public.get_owner_fulfillment_staff_directory() to authenticated;

create or replace function public.get_owner_inventory_fulfillment_configuration()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.'; end if;
  select jsonb_build_object(
    'stores',coalesce((select jsonb_agg(to_jsonb(q) order by q.name,q.id) from (
      select id,business_id,name,slug,description,is_active,updated_at from public.stores
    ) q),'[]'::jsonb),
    'centers',coalesce((select jsonb_agg(to_jsonb(q) order by q.name,q.id) from (
      select id,business_id,code,name,status,is_default,postal_code,address_line1,address_line2,contact_name,contact_phone,version,updated_at
      from public.fulfillment_centers
    ) q),'[]'::jsonb),
    'routes',coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id) from (
      select id,business_id,store_id,fulfillment_center_id,route_mode,status,version,updated_at from public.store_fulfillment_routes
    ) q),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id) from (
      select id,business_id,fulfillment_center_id,user_id,status,receive_at_center,create_shipments,version,updated_at from public.fulfillment_center_staff_assignments
    ) q),'[]'::jsonb),
    'rollouts',coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.business_id) from (
      select business_id,entitlement_projection_enabled,unified_inventory_reads_enabled,item_selected_shipments_enabled,shipping_fee_amount,version,updated_at from public.inventory_fulfillment_rollout_settings
    ) q),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_owner_inventory_fulfillment_configuration() from public,anon;
grant execute on function public.get_owner_inventory_fulfillment_configuration() to authenticated;

create or replace function public.configure_managed_fulfillment_center(
  p_action text,p_center_id uuid,p_code text,p_name text,p_is_default boolean,
  p_postal_code text,p_address_line1 text,p_address_line2 text,p_contact_name text,p_contact_phone text,
  p_expected_version bigint,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_center public.fulfillment_centers%rowtype;
  v_business uuid;
  v_actor uuid:=auth.uid();
  v_receipt public.fulfillment_command_receipts%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='요청 키가 필요합니다.'; end if;
  v_fingerprint:=app_private.fulfillment_command_fingerprint(jsonb_build_object(
    'action',v_action,'centerId',p_center_id,'code',btrim(coalesce(p_code,'')),'name',btrim(coalesce(p_name,'')),
    'isDefault',p_is_default,'postalCode',nullif(btrim(coalesce(p_postal_code,'')),''),
    'addressLine1',nullif(btrim(coalesce(p_address_line1,'')),''),'addressLine2',nullif(btrim(coalesce(p_address_line2,'')),''),
    'contactName',nullif(btrim(coalesce(p_contact_name,'')),''),'contactPhone',nullif(btrim(coalesce(p_contact_phone,'')),''),
    'expectedVersion',p_expected_version
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_idempotency_key::text,0));
  select * into v_receipt from public.fulfillment_command_receipts
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_receipt.command_name<>'configure_center' or v_receipt.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='같은 요청 키를 다른 센터 변경에 사용할 수 없습니다.';
    end if;
    return v_receipt.result||jsonb_build_object('idempotent_replay',true);
  end if;
  if v_action='create' then
    if btrim(coalesce(p_code,'')) !~ '^[a-z0-9-]{2,80}$' or char_length(btrim(coalesce(p_name,''))) not between 1 and 120 then
      raise exception using errcode='22023',message='센터 코드와 이름을 확인해 주세요.';
    end if;
    select id into v_business from public.businesses where status='active' order by created_at,id limit 1;
    insert into public.fulfillment_centers(
      business_id,code,name,status,is_default,postal_code,address_line1,address_line2,contact_name,contact_phone,created_by,updated_by
    ) values(
      v_business,btrim(p_code),btrim(p_name),'active',coalesce(p_is_default,false),
      nullif(btrim(coalesce(p_postal_code,'')),''),nullif(btrim(coalesce(p_address_line1,'')),''),
      nullif(btrim(coalesce(p_address_line2,'')),''),nullif(btrim(coalesce(p_contact_name,'')),''),
      nullif(btrim(coalesce(p_contact_phone,'')),''),v_actor,v_actor
    ) returning * into v_center;
  else
    select * into v_center from public.fulfillment_centers where id=p_center_id for update;
    if not found then raise exception using errcode='P0002',message='센터를 찾을 수 없습니다.'; end if;
    if v_center.version<>p_expected_version then raise exception using errcode='PT409',message='센터 정보가 변경되었습니다.'; end if;
    if v_action='update' then
      update public.fulfillment_centers set code=coalesce(nullif(btrim(p_code),''),code),name=coalesce(nullif(btrim(p_name),''),name),
        is_default=coalesce(p_is_default,is_default),postal_code=nullif(btrim(coalesce(p_postal_code,'')),''),
        address_line1=nullif(btrim(coalesce(p_address_line1,'')),''),address_line2=nullif(btrim(coalesce(p_address_line2,'')),''),
        contact_name=nullif(btrim(coalesce(p_contact_name,'')),''),contact_phone=nullif(btrim(coalesce(p_contact_phone,'')),''),
        version=version+1,updated_by=v_actor,updated_at=clock_timestamp()
      where id=v_center.id returning * into v_center;
    elsif v_action='archive' then
      if exists(select 1 from public.inventory_item_fulfillments f where f.fulfillment_center_id=v_center.id and f.current_stage not in ('shipped','cancelled')) then
        raise exception using errcode='55000',message='진행 중인 물류 상품이 있는 센터는 삭제할 수 없습니다.';
      end if;
      update public.fulfillment_centers set status='archived',is_default=false,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=v_center.id returning * into v_center;
      update public.fulfillment_center_staff_assignments set status='inactive',version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
      where fulfillment_center_id=v_center.id and status='active';
      update public.stores set home_fulfillment_center_id=null where home_fulfillment_center_id=v_center.id;
    else raise exception using errcode='22023',message='센터 작업을 확인해 주세요.'; end if;
  end if;
  v_result:=jsonb_build_object('id',v_center.id,'businessId',v_center.business_id,'code',v_center.code,'name',v_center.name,'status',v_center.status,'isDefault',v_center.is_default,'version',v_center.version,'idempotent_replay',false);
  insert into public.fulfillment_command_receipts(actor_user_id,idempotency_key,command_name,target_id,request_fingerprint,result)
  values(v_actor,p_idempotency_key,'configure_center',v_center.id,v_fingerprint,v_result);
  return v_result;
end;
$$;
revoke all on function public.configure_managed_fulfillment_center(text,uuid,text,text,boolean,text,text,text,text,text,bigint,uuid) from public,anon;
grant execute on function public.configure_managed_fulfillment_center(text,uuid,text,text,boolean,text,text,text,text,text,bigint,uuid) to authenticated;

create or replace function public.get_central_fulfillment_buyer_groups(p_limit integer default 300,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.can_view_shared_fulfillment() then raise exception using errcode='42501',message='중앙 출고 조회 권한이 없습니다.'; end if;
  with group_rows as (
    select 'release_paid_items'::text action,null::uuid work_id,null::bigint work_version,s.home_fulfillment_center_id action_center_id,hc.name action_center_name,
      i.fulfillment_center_id target_center_id,c.name target_center_name,i.member_id,pf.display_name buyer_name,i.origin_store_id,s.name origin_store_name,
      public.has_store_permission(i.origin_store_id,'prepare_orders') can_process,
      jsonb_agg(jsonb_build_object('inventoryItemId',i.id,'productId',i.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'version',f.version,'physicalStatus',f.current_stage,'isBlocked',f.is_blocked) order by i.work_due_date,i.id) items
    from public.customer_inventory_items i join public.inventory_item_fulfillments f on f.inventory_item_id=i.id
    join public.products p on p.id=i.product_id join public.profiles pf on pf.id=i.member_id join public.stores s on s.id=i.origin_store_id
    left join public.fulfillment_centers hc on hc.id=s.home_fulfillment_center_id join public.fulfillment_centers c on c.id=i.fulfillment_center_id
    where i.ownership_status='active' and f.current_stage in ('entitled','preparing') and not f.outbound_released
    group by s.home_fulfillment_center_id,hc.name,i.fulfillment_center_id,c.name,i.member_id,pf.display_name,i.origin_store_id,s.name
    union all
    select 'release_store_items',w.id,w.version,s.home_fulfillment_center_id,hc.name,w.fulfillment_center_id,c.name,
      sh.member_id,pf.display_name,w.origin_store_id,s.name,public.has_store_permission(w.origin_store_id,'prepare_orders'),
      jsonb_agg(jsonb_build_object('inventoryItemId',x.inventory_item_id,'productId',x.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'version',f.version,'physicalStatus',f.current_stage,'lineStatus',x.line_status,'isBlocked',f.is_blocked) order by x.inventory_item_id)
    from public.inventory_shipment_store_works w join public.inventory_shipments sh on sh.id=w.shipment_id
    join public.profiles pf on pf.id=sh.member_id join public.stores s on s.id=w.origin_store_id
    left join public.fulfillment_centers hc on hc.id=s.home_fulfillment_center_id join public.fulfillment_centers c on c.id=w.fulfillment_center_id
    join public.inventory_shipment_items x on x.shipment_id=w.shipment_id and x.origin_store_id=w.origin_store_id
    join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id join public.products p on p.id=x.product_id
    where w.status='collecting'
    group by w.id,w.version,s.home_fulfillment_center_id,hc.name,w.fulfillment_center_id,c.name,sh.member_id,pf.display_name,w.origin_store_id,s.name
    union all
    select case when f.current_stage='in_transit_to_center' then 'center_receive' else 'center_store' end,null,null,f.fulfillment_center_id,c.name,
      f.fulfillment_center_id,c.name,i.member_id,pf.display_name,i.origin_store_id,s.name,
      app_private.has_center_permission(f.fulfillment_center_id,'receive_at_center'),
      jsonb_agg(jsonb_build_object('inventoryItemId',i.id,'productId',i.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'version',f.version,'physicalStatus',f.current_stage,'isBlocked',f.is_blocked,'storageLocationCode',f.storage_location_code) order by f.updated_at,i.id)
    from public.inventory_item_fulfillments f join public.customer_inventory_items i on i.id=f.inventory_item_id
    join public.products p on p.id=i.product_id join public.profiles pf on pf.id=i.member_id join public.stores s on s.id=i.origin_store_id join public.fulfillment_centers c on c.id=f.fulfillment_center_id
    where f.current_stage in ('in_transit_to_center','center_received')
    group by f.current_stage,f.fulfillment_center_id,c.name,i.member_id,pf.display_name,i.origin_store_id,s.name
  )
  select jsonb_build_object('groups',coalesce(jsonb_agg(jsonb_build_object(
    'groupId',action||':'||coalesce(action_center_id::text,'none')||':'||member_id::text||':'||origin_store_id::text,
    'action',action,'workId',work_id,'workVersion',work_version,'actionCenterId',action_center_id,'actionCenterName',action_center_name,
    'targetCenterId',target_center_id,'targetCenterName',target_center_name,'buyerId',member_id,'buyerName',buyer_name,
    'originStoreId',origin_store_id,'originStoreName',origin_store_name,'canProcess',can_process,'items',items
  ) order by action_center_name,buyer_name,origin_store_name),'[]'::jsonb)) into v_result
  from (select * from group_rows order by action_center_name,buyer_name,origin_store_name limit greatest(1,least(coalesce(p_limit,300),500)) offset greatest(coalesce(p_offset,0),0)) q;
  return v_result;
end;
$$;
revoke all on function public.get_central_fulfillment_buyer_groups(integer,integer) from public,anon;
grant execute on function public.get_central_fulfillment_buyer_groups(integer,integer) to authenticated;

create or replace function public.release_buyer_inventory_shipment_items(p_work_id uuid,p_inventory_item_ids uuid[],p_expected_work_version bigint,p_idempotency_key uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(distinct x.member_id) from public.inventory_shipment_items x
      join public.inventory_shipment_store_works w on w.shipment_id=x.shipment_id and w.origin_store_id=x.origin_store_id
      where w.id=p_work_id and x.inventory_item_id=any(p_inventory_item_ids))<>1 then
    raise exception using errcode='22023',message='한 구매자의 상품만 함께 출고할 수 있습니다.';
  end if;
  return public.release_inventory_shipment_items(p_work_id,p_inventory_item_ids,p_expected_work_version,p_idempotency_key,p_note);
end;
$$;

create or replace function public.release_buyer_paid_inventory_items(p_inventory_item_ids uuid[],p_expected_versions bigint[],p_idempotency_key uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(distinct member_id) from public.customer_inventory_items where id=any(p_inventory_item_ids))<>1 then
    raise exception using errcode='22023',message='한 구매자의 상품만 함께 출고할 수 있습니다.';
  end if;
  return public.release_paid_inventory_items(p_inventory_item_ids,p_expected_versions,p_idempotency_key,p_note);
end;
$$;
create or replace function public.record_buyer_inventory_center_items(p_action text,p_inventory_item_ids uuid[],p_expected_versions bigint[],p_storage_location_code text,p_idempotency_key uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(distinct member_id) from public.customer_inventory_items where id=any(p_inventory_item_ids))<>1 then
    raise exception using errcode='22023',message='한 구매자의 상품만 함께 입고·보관할 수 있습니다.';
  end if;
  return public.record_inventory_center_items(p_action,p_inventory_item_ids,p_expected_versions,p_storage_location_code,p_idempotency_key,p_note);
end;
$$;
revoke all on function public.release_paid_inventory_items(uuid[],bigint[],uuid,text) from public,anon,authenticated;
revoke all on function public.release_inventory_shipment_items(uuid,uuid[],bigint,uuid,text) from public,anon,authenticated;
revoke all on function public.record_inventory_center_items(text,uuid[],bigint[],text,uuid,text) from public,anon,authenticated;
revoke all on function public.release_buyer_paid_inventory_items(uuid[],bigint[],uuid,text) from public,anon;
revoke all on function public.release_buyer_inventory_shipment_items(uuid,uuid[],bigint,uuid,text) from public,anon;
revoke all on function public.record_buyer_inventory_center_items(text,uuid[],bigint[],text,uuid,text) from public,anon;
grant execute on function public.release_buyer_paid_inventory_items(uuid[],bigint[],uuid,text) to authenticated;
grant execute on function public.release_buyer_inventory_shipment_items(uuid,uuid[],bigint,uuid,text) to authenticated;
grant execute on function public.record_buyer_inventory_center_items(text,uuid[],bigint[],text,uuid,text) to authenticated;

-- Canonical initial topology. Existing centers are retained only as archived
-- history; the two named centers are the only active centers after cutover.
do $$
declare v_owner uuid; v_business uuid; v_ninety_store uuid; v_dami_store uuid; v_ninety_center uuid; v_dami_center uuid; v_source_store uuid;
begin
  select user_id into strict v_owner from public.account_access_roles where role_code='owner';
  select id into strict v_business from public.businesses where status='active' order by created_at,id limit 1;
  select id into v_ninety_store
  from public.stores
  where name='나인티 나인 빈티지' or slug='ninety-nine-vintage'
  order by (name='나인티 나인 빈티지') desc,created_at,id
  limit 1;
  if v_ninety_store is null then
    insert into public.stores(slug,name,description,operator_id,business_id,is_active)
    values('ninety-nine-vintage','나인티 나인 빈티지','나인티 나인 매장',v_owner,v_business,true)
    on conflict(slug) do update set name=excluded.name,description=excluded.description,operator_id=v_owner,business_id=v_business,is_active=true,updated_at=clock_timestamp()
    returning id into v_ninety_store;
  end if;

  select id into v_dami_store
  from public.stores
  where name='다미네 옷가게' or slug='dami-clothing-shop-b'
  order by (name='다미네 옷가게') desc,created_at,id
  limit 1;
  if v_dami_store is null then
    insert into public.stores(slug,name,description,operator_id,business_id,is_active)
    values('dami-clothing-shop-b','다미네 옷가게','다미네 매장',v_owner,v_business,true)
    on conflict(slug) do update set name=excluded.name,description=excluded.description,operator_id=v_owner,business_id=v_business,is_active=true,updated_at=clock_timestamp()
    returning id into v_dami_store;
  end if;

  update public.stores set operator_id=v_owner,updated_at=clock_timestamp() where id in (v_ninety_store,v_dami_store);
  select id into v_source_store from public.stores where operator_id=v_owner and id not in (v_ninety_store,v_dami_store) order by created_at,id limit 1;
  if v_source_store is not null then update public.products set store_id=v_ninety_store,updated_at=clock_timestamp() where store_id=v_source_store; end if;
  update public.stores set is_active=false,operator_id=v_owner,updated_at=clock_timestamp() where id not in (v_ninety_store,v_dami_store);
  update public.fulfillment_centers set status='archived',is_default=false,version=version+1,updated_by=v_owner,updated_at=clock_timestamp() where status<>'archived';

  insert into public.fulfillment_centers(business_id,code,name,status,is_default,created_by,updated_by)
  values(v_business,'ninety-nine-vintage','나인티 나인 빈티지','active',false,v_owner,v_owner)
  on conflict(business_id,code) do update set name=excluded.name,status='active',is_default=false,version=public.fulfillment_centers.version+1,updated_by=v_owner,updated_at=clock_timestamp()
  returning id into v_ninety_center;
  insert into public.fulfillment_centers(business_id,code,name,status,is_default,created_by,updated_by)
  values(v_business,'dami-clothing-shop','다미네 옷가게','active',true,v_owner,v_owner)
  on conflict(business_id,code) do update set name=excluded.name,status='active',is_default=true,version=public.fulfillment_centers.version+1,updated_by=v_owner,updated_at=clock_timestamp()
  returning id into v_dami_center;

  update public.stores set home_fulfillment_center_id=case id when v_ninety_store then v_ninety_center else v_dami_center end where id in(v_ninety_store,v_dami_store);
  insert into public.store_fulfillment_routes(business_id,store_id,fulfillment_center_id,route_mode,status,created_by,updated_by)
  values(v_business,v_ninety_store,v_dami_center,'transfer','active',v_owner,v_owner),(v_business,v_dami_store,v_dami_center,'co_located','active',v_owner,v_owner)
  on conflict(store_id) do update set fulfillment_center_id=excluded.fulfillment_center_id,route_mode=excluded.route_mode,status='active',version=public.store_fulfillment_routes.version+1,updated_by=v_owner,updated_at=clock_timestamp();
  insert into public.fulfillment_center_staff_assignments(business_id,fulfillment_center_id,user_id,status,receive_at_center,create_shipments,created_by,updated_by)
  values(v_business,v_ninety_center,v_owner,'active',true,true,v_owner,v_owner),(v_business,v_dami_center,v_owner,'active',true,true,v_owner,v_owner)
  on conflict(fulfillment_center_id,user_id) do update set status='active',receive_at_center=true,create_shipments=true,version=public.fulfillment_center_staff_assignments.version+1,updated_by=v_owner,updated_at=clock_timestamp();
end;
$$;

-- Prepare every current non-owner account for the deployment-time Auth Admin
-- deletion step. Historical profile IDs remain as non-login tombstones.
do $$
declare v_owner uuid; v_user uuid; v_ref text;
begin
  select user_id into strict v_owner from public.account_access_roles where role_code='owner';
  update public.owner_hidden_test_members set retired_at=coalesce(retired_at,clock_timestamp()) where test_user_id<>v_owner;
  for v_user in select user_id from public.account_access_roles where role_code<>'owner' order by user_id loop
    v_ref:='deleted-'||replace(gen_random_uuid()::text,'-','');
    update public.fulfillment_center_staff_assignments set status='inactive',version=version+1,updated_by=v_owner,updated_at=clock_timestamp() where user_id=v_user and status='active';
    update public.store_memberships set status='inactive',version=version+1,updated_by=v_owner,updated_at=clock_timestamp() where user_id=v_user and status='active';
    update public.support_conversations set assigned_staff_id=null where assigned_staff_id=v_user;
    delete from public.shipping_addresses where member_id=v_user;
    delete from public.kakao_member_profiles where member_id=v_user;
    update public.member_accounts set phone=null,account_status='deleted',suspended_until=null,suspension_reason='초기 권한 재구성',status_updated_by=v_owner,updated_at=clock_timestamp() where member_id=v_user;
    update public.profiles set display_name='탈퇴 회원 '||right(v_ref,8),deleted_at=clock_timestamp(),anonymized_reference=v_ref where id=v_user;
    delete from public.account_access_roles where user_id=v_user;
  end loop;
end;
$$;

notify pgrst,'reload schema';
