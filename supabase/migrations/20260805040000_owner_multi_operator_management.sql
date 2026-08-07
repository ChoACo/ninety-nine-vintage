begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Stage 3: owner-facing multi-operator assignment. stores.operator_id remains
-- the representative compatibility column; active operator memberships are
-- authoritative for access and directory data.

alter table public.owner_store_management_events
  drop constraint if exists owner_store_management_events_action_check;

alter table public.owner_store_management_events
  add constraint owner_store_management_events_action_check
  check (
    action in (
      'create', 'update', 'archive', 'restore',
      'employee_assign', 'employee_remove',
      'operator_assign', 'operator_remove'
    )
  );

create or replace function app_private.owner_store_snapshot(
  p_store public.stores
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_store.id,
    'businessId', p_store.business_id,
    'slug', p_store.slug,
    'name', p_store.name,
    'description', p_store.description,
    'operatorId', p_store.operator_id,
    'operatorName', (
      select profiles.display_name
      from public.profiles as profiles
      where profiles.id = p_store.operator_id
    ),
    'operators', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'membershipId', memberships.id,
          'userId', memberships.user_id,
          'displayName', profiles.display_name,
          'version', memberships.version
        )
        order by profiles.display_name, memberships.user_id
      )
      from public.store_memberships as memberships
      join public.profiles as profiles on profiles.id = memberships.user_id
      where memberships.store_id = p_store.id
        and memberships.membership_role = 'operator'
        and memberships.status = 'active'
        and profiles.deleted_at is null
    ), '[]'::jsonb),
    'isActive', p_store.is_active,
    'version', p_store.version,
    'createdAt', p_store.created_at,
    'updatedAt', p_store.updated_at
  );
$$;

revoke all on function app_private.owner_store_snapshot(public.stores)
from public, anon, authenticated, service_role;

create or replace function public.get_owner_store_management()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_grade_zero_owner();

  return jsonb_build_object(
    'businesses', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', businesses.id, 'code', businesses.code, 'name', businesses.name)
        order by businesses.name, businesses.id
      ) from public.businesses as businesses where businesses.status = 'active'
    ), '[]'::jsonb),
    'operators', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', roles.user_id,
          'displayName', profiles.display_name,
          'roleCode', roles.role_code,
          'assignable', not exists (
            select 1 from public.store_memberships as memberships
            where memberships.user_id = roles.user_id
              and memberships.membership_role = 'operator'
              and memberships.status = 'active'
          )
        )
        order by profiles.display_name, roles.user_id
      )
      from public.account_access_roles as roles
      join public.profiles as profiles on profiles.id = roles.user_id
      where (
        roles.role_code = 'operator'
        or (roles.role_code = 'owner' and coalesce(roles.grade_level, 99) = 0)
      ) and profiles.deleted_at is null
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', roles.user_id,
          'displayName', profiles.display_name,
          'reportsToOperatorId', roles.reports_to_operator_id
        ) order by profiles.display_name, roles.user_id
      )
      from public.account_access_roles as roles
      join public.profiles as profiles on profiles.id = roles.user_id
      where roles.role_code = 'employee'
        and public.access_role_for_user(roles.user_id) = 'employee'
        and profiles.deleted_at is null
    ), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(
        app_private.owner_store_snapshot(stores)
        || jsonb_build_object(
          'businessName', businesses.name,
          'employees', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'membershipId', memberships.id,
                'userId', memberships.user_id,
                'displayName', employee_profiles.display_name,
                'version', memberships.version
              ) order by employee_profiles.display_name, memberships.user_id
            )
            from public.store_memberships as memberships
            join public.profiles as employee_profiles on employee_profiles.id = memberships.user_id
            where memberships.store_id = stores.id
              and memberships.membership_role = 'employee'
              and memberships.status = 'active'
          ), '[]'::jsonb)
        ) order by stores.is_active desc, stores.name, stores.id
      )
      from public.stores as stores
      join public.businesses as businesses on businesses.id = stores.business_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_owner_store_management()
from public, anon, authenticated, service_role;
grant execute on function public.get_owner_store_management() to authenticated;

