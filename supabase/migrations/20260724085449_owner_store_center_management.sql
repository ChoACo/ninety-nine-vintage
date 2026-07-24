-- Owner-managed center (store) administration.
-- A store is the operational center. This migration intentionally does not
-- recreate the retired fulfillment-center address or routing topology.

alter table public.stores
  add column if not exists version bigint not null default 0
    check (version >= 0);

create table if not exists public.owner_store_management_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null
    references public.profiles (id) on delete restrict,
  idempotency_key uuid not null,
  action text not null check (
    action in (
      'create',
      'update',
      'archive',
      'restore',
      'employee_assign',
      'employee_remove'
    )
  ),
  store_id uuid not null
    references public.stores (id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  request_snapshot jsonb not null default '{}'::jsonb,
  before_snapshot jsonb,
  after_snapshot jsonb,
  result jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key)
);

alter table public.owner_store_management_events enable row level security;
alter table public.owner_store_management_events force row level security;

drop policy if exists "Owners read store management events"
on public.owner_store_management_events;
create policy "Owners read store management events"
on public.owner_store_management_events
for select
to authenticated
using ((select public.is_owner()));

revoke all privileges on table public.owner_store_management_events
from public, anon, authenticated, service_role;
grant select on table public.owner_store_management_events to authenticated;

create or replace function public.sync_store_operator_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_assignee_role text;
begin
  if tg_op = 'UPDATE' and new.operator_id = old.operator_id then
    return new;
  end if;

  v_assignee_role := public.access_role_for_user(new.operator_id);

  for v_membership in
    select memberships.*
    from public.store_memberships as memberships
    where memberships.store_id = new.id
      and memberships.status = 'active'
      and (
        v_assignee_role = 'owner'
        or (
          memberships.membership_role = 'operator'
          and memberships.user_id <> new.operator_id
        )
        or (
          memberships.membership_role = 'employee'
          and not exists (
            select 1
            from public.account_access_roles as roles
            where roles.user_id = memberships.user_id
              and roles.role_code = 'employee'
              and roles.reports_to_operator_id = new.operator_id
              and public.access_role_for_user(roles.user_id) = 'employee'
          )
        )
      )
  loop
    perform app_private.sync_store_membership_relationship(
      new.business_id,
      new.id,
      v_membership.user_id,
      v_membership.membership_role,
      false,
      '매장 담당 운영자 변경으로 기존 소속 비활성화'
    );
  end loop;

  if v_assignee_role = 'owner' then
    return new;
  end if;

  perform app_private.sync_store_membership_relationship(
    new.business_id,
    new.id,
    new.operator_id,
    'operator',
    true,
    '매장 담당 운영자 관계 동기화'
  );

  -- Employees are assigned to individual stores through
  -- set_owner_store_employee. An operator may manage more than one store,
  -- so reporting to that operator must not grant every store automatically.
  return new;
end;
$$;

revoke all on function public.sync_store_operator_memberships()
from public, anon, authenticated, service_role;

create or replace function public.sync_employee_store_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role_code = 'employee' then
    for v_membership in
      select memberships.*
      from public.store_memberships as memberships
      where memberships.user_id = old.user_id
        and memberships.membership_role = 'employee'
        and memberships.status = 'active'
        and (
          tg_op = 'DELETE'
          or new.role_code <> 'employee'
          or new.reports_to_operator_id is distinct from old.reports_to_operator_id
        )
    loop
      perform app_private.sync_store_membership_relationship(
        v_membership.business_id,
        v_membership.store_id,
        v_membership.user_id,
        'employee',
        false,
        '직원 역할 또는 담당 운영자 변경으로 기존 소속 비활성화'
      );
    end loop;
  end if;

  -- Explicit store placement is the sole source of new employee memberships.
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.sync_employee_store_memberships()
from public, anon, authenticated, service_role;

create or replace function app_private.require_grade_zero_owner()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null
    or not public.is_owner()
    or not exists (
      select 1
      from public.account_access_roles as roles
      where roles.user_id = v_actor
        and roles.role_code = 'owner'
        and roles.grade_level = 0
    )
  then
    raise exception using
      errcode = '42501',
      message = '관리자 권한이 필요합니다.';
  end if;
  return v_actor;
end;
$$;

