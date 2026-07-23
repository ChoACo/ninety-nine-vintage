begin;

-- All Kakao-backed account roles, including the private owner role, share the
-- same nickname onboarding and review workflow.
create or replace function public.set_my_initial_nickname(p_nickname text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nickname text := public.assert_valid_member_nickname(p_nickname);
begin
  if auth.uid() is null
    or public.access_role_for_user(auth.uid())
      not in ('owner', 'operator', 'employee', 'band_member', 'member')
    or not public.auth_user_has_kakao_identity(auth.uid())
  then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;

  update public.profiles
  set
    display_name = v_nickname,
    nickname_initialized_at = clock_timestamp(),
    nickname_self_change_used_at = clock_timestamp()
  where id = auth.uid()
    and nickname_initialized_at is null;

  if not found then
    raise exception using errcode = '23505', message = '최초 닉네임은 이미 설정되었습니다.';
  end if;
  return v_nickname;
end;
$$;

create or replace function public.request_my_nickname_change(p_nickname text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nickname text := public.assert_valid_member_nickname(p_nickname);
  v_request_id uuid;
begin
  if auth.uid() is null
    or public.access_role_for_user(auth.uid())
      not in ('owner', 'operator', 'employee', 'band_member', 'member')
    or not public.auth_user_has_kakao_identity(auth.uid())
  then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and nickname_initialized_at is not null
  ) then
    raise exception using errcode = '22023', message = '최초 닉네임을 먼저 설정해 주세요.';
  end if;
  if exists (
    select 1 from public.profiles
    where id = auth.uid() and display_name = v_nickname
  ) then
    raise exception using errcode = '22023', message = '현재 닉네임과 다른 값을 입력해 주세요.';
  end if;

  insert into public.nickname_change_requests (member_id, requested_nickname)
  values (auth.uid(), v_nickname)
  on conflict (member_id) where status = 'pending'
  do update set
    requested_nickname = excluded.requested_nickname,
    created_at = clock_timestamp()
  returning id into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.get_pending_nickname_change_requests()
returns table (
  request_id uuid,
  member_id uuid,
  current_nickname text,
  requested_nickname text,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.access_role_for_user(auth.uid()) not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = '닉네임 요청 조회 권한이 없습니다.';
  end if;
  return query
  select
    requests.id,
    requests.member_id,
    profiles.display_name,
    requests.requested_nickname,
    requests.created_at
  from public.nickname_change_requests as requests
  join public.profiles as profiles on profiles.id = requests.member_id
  where requests.status = 'pending'
    and public.access_role_for_user(requests.member_id)
      in ('owner', 'operator', 'employee', 'band_member', 'member')
  order by requests.created_at, requests.id;
end;
$$;

revoke all on function public.set_my_initial_nickname(text)
from public, anon, authenticated, service_role;
revoke all on function public.request_my_nickname_change(text)
from public, anon, authenticated, service_role;
revoke all on function public.get_pending_nickname_change_requests()
from public, anon, authenticated, service_role;
grant execute on function public.set_my_initial_nickname(text) to authenticated;
grant execute on function public.request_my_nickname_change(text) to authenticated;
grant execute on function public.get_pending_nickname_change_requests() to authenticated;

-- Owner contact details are editable through the same guarded member console.
-- Display names remain on the nickname workflow above.
create or replace function public.update_managed_member(
  p_member_id uuid,
  p_display_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '회원 정보 수정 권한이 없습니다.';
  end if;
  select public.access_role_for_user(p_member_id) into v_role;
  if v_role not in ('owner', 'operator', 'employee', 'band_member', 'member') then
    raise exception using errcode = 'P0002', message = '수정할 회원을 찾지 못했습니다.';
  end if;
  if v_phone is not null and char_length(v_phone) not between 7 and 30 then
    raise exception using errcode = '22023', message = '연락처를 확인해 주세요.';
  end if;

  update public.member_accounts set phone = v_phone
  where member_id = p_member_id;
  if v_phone is not null then
    update public.shipping_addresses
    set phone = v_phone
    where member_id = p_member_id and is_default;
  end if;
end;
$$;

revoke all on function public.update_managed_member(uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.update_managed_member(uuid, text, text)
to authenticated;

-- The owner may reset warning/sanction accumulation explicitly. Related
-- enforcement rows are removed together so no dangling warning reference can
-- retain a count or an active bid block.
create or replace function public.clear_member_enforcement_history(
  p_member_id uuid,
  p_scope text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_warning_count integer := 0;
  v_sanction_count integer := 0;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if v_scope not in ('warnings', 'sanctions', 'all')
    or char_length(v_reason) not between 1 and 500
  then
    raise exception using errcode = '22023', message = '초기화 범위와 사유를 확인해 주세요.';
  end if;
  if public.access_role_for_user(p_member_id) not in ('band_member', 'member') then
    raise exception using errcode = '42501', message = '일반 회원의 누적 이력만 초기화할 수 있습니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('member-warning-enforcement:' || p_member_id::text, 0)
  );

  if v_scope in ('sanctions', 'all') then
    select count(*)::integer into v_sanction_count
    from public.member_bid_sanctions where member_id = p_member_id;
    delete from public.member_sanction_events where member_id = p_member_id;
    delete from public.member_bid_sanctions where member_id = p_member_id;
  end if;

  if v_scope in ('warnings', 'all') then
    select count(*)::integer into v_warning_count
    from public.member_warnings where member_id = p_member_id;
    delete from public.auction_offer_penalties
    where warning_id in (
      select id from public.member_warnings where member_id = p_member_id
    );
    update public.member_bid_sanctions
    set warning_id = null, updated_by = auth.uid(), updated_at = clock_timestamp()
    where member_id = p_member_id and warning_id is not null;
    delete from public.member_warnings where member_id = p_member_id;
  end if;

  return jsonb_build_object(
    'memberId', p_member_id,
    'scope', v_scope,
    'removedWarnings', v_warning_count,
    'removedSanctions', v_sanction_count,
    'reason', v_reason
  );
end;
$$;

revoke all on function public.clear_member_enforcement_history(uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.clear_member_enforcement_history(uuid, text, text)
to authenticated;

-- Member deletion remains a two-step operation: first anonymize and remove the
-- Auth user, then optionally purge the withdrawn directory row when no retained
-- transaction or audit ledger still references it.
create or replace function public.prepare_managed_member_deletion(
  p_member_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_ref text := 'deleted-' || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  select role_code into v_role
  from public.account_access_roles
  where user_id = p_member_id
  for update;
  if v_role is null then
    raise exception using errcode = 'P0002', message = '계정을 찾을 수 없습니다.';
  end if;
  if v_role = 'owner' then
    raise exception using errcode = '42501', message = '소유자 계정은 탈퇴 처리할 수 없습니다.';
  end if;

  update public.stores
  set operator_id = auth.uid(), updated_at = clock_timestamp()
  where operator_id = p_member_id;
  update public.support_conversations
  set assigned_staff_id = null
  where assigned_staff_id = p_member_id;
  delete from public.fulfillment_center_staff_assignments
  where user_id = p_member_id;
  delete from public.shipping_addresses where member_id = p_member_id;
  delete from public.kakao_member_profiles where member_id = p_member_id;
  update public.member_accounts
  set
    phone = null,
    account_status = 'deleted',
    suspended_until = null,
    suspension_reason = left(
      coalesce(nullif(btrim(p_reason), ''), '소유자 탈퇴 처리'),
      500
    ),
    status_updated_by = auth.uid(),
    updated_at = clock_timestamp()
  where member_id = p_member_id;
  update public.profiles
  set
    display_name = '탈퇴 회원 ' || right(v_ref, 8),
    deleted_at = clock_timestamp(),
    anonymized_reference = v_ref
  where id = p_member_id;
  delete from public.account_access_roles where user_id = p_member_id;

  return jsonb_build_object(
    'memberId', p_member_id,
    'anonymizedReference', v_ref,
    'prepared', true
  );
end;
$$;

create or replace function public.purge_deleted_member_record(
  p_member_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_member_id = auth.uid() then
    raise exception using errcode = '42501', message = '현재 소유자 계정은 완전 삭제할 수 없습니다.';
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = '완전 삭제 사유를 입력해 주세요.';
  end if;
  perform 1
  from public.profiles as profiles
  join public.member_accounts as accounts on accounts.member_id = profiles.id
  where profiles.id = p_member_id
    and profiles.deleted_at is not null
    and accounts.account_status = 'deleted'
  for update of profiles, accounts;
  if not found then
    raise exception using errcode = 'P0002', message = '완전 삭제할 탈퇴 회원을 찾지 못했습니다.';
  end if;
  if exists (select 1 from auth.users where id = p_member_id) then
    raise exception using errcode = '55000', message = '인증 계정을 먼저 삭제해 주세요.';
  end if;

  begin
    delete from public.profiles where id = p_member_id;
  exception
    when foreign_key_violation then
      raise exception using
        errcode = '55000',
        message = '보존해야 하는 거래 또는 감사 이력이 있어 개인정보 익명화 상태로 유지합니다.';
  end;

  return jsonb_build_object(
    'memberId', p_member_id,
    'purged', true,
    'reason', v_reason
  );
end;
$$;

revoke all on function public.prepare_managed_member_deletion(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.purge_deleted_member_record(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.prepare_managed_member_deletion(uuid, text)
to authenticated;
grant execute on function public.purge_deleted_member_record(uuid, text)
to authenticated;

-- Staff-role changes clean up center assignments rather than leaving anonymous
-- inactive UUID rows.
create or replace function public.set_managed_staff_role(
  p_member_id uuid,
  p_role_code text,
  p_reports_to_operator_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := lower(btrim(coalesce(p_role_code, '')));
  v_current text;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if v_role not in ('operator', 'employee', 'band_member', 'member') then
    raise exception using errcode = '22023', message = '역할을 확인해 주세요.';
  end if;
  select role_code into v_current
  from public.account_access_roles
  where user_id = p_member_id
  for update;
  if v_current is null then
    raise exception using errcode = 'P0002', message = '계정을 찾을 수 없습니다.';
  end if;
  if v_current = 'owner' then
    raise exception using errcode = '42501', message = '소유자 역할은 변경할 수 없습니다.';
  end if;
  if v_role = 'employee' and not exists (
    select 1 from public.account_access_roles
    where user_id = p_reports_to_operator_id and role_code = 'operator'
  ) then
    raise exception using errcode = '23514', message = '직원의 담당 운영자를 지정해 주세요.';
  end if;

  update public.account_access_roles
  set
    role_code = v_role,
    reports_to_operator_id = case
      when v_role = 'employee' then p_reports_to_operator_id
      else null
    end
  where user_id = p_member_id;

  if v_role in ('operator', 'employee') then
    update public.fulfillment_center_staff_assignments
    set
      receive_at_center = true,
      create_shipments = true,
      version = version + 1,
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
    where user_id = p_member_id
      and (not receive_at_center or not create_shipments);
  else
    delete from public.fulfillment_center_staff_assignments
    where user_id = p_member_id;
  end if;

  return jsonb_build_object(
    'memberId', p_member_id,
    'roleCode', v_role,
    'reportsToOperatorId',
      case when v_role = 'employee' then p_reports_to_operator_id end
  );
end;
$$;

revoke all on function public.set_managed_staff_role(uuid, text, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.set_managed_staff_role(uuid, text, uuid)
to authenticated;

-- Assignment candidates and rows are restricted to live operators/employees.
delete from public.fulfillment_center_staff_assignments as assignments
where not exists (
  select 1
  from public.account_access_roles as roles
  join public.profiles as profiles on profiles.id = roles.user_id
  where roles.user_id = assignments.user_id
    and roles.role_code in ('operator', 'employee')
    and profiles.deleted_at is null
);

update public.fulfillment_center_staff_assignments
set
  receive_at_center = true,
  create_shipments = true,
  version = version + 1,
  updated_at = clock_timestamp()
where not receive_at_center or not create_shipments;

create or replace function public.get_owner_fulfillment_staff_directory()
returns table (
  id uuid,
  display_name text,
  email text,
  role_code text,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  return query
  select
    profiles.id,
    profiles.display_name,
    users.email::text,
    roles.role_code,
    coalesce(last_seen.last_seen_at, users.last_sign_in_at)
  from public.account_access_roles as roles
  join public.profiles as profiles on profiles.id = roles.user_id
  join auth.users as users on users.id = roles.user_id
  left join public.account_last_seen as last_seen
    on last_seen.user_id = roles.user_id
  where roles.role_code in ('operator', 'employee')
    and profiles.deleted_at is null
  order by
    case roles.role_code when 'operator' then 0 else 1 end,
    profiles.display_name,
    profiles.id;
end;
$$;

revoke all on function public.get_owner_fulfillment_staff_directory()
from public, anon, authenticated, service_role;
grant execute on function public.get_owner_fulfillment_staff_directory()
to authenticated;

alter table public.inventory_command_receipts
drop constraint inventory_command_receipts_command_name_check;
alter table public.inventory_command_receipts
add constraint inventory_command_receipts_command_name_check
check (command_name in (
  'confirm_payment', 'request_shipment', 'release_store_items',
  'center_receive', 'center_store', 'pack_shipment', 'ship_shipment',
  'open_exception', 'resolve_exception', 'submit_refund_account',
  'review_refund', 'refund_account_access', 'append_exception_evidence',
  'configure_rollout', 'review_shipping_fee_refund',
  'reconcile_inventory_item', 'release_paid_items',
  'submit_shipping_fee_refund_account',
  'shipping_fee_refund_account_access', 'configure_center_assignment',
  'delete_center_assignment'
));

create or replace function public.configure_fulfillment_center_staff_assignment(
  p_fulfillment_center_id uuid,
  p_user_id uuid,
  p_receive_at_center boolean,
  p_create_shipments boolean,
  p_status text,
  p_expected_version bigint,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_assignment public.fulfillment_center_staff_assignments%rowtype;
  v_business uuid;
  v_role text;
  v_fp text;
  v_receipt public.inventory_command_receipts%rowtype;
  v_result jsonb;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_idempotency_key is null or p_status not in ('active', 'inactive') then
    raise exception using errcode = '22023', message = '센터 담당자 설정값을 확인해 주세요.';
  end if;
  select business_id into v_business
  from public.fulfillment_centers
  where id = p_fulfillment_center_id and status = 'active';
  select roles.role_code into v_role
  from public.account_access_roles as roles
  join public.profiles as profiles on profiles.id = roles.user_id
  where roles.user_id = p_user_id
    and roles.role_code in ('operator', 'employee')
    and profiles.deleted_at is null;
  if v_business is null or v_role is null then
    raise exception using errcode = '23514', message = '유효한 센터와 운영자 또는 직원을 선택해 주세요.';
  end if;

  v_fp := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'center', p_fulfillment_center_id,
    'user', p_user_id,
    'role', v_role,
    'status', p_status,
    'version', p_expected_version
  ));
  select * into v_receipt
  from public.inventory_command_receipts
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'configure_center_assignment'
      or v_receipt.request_fingerprint <> v_fp
    then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'center-assignment:' || p_fulfillment_center_id::text || ':' || p_user_id::text,
    0
  ));
  select * into v_assignment
  from public.fulfillment_center_staff_assignments
  where fulfillment_center_id = p_fulfillment_center_id
    and user_id = p_user_id
  for update;
  if found then
    if v_assignment.version is distinct from p_expected_version then
      raise exception using errcode = 'PT409', message = '센터 담당자 설정이 변경되었습니다.';
    end if;
    update public.fulfillment_center_staff_assignments
    set
      receive_at_center = true,
      create_shipments = true,
      status = p_status,
      version = version + 1,
      updated_by = v_actor,
      updated_at = clock_timestamp()
    where id = v_assignment.id
    returning * into v_assignment;
  else
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception using errcode = 'PT409', message = '새 센터 배정의 예상 버전은 0이어야 합니다.';
    end if;
    insert into public.fulfillment_center_staff_assignments (
      business_id,
      fulfillment_center_id,
      user_id,
      status,
      receive_at_center,
      create_shipments,
      created_by,
      updated_by
    ) values (
      v_business,
      p_fulfillment_center_id,
      p_user_id,
      p_status,
      true,
      true,
      v_actor,
      v_actor
    )
    returning * into v_assignment;
  end if;

  v_result := jsonb_build_object(
    'id', v_assignment.id,
    'businessId', v_assignment.business_id,
    'centerId', v_assignment.fulfillment_center_id,
    'userId', v_assignment.user_id,
    'receiveAtCenter', true,
    'createShipments', true,
    'status', v_assignment.status,
    'version', v_assignment.version,
    'idempotent_replay', false
  );
  insert into public.inventory_command_receipts (
    actor_user_id,
    idempotency_key,
    command_name,
    target_id,
    request_fingerprint,
    result,
    created_at
  ) values (
    v_actor,
    p_idempotency_key,
    'configure_center_assignment',
    v_assignment.id,
    v_fp,
    v_result,
    clock_timestamp()
  );
  return v_result;
end;
$$;

create or replace function public.delete_fulfillment_center_staff_assignment(
  p_fulfillment_center_id uuid,
  p_user_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_assignment public.fulfillment_center_staff_assignments%rowtype;
  v_fp text;
  v_receipt public.inventory_command_receipts%rowtype;
  v_result jsonb;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_idempotency_key is null or p_expected_version is null then
    raise exception using errcode = '22023', message = '센터 배정 삭제 입력값을 확인해 주세요.';
  end if;
  v_fp := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'center', p_fulfillment_center_id,
    'user', p_user_id,
    'version', p_expected_version
  ));
  select * into v_receipt
  from public.inventory_command_receipts
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'delete_center_assignment'
      or v_receipt.request_fingerprint <> v_fp
    then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'center-assignment:' || p_fulfillment_center_id::text || ':' || p_user_id::text,
    0
  ));
  select * into v_assignment
  from public.fulfillment_center_staff_assignments
  where fulfillment_center_id = p_fulfillment_center_id
    and user_id = p_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '삭제할 센터 배정을 찾지 못했습니다.';
  end if;
  if v_assignment.version is distinct from p_expected_version then
    raise exception using errcode = 'PT409', message = '센터 배정이 변경되었습니다.';
  end if;

  delete from public.fulfillment_center_staff_assignments
  where id = v_assignment.id;
  v_result := jsonb_build_object(
    'id', v_assignment.id,
    'centerId', v_assignment.fulfillment_center_id,
    'userId', v_assignment.user_id,
    'deleted', true,
    'idempotent_replay', false
  );
  insert into public.inventory_command_receipts (
    actor_user_id,
    idempotency_key,
    command_name,
    target_id,
    request_fingerprint,
    result,
    created_at
  ) values (
    v_actor,
    p_idempotency_key,
    'delete_center_assignment',
    v_assignment.id,
    v_fp,
    v_result,
    clock_timestamp()
  );
  return v_result;
end;
$$;

revoke all on function public.configure_fulfillment_center_staff_assignment(
  uuid, uuid, boolean, boolean, text, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.delete_fulfillment_center_staff_assignment(
  uuid, uuid, bigint, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.configure_fulfillment_center_staff_assignment(
  uuid, uuid, boolean, boolean, text, bigint, uuid
) to authenticated;
grant execute on function public.delete_fulfillment_center_staff_assignment(
  uuid, uuid, bigint, uuid
) to authenticated;

-- Every operator manages the shared payment queue. Employees remain excluded.
create or replace function app_private.can_confirm_shared_payment(
  p_business_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_business_id is not null
      and public.access_role_for_user(auth.uid()) in ('owner', 'operator'),
    false
  );
$$;

revoke all on function app_private.can_confirm_shared_payment(uuid)
from public, anon, authenticated, service_role;

-- Owners define the global topology; an operator may also connect the stores
-- they run to one of their assigned active centers.
create or replace function public.configure_store_fulfillment_route(
  p_store_id uuid,
  p_fulfillment_center_id uuid,
  p_route_mode text,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.access_role_for_user(v_actor);
  v_route public.store_fulfillment_routes%rowtype;
  v_before jsonb;
  v_replay public.store_fulfillment_route_events%rowtype;
begin
  if v_actor is null or v_role not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = '매장 센터 경로 설정 권한이 필요합니다.';
  end if;
  if p_route_mode not in ('transfer', 'co_located') or p_idempotency_key is null then
    raise exception using errcode = '22023', message = '출고 경로 입력값을 확인해 주세요.';
  end if;
  if v_role = 'operator' and not exists (
    select 1
    from public.stores as stores
    where stores.id = p_store_id
      and (
        stores.operator_id = v_actor
        or exists (
          select 1 from public.store_memberships as memberships
          where memberships.store_id = stores.id
            and memberships.user_id = v_actor
            and memberships.status = 'active'
        )
        or exists (
          select 1
          from public.fulfillment_center_staff_assignments as assignments
          where assignments.user_id = v_actor
            and assignments.status = 'active'
            and assignments.fulfillment_center_id =
              stores.home_fulfillment_center_id
        )
      )
  ) then
    raise exception using errcode = '42501', message = '담당 매장의 센터 경로만 변경할 수 있습니다.';
  end if;
  if v_role = 'operator' and not exists (
    select 1
    from public.fulfillment_center_staff_assignments as assignments
    where assignments.user_id = v_actor
      and assignments.status = 'active'
      and assignments.fulfillment_center_id = p_fulfillment_center_id
  ) then
    raise exception using errcode = '42501', message = '배정된 센터만 매장에 연결할 수 있습니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('inventory-route:' || p_store_id::text, 0)
  );
  select * into v_replay
  from public.store_fulfillment_route_events
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if (v_replay.to_snapshot ->> 'storeId')::uuid is distinct from p_store_id
      or (v_replay.to_snapshot ->> 'centerId')::uuid
        is distinct from p_fulfillment_center_id
      or v_replay.to_snapshot ->> 'routeMode' is distinct from p_route_mode
    then
      raise exception using errcode = '23505', message = '동일한 요청 키를 다른 경로 설정에 재사용할 수 없습니다.';
    end if;
    return v_replay.to_snapshot || jsonb_build_object('idempotent_replay', true);
  end if;
  perform 1
  from public.fulfillment_centers as centers
  join public.stores as stores on stores.business_id = centers.business_id
  where stores.id = p_store_id
    and centers.id = p_fulfillment_center_id
    and centers.status = 'active';
  if not found then
    raise exception using errcode = '23514', message = '같은 사업자의 활성 출고 센터를 선택해 주세요.';
  end if;

  select * into v_route
  from public.store_fulfillment_routes
  where store_id = p_store_id
  for update;
  if found then
    if v_route.version is distinct from p_expected_version then
      raise exception using errcode = 'PT409', message = '경로가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
    end if;
    v_before := jsonb_build_object(
      'id', v_route.id,
      'storeId', v_route.store_id,
      'centerId', v_route.fulfillment_center_id,
      'routeMode', v_route.route_mode,
      'status', v_route.status,
      'version', v_route.version
    );
    update public.store_fulfillment_routes
    set
      fulfillment_center_id = p_fulfillment_center_id,
      route_mode = p_route_mode,
      status = 'active',
      version = version + 1,
      updated_by = v_actor,
      updated_at = clock_timestamp()
    where id = v_route.id
    returning * into v_route;
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception using errcode = 'PT409', message = '새 경로의 예상 버전은 0이어야 합니다.';
    end if;
    insert into public.store_fulfillment_routes (
      business_id,
      store_id,
      fulfillment_center_id,
      route_mode,
      created_by,
      updated_by
    )
    select
      stores.business_id,
      stores.id,
      p_fulfillment_center_id,
      p_route_mode,
      v_actor,
      v_actor
    from public.stores as stores
    where stores.id = p_store_id
    returning * into v_route;
  end if;

  insert into public.store_fulfillment_route_events (
    route_id,
    sequence_no,
    event_type,
    actor_user_id,
    idempotency_key,
    reason,
    from_snapshot,
    to_snapshot
  ) values (
    v_route.id,
    coalesce((
      select max(sequence_no) + 1
      from public.store_fulfillment_route_events
      where route_id = v_route.id
    ), 1),
    case when v_before is null then 'configured' else 'updated' end,
    v_actor,
    p_idempotency_key,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_before,
    jsonb_build_object(
      'id', v_route.id,
      'storeId', v_route.store_id,
      'centerId', v_route.fulfillment_center_id,
      'routeMode', v_route.route_mode,
      'status', v_route.status,
      'version', v_route.version
    )
  );
  return jsonb_build_object(
    'id', v_route.id,
    'storeId', v_route.store_id,
    'centerId', v_route.fulfillment_center_id,
    'routeMode', v_route.route_mode,
    'status', v_route.status,
    'version', v_route.version,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.configure_store_fulfillment_route(
  uuid, uuid, text, bigint, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.configure_store_fulfillment_route(
  uuid, uuid, text, bigint, uuid, text
) to authenticated;

create or replace function public.get_my_center_management()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.access_role_for_user(v_actor);
  v_result jsonb;
begin
  if v_role not in ('owner', 'operator', 'employee') then
    raise exception using errcode = '42501', message = '센터 조회 권한이 없습니다.';
  end if;
  select jsonb_build_object(
    'roleCode', v_role,
    'centers', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.name, rows.id)
      from (
        select
          centers.id,
          centers.business_id,
          centers.code,
          centers.name,
          centers.status,
          centers.is_default,
          centers.postal_code,
          centers.address_line1,
          centers.address_line2,
          centers.contact_name,
          centers.contact_phone,
          centers.version,
          centers.updated_at,
          coalesce(assignments.receive_at_center, v_role = 'owner')
            as receive_at_center,
          coalesce(assignments.create_shipments, v_role = 'owner')
            as create_shipments
        from public.fulfillment_centers as centers
        left join public.fulfillment_center_staff_assignments as assignments
          on assignments.fulfillment_center_id = centers.id
          and assignments.user_id = v_actor
          and assignments.status = 'active'
        where centers.status <> 'archived'
          and (v_role = 'owner' or assignments.id is not null)
      ) as rows
    ), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.name, rows.id)
      from (
        select
          stores.id,
          stores.business_id,
          stores.name,
          stores.slug,
          stores.home_fulfillment_center_id,
          stores.is_active,
          routes.fulfillment_center_id as route_center_id,
          routes.route_mode,
          routes.status as route_status,
          coalesce(routes.version, 0) as route_version
        from public.stores as stores
        left join public.store_fulfillment_routes as routes
          on routes.store_id = stores.id
        where stores.is_active
          and (
            v_role = 'owner'
            or (
              v_role = 'operator'
              and (
                stores.operator_id = v_actor
                or exists (
                  select 1
                  from public.store_memberships as memberships
                  where memberships.store_id = stores.id
                    and memberships.user_id = v_actor
                    and memberships.status = 'active'
                )
                or exists (
                  select 1
                  from public.fulfillment_center_staff_assignments as assignments
                  where assignments.user_id = v_actor
                    and assignments.status = 'active'
                    and assignments.fulfillment_center_id =
                      stores.home_fulfillment_center_id
                )
              )
            )
            or (
              v_role = 'employee'
              and exists (
                select 1
                from public.fulfillment_center_staff_assignments as assignments
                where assignments.user_id = v_actor
                  and assignments.status = 'active'
                  and assignments.fulfillment_center_id =
                    stores.home_fulfillment_center_id
              )
            )
          )
      ) as rows
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_my_center_management()
from public, anon, authenticated, service_role;
grant execute on function public.get_my_center_management() to authenticated;

-- Shipping can be paid together with products. The per-business fee snapshot
-- is retained on the order, and payment completion projects one consumable
-- shipping entitlement so the later shipment request cannot charge twice.
create table public.commerce_order_shipping_fee_allocations (
  order_id uuid not null
    references public.commerce_orders(id) on delete cascade,
  business_id uuid not null
    references public.businesses(id) on delete restrict,
  amount bigint not null check (amount between 1 and 1000000),
  created_at timestamptz not null default clock_timestamp(),
  primary key (order_id, business_id)
);

alter table public.commerce_order_shipping_fee_allocations
enable row level security;
alter table public.commerce_order_shipping_fee_allocations
force row level security;
revoke all on table public.commerce_order_shipping_fee_allocations
from public, anon, authenticated, service_role;

alter table public.shipping_fee_waiver_entitlements
alter column exception_case_id drop not null;
alter table public.shipping_fee_waiver_entitlements
add column commerce_order_id uuid
  references public.commerce_orders(id) on delete restrict,
add column prepaid_amount bigint
  check (prepaid_amount between 1 and 1000000);
alter table public.shipping_fee_waiver_entitlements
add constraint shipping_fee_waiver_entitlements_source_check
check (
  num_nonnulls(exception_case_id, commerce_order_id) = 1
  and (
    (exception_case_id is not null and prepaid_amount is null)
    or (commerce_order_id is not null and prepaid_amount is not null)
  )
);
create unique index shipping_fee_waiver_entitlements_order_business_idx
on public.shipping_fee_waiver_entitlements(commerce_order_id, business_id)
where commerce_order_id is not null;

create or replace function app_private.apply_commerce_checkout_shipping_fee(
  p_order_id uuid,
  p_include_shipping_fee boolean,
  p_allow_zero_fee_upgrade boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_business_count integer;
  v_configured_count integer;
  v_shipping_fee bigint;
  v_allocated_fee bigint;
begin
  select * into v_order
  from public.commerce_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '배송비를 적용할 주문을 찾지 못했습니다.';
  end if;

  select
    count(*)::integer,
    count(settings.business_id)::integer,
    coalesce(sum(settings.shipping_fee_amount), 0)::bigint
  into v_business_count, v_configured_count, v_shipping_fee
  from (
    select distinct stores.business_id
    from public.commerce_order_items as items
    join public.stores as stores on stores.id = items.store_id
    where items.order_id = p_order_id
  ) as businesses
  left join public.inventory_fulfillment_rollout_settings as settings
    on settings.business_id = businesses.business_id;

  if v_business_count < 1 then
    raise exception using errcode = 'P0002', message = '주문 상품의 배송 사업자를 찾지 못했습니다.';
  end if;
  if p_include_shipping_fee then
    if v_configured_count <> v_business_count or v_shipping_fee < 1 then
      raise exception using errcode = '55000', message = '상품 배송비 설정을 확인할 수 없습니다.';
    end if;
    if v_order.shipping_fee = 0 then
      if not p_allow_zero_fee_upgrade then
        raise exception using errcode = '22000', message = '같은 주문 요청 키의 배송비 선택이 다릅니다.';
      end if;
      insert into public.commerce_order_shipping_fee_allocations (
        order_id,
        business_id,
        amount
      )
      select
        p_order_id,
        businesses.business_id,
        settings.shipping_fee_amount
      from (
        select distinct stores.business_id
        from public.commerce_order_items as items
        join public.stores as stores on stores.id = items.store_id
        where items.order_id = p_order_id
      ) as businesses
      join public.inventory_fulfillment_rollout_settings as settings
        on settings.business_id = businesses.business_id;
      update public.commerce_orders
      set
        shipping_fee = v_shipping_fee,
        total = subtotal + v_shipping_fee,
        updated_at = clock_timestamp()
      where id = p_order_id
      returning * into v_order;
    else
      select coalesce(sum(amount), 0)::bigint into v_allocated_fee
      from public.commerce_order_shipping_fee_allocations
      where order_id = p_order_id;
      if v_order.shipping_fee is distinct from v_allocated_fee
        or v_order.total is distinct from v_order.subtotal + v_order.shipping_fee
      then
        raise exception using errcode = '22000', message = '저장된 주문 배송비를 검증할 수 없습니다.';
      end if;
    end if;
  elsif v_order.shipping_fee <> 0
    or exists (
      select 1 from public.commerce_order_shipping_fee_allocations
      where order_id = p_order_id
    )
  then
    raise exception using errcode = '22000', message = '같은 주문 요청 키의 배송비 선택이 다릅니다.';
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'status', v_order.status,
    'subtotal', v_order.subtotal,
    'shipping_fee', v_order.shipping_fee,
    'total', v_order.total,
    'shipping_credit_applied', v_order.shipping_credit_applied
  );
end;
$$;

revoke all on function app_private.apply_commerce_checkout_shipping_fee(
  uuid, boolean, boolean
) from public, anon, authenticated, service_role;

create or replace function public.create_commerce_manual_transfer_checkout(
  p_product_ids uuid[],
  p_idempotency_key text,
  p_apply_shipping_credit boolean,
  p_include_shipping_fee boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order jsonb;
  v_order_id uuid;
  v_transfer jsonb;
  v_existing_transfer public.commerce_order_transfers%rowtype;
  v_allow_fee_upgrade boolean;
begin
  v_order := app_private.create_commerce_order(
    p_product_ids,
    p_idempotency_key,
    p_apply_shipping_credit
  );
  if jsonb_typeof(v_order) <> 'object'
    or nullif(v_order ->> 'id', '') is null
  then
    raise exception using errcode = 'XX000', message = '주문 생성 결과가 올바르지 않습니다.';
  end if;
  v_order_id := (v_order ->> 'id')::uuid;
  v_allow_fee_upgrade :=
    not exists (
      select 1 from public.commerce_order_transfers
      where order_id = v_order_id
    )
    and not exists (
      select 1 from public.payment_orders
      where commerce_order_id = v_order_id
    );
  v_order := app_private.apply_commerce_checkout_shipping_fee(
    v_order_id,
    coalesce(p_include_shipping_fee, false),
    v_allow_fee_upgrade
  );

  select transfers.* into v_existing_transfer
  from public.commerce_order_transfers as transfers
  where transfers.order_id = v_order_id
  for update;
  if found then
    if v_existing_transfer.member_id is distinct from auth.uid() then
      raise exception using errcode = '23514', message = '주문과 입금 요청의 회원 계약이 일치하지 않습니다.';
    end if;
    if v_existing_transfer.status = 'cancelled' then
      raise exception using errcode = '55000', message = '취소된 입금 요청입니다.';
    end if;
    v_transfer := to_jsonb(v_existing_transfer);
  else
    v_transfer := public.create_commerce_order_transfer(v_order_id);
  end if;

  if jsonb_typeof(v_transfer) <> 'object'
    or v_transfer ->> 'order_id' is distinct from v_order_id::text
    or (v_transfer ->> 'expected_amount')::bigint
      is distinct from (v_order ->> 'total')::bigint
    or nullif(btrim(v_transfer ->> 'bank_name_snapshot'), '') is null
    or nullif(btrim(v_transfer ->> 'account_number_snapshot'), '') is null
    or v_transfer ->> 'status'
      not in ('awaiting_transfer', 'partially_paid', 'confirmed')
  then
    raise exception using errcode = 'XX000', message = '입금 요청 생성 결과가 올바르지 않습니다.';
  end if;
  return jsonb_build_object('order', v_order, 'transfer', v_transfer);
end;
$$;

revoke all on function public.create_commerce_manual_transfer_checkout(
  uuid[], text, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.create_commerce_manual_transfer_checkout(
  uuid[], text, boolean, boolean
) to authenticated;

create or replace function public.prepare_commerce_portone_checkout(
  p_member_id uuid,
  p_product_ids uuid[],
  p_idempotency_key text,
  p_payment_id text,
  p_requested_method text,
  p_store_id text,
  p_include_shipping_fee boolean
)
returns table (
  payment_id text,
  commerce_order_id uuid,
  order_name text,
  expected_amount bigint,
  payment_status text,
  portone_status text,
  can_retry_payment boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prepared record;
  v_order jsonb;
  v_allow_fee_upgrade boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = '서버 권한이 필요합니다.';
  end if;
  select * into v_prepared
  from public.prepare_commerce_portone_checkout(
    p_member_id,
    p_product_ids,
    p_idempotency_key,
    p_payment_id,
    p_requested_method,
    p_store_id
  );
  if not found then
    raise exception using errcode = 'XX000', message = '결제 준비 결과가 올바르지 않습니다.';
  end if;
  v_allow_fee_upgrade :=
    v_prepared.payment_id = p_payment_id
    and v_prepared.portone_status is null;
  v_order := app_private.apply_commerce_checkout_shipping_fee(
    v_prepared.commerce_order_id,
    coalesce(p_include_shipping_fee, false),
    v_allow_fee_upgrade
  );

  update public.payment_orders
  set expected_amount = (v_order ->> 'total')::bigint
  where commerce_order_id = v_prepared.commerce_order_id;
  update public.payment_attempts as attempts
  set expected_amount = (v_order ->> 'total')::bigint
  from public.payment_orders as orders
  where orders.commerce_order_id = v_prepared.commerce_order_id
    and attempts.order_id = orders.id
    and attempts.payment_id = orders.payment_id;

  return query select
    v_prepared.payment_id::text,
    v_prepared.commerce_order_id::uuid,
    v_prepared.order_name::text,
    (v_order ->> 'total')::bigint,
    v_prepared.payment_status::text,
    v_prepared.portone_status::text,
    v_prepared.can_retry_payment::boolean;
end;
$$;

revoke all on function public.prepare_commerce_portone_checkout(
  uuid, uuid[], text, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_commerce_portone_checkout(
  uuid, uuid[], text, text, text, text, boolean
) to service_role;

create or replace function app_private.project_prepaid_shipping_entitlements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('paid', 'shipped') and new.shipping_fee > 0 then
    insert into public.shipping_fee_waiver_entitlements (
      member_id,
      business_id,
      exception_case_id,
      commerce_order_id,
      prepaid_amount
    )
    select
      new.member_id,
      allocations.business_id,
      null,
      new.id,
      allocations.amount
    from public.commerce_order_shipping_fee_allocations as allocations
    where allocations.order_id = new.id
    on conflict (commerce_order_id, business_id)
      where commerce_order_id is not null
    do nothing;
  end if;
  return new;
end;
$$;

revoke all on function app_private.project_prepaid_shipping_entitlements()
from public, anon, authenticated, service_role;
drop trigger if exists commerce_orders_project_prepaid_shipping
on public.commerce_orders;
create trigger commerce_orders_project_prepaid_shipping
after insert or update of status, shipping_fee
on public.commerce_orders
for each row execute function app_private.project_prepaid_shipping_entitlements();

commit;