-- Changing the representative must not remove other operator memberships (or
-- owner memberships). The representative is only a compatibility projection.
create or replace function public.sync_store_operator_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.account_access_roles%rowtype;
begin
  select roles.* into v_role
  from public.account_access_roles as roles
  where roles.user_id = new.operator_id;

  if v_role.role_code = 'operator'
    or (v_role.role_code = 'owner' and coalesce(v_role.grade_level, 99) = 0)
  then
    insert into public.store_memberships (
      business_id, store_id, user_id, membership_role, status,
      manage_products, publish_products, prepare_orders, confirm_payments,
      receive_at_center, create_shipments, manage_staff, view_reports,
      created_by, updated_by
    ) values (
      new.business_id, new.id, new.operator_id, 'operator', 'active',
      true, true, true, true, false, false, true, true, auth.uid(), auth.uid()
    )
    on conflict (store_id, user_id) do update set
      membership_role = 'operator', status = 'active',
      manage_products = true, publish_products = true,
      prepare_orders = true, confirm_payments = true,
      manage_staff = true, view_reports = true,
      updated_by = auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function public.sync_store_operator_memberships()
from public, anon, authenticated, service_role;

create or replace function public.set_owner_store_operator(
  p_store_id uuid,
  p_operator_id uuid,
  p_active boolean,
  p_expected_store_version bigint,
  p_expected_membership_version bigint default null,
  p_idempotency_key uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_store public.stores%rowtype;
  v_before public.store_memberships%rowtype;
  v_after public.store_memberships%rowtype;
  v_result jsonb;
  v_action text := case when coalesce(p_active, false) then 'operator_assign' else 'operator_remove' end;
  v_request jsonb;
  v_existing_action text;
  v_existing_request jsonb;
begin
  v_actor := app_private.require_grade_zero_owner();
  if p_store_id is null or p_operator_id is null or p_expected_store_version is null
    or p_idempotency_key is null then
    raise exception using errcode = '22023', message = '운영자 배치 정보를 확인해 주세요.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = '처리 사유를 확인해 주세요.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0));
  v_request := jsonb_build_object(
    'action', v_action, 'storeId', p_store_id, 'operatorId', p_operator_id,
    'active', coalesce(p_active, false),
    'expectedStoreVersion', p_expected_store_version,
    'expectedMembershipVersion', p_expected_membership_version
  );
  select events.action, events.request_snapshot
  into v_existing_action, v_existing_request
  from public.owner_store_management_events as events
  where events.actor_user_id = v_actor and events.idempotency_key = p_idempotency_key;
  if found then
    if v_existing_action <> v_action or v_existing_request <> v_request then
      raise exception using errcode = '55000', message = '같은 중복 처리 방지 키로 다른 요청을 처리할 수 없습니다.';
    end if;
    return (select events.result from public.owner_store_management_events as events
      where events.actor_user_id = v_actor and events.idempotency_key = p_idempotency_key);
  end if;

  select stores.* into v_store from public.stores as stores
  where stores.id = p_store_id for update;
  if not found then raise exception using errcode = 'P0002', message = '매장을 찾을 수 없습니다.'; end if;
  if v_store.version <> p_expected_store_version then
    raise exception using errcode = '55000', message = '매장 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if public.access_role_for_user(p_operator_id) not in ('operator', 'owner')
    or not exists (
      select 1 from public.account_access_roles as roles
      where roles.user_id = p_operator_id
        and (roles.role_code = 'operator'
          or (roles.role_code = 'owner' and coalesce(roles.grade_level, 99) = 0))
    )
  then
    raise exception using errcode = '23514', message = '운영자 또는 최고 등급 소유자만 배치할 수 있습니다.';
  end if;

  select memberships.* into v_before from public.store_memberships as memberships
  where memberships.store_id = p_store_id and memberships.user_id = p_operator_id for update;
  if found and p_expected_membership_version is not null
    and v_before.version is distinct from p_expected_membership_version then
    raise exception using errcode = '55000', message = '운영자 배치 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  elsif not found and p_expected_membership_version is not null then
    raise exception using errcode = '55000', message = '운영자 배치 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if not p_active and p_operator_id = v_store.operator_id then
    raise exception using errcode = '23514', message = '대표 운영자를 먼저 변경한 뒤 운영자 소속을 해제해 주세요.';
  end if;

  if p_active then
    if not found then
      insert into public.store_memberships (
        business_id, store_id, user_id, membership_role, status,
        manage_products, publish_products, prepare_orders, confirm_payments,
        receive_at_center, create_shipments, manage_staff, view_reports,
        created_by, updated_by
      ) values (
        v_store.business_id, v_store.id, p_operator_id, 'operator', 'active',
        true, true, true, true, false, false, true, true, v_actor, v_actor
      ) returning * into v_after;
    else
      update public.store_memberships as memberships set
        membership_role = 'operator', status = 'active',
        manage_products = true, publish_products = true,
        prepare_orders = true, confirm_payments = true,
        receive_at_center = false, create_shipments = false,
        manage_staff = true, view_reports = true,
        version = memberships.version + 1, updated_by = v_actor
      where memberships.id = v_before.id returning * into v_after;
    end if;
  elsif found then
    update public.store_memberships as memberships set
      status = 'inactive', version = memberships.version + 1, updated_by = v_actor
    where memberships.id = v_before.id returning * into v_after;
  end if;

  update public.stores as stores set version = stores.version + 1, updated_at = now()
  where stores.id = v_store.id returning * into v_store;
  v_result := jsonb_build_object(
    'storeId', v_store.id, 'operatorId', p_operator_id,
    'active', coalesce(v_after.status = 'active', false),
    'membershipVersion', case when v_after.id is null then null else v_after.version end,
    'storeVersion', v_store.version
  );
  insert into public.owner_store_management_events (
    actor_user_id, idempotency_key, action, store_id, reason, request_snapshot,
    before_snapshot, after_snapshot, result
  ) values (
    v_actor, p_idempotency_key, v_action, v_store.id, btrim(p_reason), v_request,
    case when v_before.id is null then null else to_jsonb(v_before) - 'created_by' - 'updated_by' end,
    case when v_after.id is null then null else to_jsonb(v_after) - 'created_by' - 'updated_by' end,
    v_result
  );
  return v_result;