revoke all on function app_private.require_grade_zero_owner()
from public, anon, authenticated, service_role;

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
    'businesses',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', businesses.id,
          'code', businesses.code,
          'name', businesses.name
        )
        order by businesses.name, businesses.id
      )
      from public.businesses as businesses
      where businesses.status = 'active'
    ), '[]'::jsonb),
    'operators',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', roles.user_id,
          'displayName', profiles.display_name,
          'roleCode', roles.role_code,
          'assignable', roles.role_code = 'operator'
        )
        order by
          case when roles.role_code = 'operator' then 0 else 1 end,
          profiles.display_name,
          roles.user_id
      )
      from public.account_access_roles as roles
      join public.profiles as profiles on profiles.id = roles.user_id
      where (
        roles.role_code = 'operator'
        or (
          roles.role_code = 'owner'
          and exists (
            select 1
            from public.stores as assigned_stores
            where assigned_stores.operator_id = roles.user_id
          )
        )
      )
        and profiles.deleted_at is null
    ), '[]'::jsonb),
    'employees',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', roles.user_id,
          'displayName', profiles.display_name,
          'reportsToOperatorId', roles.reports_to_operator_id
        )
        order by profiles.display_name, roles.user_id
      )
      from public.account_access_roles as roles
      join public.profiles as profiles on profiles.id = roles.user_id
      where roles.role_code = 'employee'
        and public.access_role_for_user(roles.user_id) = 'employee'
        and profiles.deleted_at is null
    ), '[]'::jsonb),
    'stores',
    coalesce((
      select jsonb_agg(
        app_private.owner_store_snapshot(stores)
        || jsonb_build_object(
          'businessName', businesses.name,
          'operatorName', operator_profiles.display_name,
          'employees',
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'membershipId', memberships.id,
                'userId', memberships.user_id,
                'displayName', employee_profiles.display_name,
                'version', memberships.version
              )
              order by employee_profiles.display_name, memberships.user_id
            )
            from public.store_memberships as memberships
            join public.profiles as employee_profiles
              on employee_profiles.id = memberships.user_id
            where memberships.store_id = stores.id
              and memberships.membership_role = 'employee'
              and memberships.status = 'active'
          ), '[]'::jsonb)
        )
        order by stores.is_active desc, stores.name, stores.id
      )
      from public.stores as stores
      join public.businesses as businesses on businesses.id = stores.business_id
      join public.profiles as operator_profiles
        on operator_profiles.id = stores.operator_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_owner_store_management()
from public, anon, authenticated, service_role;
grant execute on function public.get_owner_store_management() to authenticated;