end;
$$;

revoke all on function public.set_owner_store_operator(uuid, uuid, boolean, bigint, bigint, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.set_owner_store_operator(uuid, uuid, boolean, bigint, bigint, uuid, text)
to authenticated;

-- Keep create/update compatible with grade-zero owners while preserving the
-- representative column and the operator membership created by the trigger.
create or replace function public.manage_owner_store(
  p_action text, p_store_id uuid default null, p_business_id uuid default null,
  p_slug text default null, p_name text default null, p_description text default null,
  p_operator_id uuid default null, p_expected_version bigint default null,
  p_idempotency_key uuid default null, p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_grade_zero_owner();
  v_before public.stores%rowtype;
  v_after public.stores%rowtype;
  v_result jsonb;
  v_existing_action text;
  v_existing_request jsonb;
  v_request jsonb;
begin
  if p_action not in ('create', 'update', 'archive', 'restore') then raise exception using errcode = '22023', message = '지원하지 않는 매장 관리 작업입니다.'; end if;
  if p_idempotency_key is null then raise exception using errcode = '22023', message = '중복 처리 방지 키가 필요합니다.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception using errcode = '22023', message = '처리 사유를 확인해 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0));
  v_request := jsonb_build_object('action', p_action, 'storeId', p_store_id, 'businessId', p_business_id,
    'slug', case when p_slug is null then null else lower(btrim(p_slug)) end,
    'name', case when p_name is null then null else btrim(p_name) end,
    'description', case when p_description is null then null else btrim(p_description) end,
    'operatorId', p_operator_id, 'expectedVersion', p_expected_version);
  select events.action, events.request_snapshot, events.result into v_existing_action, v_existing_request, v_result
  from public.owner_store_management_events as events where events.actor_user_id = v_actor and events.idempotency_key = p_idempotency_key;
  if found then
    if v_existing_action <> p_action or v_existing_request <> v_request then raise exception using errcode = '55000', message = '같은 중복 처리 방지 키로 다른 요청을 처리할 수 없습니다.'; end if;
    return v_result;
  end if;
  if p_action = 'create' then
    if p_store_id is not null or p_business_id is null or p_operator_id is null then raise exception using errcode = '22023', message = '새 매장 필수 정보를 확인해 주세요.'; end if;
    if lower(btrim(coalesce(p_slug, ''))) !~ '^[a-z0-9-]{2,80}$' or char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 or char_length(btrim(coalesce(p_description, ''))) > 1000 then raise exception using errcode = '22023', message = '매장 코드, 이름 또는 설명 형식을 확인해 주세요.'; end if;
    if not exists (select 1 from public.businesses where id = p_business_id and status = 'active') then raise exception using errcode = '23503', message = '활성 사업체를 찾을 수 없습니다.'; end if;
    if not exists (select 1 from public.account_access_roles as roles where roles.user_id = p_operator_id and (roles.role_code = 'operator' or (roles.role_code = 'owner' and coalesce(roles.grade_level, 99) = 0))) then raise exception using errcode = '23514', message = '운영자 또는 최고 등급 소유자만 배치할 수 있습니다.'; end if;
    insert into public.stores (business_id, slug, name, description, operator_id, is_active) values (p_business_id, lower(btrim(p_slug)), btrim(p_name), btrim(coalesce(p_description, '')), p_operator_id, true) returning * into v_after;
  else
    if p_store_id is null or p_expected_version is null then raise exception using errcode = '22023', message = '매장과 현재 버전이 필요합니다.'; end if;
    select stores.* into v_before from public.stores as stores where stores.id = p_store_id for update;
    if not found then raise exception using errcode = 'P0002', message = '매장을 찾을 수 없습니다.'; end if;
    if v_before.version <> p_expected_version then raise exception using errcode = '55000', message = '매장 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'; end if;
    if p_action = 'update' then
      if lower(btrim(coalesce(p_slug, ''))) !~ '^[a-z0-9-]{2,80}$' or char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 or char_length(btrim(coalesce(p_description, ''))) > 1000 or p_operator_id is null then raise exception using errcode = '22023', message = '매장 코드, 이름, 설명 또는 운영자를 확인해 주세요.'; end if;
      if not exists (select 1 from public.account_access_roles as roles where roles.user_id = p_operator_id and (roles.role_code = 'operator' or (roles.role_code = 'owner' and coalesce(roles.grade_level, 99) = 0))) then raise exception using errcode = '23514', message = '운영자 또는 최고 등급 소유자만 새로 배치할 수 있습니다.'; end if;
      update public.stores set slug = lower(btrim(p_slug)), name = btrim(p_name), description = btrim(coalesce(p_description, '')), operator_id = p_operator_id, version = version + 1, updated_at = now() where id = v_before.id returning * into v_after;
    elsif p_action = 'archive' then
      if exists (select 1 from public.products where store_id = v_before.id and status in ('pending', 'active')) then raise exception using errcode = '23514', message = '등록 대기 또는 판매 중인 상품이 있는 매장은 삭제할 수 없습니다.'; end if;
      update public.stores set is_active = false, version = version + 1, updated_at = now() where id = v_before.id and is_active returning * into v_after;
      if not found then raise exception using errcode = '22023', message = '이미 삭제된 매장입니다.'; end if;
    else
      update public.stores set is_active = true, version = version + 1, updated_at = now() where id = v_before.id and not is_active returning * into v_after;
      if not found then raise exception using errcode = '22023', message = '이미 운영 중인 매장입니다.'; end if;
    end if;
  end if;
  v_result := jsonb_build_object('store', app_private.owner_store_snapshot(v_after));
  insert into public.owner_store_management_events (actor_user_id, idempotency_key, action, store_id, reason, request_snapshot, before_snapshot, after_snapshot, result)
  values (v_actor, p_idempotency_key, p_action, v_after.id, btrim(p_reason), v_request,
    case when v_before.id is null then null else app_private.owner_store_snapshot(v_before) end,
    app_private.owner_store_snapshot(v_after), v_result);
  return v_result;
end;
$$;

revoke all on function public.manage_owner_store(text, uuid, uuid, text, text, text, uuid, bigint, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.manage_owner_store(text, uuid, uuid, text, text, text, uuid, bigint, uuid, text)
to authenticated;

commit;