create or replace function public.manage_owner_store(
  p_action text,
  p_store_id uuid default null,
  p_business_id uuid default null,
  p_slug text default null,
  p_name text default null,
  p_description text default null,
  p_operator_id uuid default null,
  p_expected_version bigint default null,
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
  v_before public.stores%rowtype;
  v_after public.stores%rowtype;
  v_result jsonb;
  v_existing_action text;
  v_existing_request jsonb;
  v_request jsonb;
begin
  v_actor := app_private.require_grade_zero_owner();

  if p_action not in ('create', 'update', 'archive', 'restore') then
    raise exception using errcode = '22023', message = '지원하지 않는 매장 관리 작업입니다.';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = '중복 처리 방지 키가 필요합니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = '처리 사유를 확인해 주세요.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0)
  );

  v_request := jsonb_build_object(
    'action', p_action,
    'storeId', p_store_id,
    'businessId', p_business_id,
    'slug', case when p_slug is null then null else lower(btrim(p_slug)) end,
    'name', case when p_name is null then null else btrim(p_name) end,
    'description', case when p_description is null then null else btrim(p_description) end,
    'operatorId', p_operator_id,
    'expectedVersion', p_expected_version
  );

  select events.action, events.request_snapshot, events.result
  into v_existing_action, v_existing_request, v_result
  from public.owner_store_management_events as events
  where events.actor_user_id = v_actor
    and events.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_action <> p_action or v_existing_request <> v_request then
      raise exception using
        errcode = '55000',
        message = '같은 중복 처리 방지 키로 다른 요청을 처리할 수 없습니다.';
    end if;
    return v_result;
  end if;

  if p_action = 'create' then
    if p_store_id is not null or p_business_id is null or p_operator_id is null then
      raise exception using errcode = '22023', message = '새 매장 필수 정보를 확인해 주세요.';
    end if;
    if lower(btrim(coalesce(p_slug, ''))) !~ '^[a-z0-9-]{2,80}$'
      or char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
      or char_length(btrim(coalesce(p_description, ''))) > 1000
    then
      raise exception using errcode = '22023', message = '매장 코드, 이름 또는 설명 형식을 확인해 주세요.';
    end if;
    if not exists (
      select 1 from public.businesses
      where id = p_business_id and status = 'active'
    ) then
      raise exception using errcode = '23503', message = '활성 사업체를 찾을 수 없습니다.';
    end if;
    if public.access_role_for_user(p_operator_id) is distinct from 'operator' then
      raise exception using errcode = '23514', message = '현재 운영자 계정만 배치할 수 있습니다.';
    end if;

    insert into public.stores (
      business_id,
      slug,
      name,
      description,
      operator_id,
      is_active
    ) values (
      p_business_id,
      lower(btrim(p_slug)),
      btrim(p_name),
      btrim(coalesce(p_description, '')),
      p_operator_id,
      true
    )
    returning * into v_after;
  else
    if p_store_id is null or p_expected_version is null then
      raise exception using errcode = '22023', message = '매장과 현재 버전이 필요합니다.';
    end if;

    select stores.*
    into v_before
    from public.stores as stores
    where stores.id = p_store_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '매장을 찾을 수 없습니다.';
    end if;
    if v_before.version <> p_expected_version then
      raise exception using errcode = '55000', message = '매장 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
    end if;

    if p_action = 'update' then
      if lower(btrim(coalesce(p_slug, ''))) !~ '^[a-z0-9-]{2,80}$'
        or char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
        or char_length(btrim(coalesce(p_description, ''))) > 1000
        or p_operator_id is null
      then
        raise exception using errcode = '22023', message = '매장 코드, 이름, 설명 또는 운영자를 확인해 주세요.';
      end if;
      if p_operator_id <> v_before.operator_id
        and public.access_role_for_user(p_operator_id) is distinct from 'operator'
      then
        raise exception using errcode = '23514', message = '현재 운영자 계정만 새로 배치할 수 있습니다.';
      end if;

      update public.stores as stores
      set
        slug = lower(btrim(p_slug)),
        name = btrim(p_name),
        description = btrim(coalesce(p_description, '')),
        operator_id = p_operator_id,
        version = stores.version + 1,
        updated_at = now()
      where stores.id = v_before.id
      returning * into v_after;
    elsif p_action = 'archive' then
      if exists (
        select 1
        from public.products as products
        where products.store_id = v_before.id
          and products.status in ('pending', 'active')
      ) then
        raise exception using
          errcode = '23514',
          message = '등록 대기 또는 판매 중인 상품이 있는 매장은 삭제할 수 없습니다.';
      end if;

      update public.stores as stores
      set
        is_active = false,
        version = stores.version + 1,
        updated_at = now()
      where stores.id = v_before.id
        and stores.is_active
      returning * into v_after;
      if not found then
        raise exception using errcode = '22023', message = '이미 삭제된 매장입니다.';
      end if;
    else
      update public.stores as stores
      set
        is_active = true,
        version = stores.version + 1,
        updated_at = now()
      where stores.id = v_before.id
        and not stores.is_active
      returning * into v_after;
      if not found then
        raise exception using errcode = '22023', message = '이미 운영 중인 매장입니다.';
      end if;
    end if;
  end if;

  v_result := jsonb_build_object(
    'store', app_private.owner_store_snapshot(v_after)
  );

  insert into public.owner_store_management_events (
    actor_user_id,
    idempotency_key,
    action,
    store_id,
    reason,
    request_snapshot,
    before_snapshot,
    after_snapshot,
    result
  ) values (
    v_actor,
    p_idempotency_key,
    p_action,
    v_after.id,
    btrim(p_reason),
    v_request,
    case when v_before.id is null then null else app_private.owner_store_snapshot(v_before) end,
    app_private.owner_store_snapshot(v_after),
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.manage_owner_store(
  text, uuid, uuid, text, text, text, uuid, bigint, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.manage_owner_store(
  text, uuid, uuid, text, text, text, uuid, bigint, uuid, text
) to authenticated;

create or replace function public.set_owner_store_employee(
  p_store_id uuid,
  p_employee_id uuid,
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
  v_existing_action text;
  v_existing_request jsonb;
  v_request jsonb;
  v_action text := case when coalesce(p_active, false) then 'employee_assign' else 'employee_remove' end;
begin
  v_actor := app_private.require_grade_zero_owner();

  if p_store_id is null or p_employee_id is null or p_expected_store_version is null then
    raise exception using errcode = '22023', message = '매장과 직원 정보를 확인해 주세요.';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = '중복 처리 방지 키가 필요합니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = '처리 사유를 확인해 주세요.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0)
  );

  v_request := jsonb_build_object(
    'action', v_action,
    'storeId', p_store_id,
    'employeeId', p_employee_id,
    'active', coalesce(p_active, false),
    'expectedStoreVersion', p_expected_store_version,
    'expectedMembershipVersion', p_expected_membership_version
  );

  select events.action, events.request_snapshot, events.result
  into v_existing_action, v_existing_request, v_result
  from public.owner_store_management_events as events
  where events.actor_user_id = v_actor
    and events.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_action <> v_action or v_existing_request <> v_request then
      raise exception using
        errcode = '55000',
        message = '같은 중복 처리 방지 키로 다른 요청을 처리할 수 없습니다.';
    end if;
    return v_result;
  end if;

  select stores.*
  into v_store
  from public.stores as stores
  where stores.id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '매장을 찾을 수 없습니다.';
  end if;
  if not v_store.is_active then
    raise exception using errcode = '23514', message = '삭제된 매장에는 직원을 배치할 수 없습니다.';
  end if;
  if v_store.version <> p_expected_store_version then
    raise exception using errcode = '55000', message = '매장 담당자가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if public.access_role_for_user(p_employee_id) is distinct from 'employee' then
    raise exception using errcode = '23514', message = '현재 직원 계정만 배치할 수 있습니다.';
  end if;

  select memberships.*
  into v_before
  from public.store_memberships as memberships
  where memberships.store_id = p_store_id
    and memberships.user_id = p_employee_id
  for update;

  if found
    and p_expected_membership_version is not null
    and p_expected_membership_version is distinct from v_before.version
  then
    raise exception using errcode = '55000', message = '직원 배치 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  elsif not found and p_expected_membership_version is not null then
    raise exception using errcode = '55000', message = '직원 배치 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;

  if p_active then
    update public.account_access_roles as roles
    set
      reports_to_operator_id = v_store.operator_id,
      updated_at = now()
    where roles.user_id = p_employee_id
      and roles.role_code = 'employee'
      and roles.reports_to_operator_id is distinct from v_store.operator_id;
  end if;

  perform app_private.sync_store_membership_relationship(
    v_store.business_id,
    v_store.id,
    p_employee_id,
    'employee',
    coalesce(p_active, false),
    btrim(p_reason)
  );

  select memberships.*
  into v_after
  from public.store_memberships as memberships
  where memberships.store_id = p_store_id
    and memberships.user_id = p_employee_id;

  v_result := jsonb_build_object(
    'storeId', v_store.id,
    'employeeId', p_employee_id,
    'active', coalesce(v_after.status = 'active', false),
    'membershipVersion', v_after.version
  );

  insert into public.owner_store_management_events (
    actor_user_id,
    idempotency_key,
    action,
    store_id,
    reason,
    request_snapshot,
    before_snapshot,
    after_snapshot,
    result
  ) values (
    v_actor,
    p_idempotency_key,
    v_action,
    v_store.id,
    btrim(p_reason),
    v_request,
    case
      when v_before.id is null then null
      else to_jsonb(v_before) - 'created_by' - 'updated_by'
    end,
    case
      when v_after.id is null then null
      else to_jsonb(v_after) - 'created_by' - 'updated_by'
    end,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.set_owner_store_employee(
  uuid, uuid, boolean, bigint, bigint, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.set_owner_store_employee(
  uuid, uuid, boolean, bigint, bigint, uuid, text
) to authenticated;

comment on column public.stores.version is
  'Optimistic concurrency version for Owner center(store) administration.';
comment on table public.owner_store_management_events is
  'Append-only Owner audit and idempotency receipts for center(store) CRUD and employee placement.';
comment on function public.get_owner_store_management() is
  'Grade-zero Owner directory for center(store), operator, and employee placement.';
comment on function public.manage_owner_store(
  text, uuid, uuid, text, text, text, uuid, bigint, uuid, text
) is
  'Grade-zero Owner CAS/idempotent create, update, archive, and restore for stores as operational centers.';
comment on function public.set_owner_store_employee(
  uuid, uuid, boolean, bigint, bigint, uuid, text
) is
  'Grade-zero Owner CAS/idempotent employee placement for one store at a time.';
