begin;

set local lock_timeout = '5s';

lock table
  public.account_access_roles,
  public.stores
in share row exclusive mode;

-- A store assignment is an internal operating relationship, not an external
-- seller account. Refuse to project an invalid legacy operator instead of
-- silently granting a member or former employee access to store work.
do $$
begin
  if exists (
    select 1
    from public.stores as stores
    where public.access_role_for_user(stores.operator_id) is distinct from 'operator'
  ) then
    raise exception using
      errcode = '23514',
      message = '유효한 운영자가 아닌 stores.operator_id가 있어 매장 소속을 안전하게 생성할 수 없습니다.';
  end if;
end;
$$;

create table public.store_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  store_id uuid not null,
  -- Keep the UUID as an immutable subject snapshot after a former employee
  -- deletes their Kakao account. The account-role delete trigger deactivates
  -- the relationship before the profile cascade completes.
  user_id uuid not null,
  membership_role text not null
    check (membership_role in ('operator', 'employee')),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  manage_products boolean not null default false,
  publish_products boolean not null default false,
  prepare_orders boolean not null default false,
  confirm_payments boolean not null default false,
  receive_at_center boolean not null default false,
  create_shipments boolean not null default false,
  manage_staff boolean not null default false,
  view_reports boolean not null default false,
  version bigint not null default 0 check (version >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint store_memberships_store_business_fkey
    foreign key (store_id, business_id)
    references public.stores (id, business_id)
    on delete restrict,
  constraint store_memberships_store_user_key
    unique (store_id, user_id),
  constraint store_memberships_identity_key
    unique (id, business_id, store_id, user_id),
  constraint store_memberships_timestamp_order_check
    check (updated_at >= created_at)
);

create index store_memberships_user_scope_idx
  on public.store_memberships (user_id, status, business_id, store_id);

create index store_memberships_business_permission_idx
  on public.store_memberships (business_id, user_id, status)
  where status = 'active';

create table public.store_membership_permission_audits (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.store_memberships (id) on delete restrict,
  business_id uuid not null,
  store_id uuid not null,
  user_id uuid not null,
  action text not null
    check (action in ('backfilled', 'relationship_synchronized', 'access_configured')),
  actor_kind text not null
    check (actor_kind in ('user', 'system', 'migration')),
  -- Actor identity is immutable audit evidence and therefore deliberately has
  -- no ON DELETE action that would rewrite an append-only row.
  actor_user_id uuid,
  actor_role_snapshot text not null
    check (char_length(btrim(actor_role_snapshot)) between 1 and 80),
  idempotency_key uuid not null,
  requested_status text
    check (requested_status is null or requested_status in ('active', 'inactive')),
  requested_permissions jsonb,
  reason text not null
    check (
      char_length(btrim(reason)) between 3 and 500
      and reason !~ '[[:cntrl:]]'
    ),
  before_status text,
  after_status text not null,
  before_permissions jsonb,
  after_permissions jsonb not null,
  from_version bigint,
  to_version bigint not null check (to_version >= 0),
  occurred_at timestamptz not null default clock_timestamp(),
  constraint store_membership_permission_audits_membership_identity_fkey
    foreign key (membership_id, business_id, store_id, user_id)
    references public.store_memberships (id, business_id, store_id, user_id)
    on delete restrict,
  constraint store_membership_permission_audits_actor_check
    check (actor_kind <> 'user' or actor_user_id is not null),
  constraint store_membership_permission_audits_request_permissions_check
    check (
      requested_permissions is null
      or jsonb_typeof(requested_permissions) = 'object'
    ),
  constraint store_membership_permission_audits_before_permissions_check
    check (
      before_permissions is null
      or jsonb_typeof(before_permissions) = 'object'
    ),
  constraint store_membership_permission_audits_after_permissions_check
    check (jsonb_typeof(after_permissions) = 'object'),
  constraint store_membership_permission_audits_version_order_check
    check (from_version is null or to_version > from_version),
  constraint store_membership_permission_audits_membership_idempotency_key
    unique (membership_id, idempotency_key)
);

create unique index store_membership_permission_audits_actor_idempotency_idx
  on public.store_membership_permission_audits (actor_user_id, idempotency_key)
  where actor_user_id is not null;

create index store_membership_permission_audits_subject_history_idx
  on public.store_membership_permission_audits (
    user_id,
    occurred_at desc,
    id desc
  );

create or replace function app_private.store_membership_permissions_json(
  p_membership public.store_memberships
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'manage_products', p_membership.manage_products,
    'publish_products', p_membership.publish_products,
    'prepare_orders', p_membership.prepare_orders,
    'confirm_payments', p_membership.confirm_payments,
    'receive_at_center', p_membership.receive_at_center,
    'create_shipments', p_membership.create_shipments,
    'manage_staff', p_membership.manage_staff,
    'view_reports', p_membership.view_reports
  );
$$;

revoke all on function app_private.store_membership_permissions_json(
  public.store_memberships
) from public, anon, authenticated, service_role;

create or replace function app_private.reject_store_membership_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = '매장 권한 감사 이력은 수정하거나 삭제할 수 없습니다.';
end;
$$;

revoke all on function app_private.reject_store_membership_audit_mutation()
from public, anon, authenticated, service_role;

create trigger store_membership_permission_audits_append_only
before update or delete or truncate
on public.store_membership_permission_audits
for each statement
execute function app_private.reject_store_membership_audit_mutation();

create or replace function public.validate_store_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_role public.account_access_roles%rowtype;
begin
  select stores.*
  into v_store
  from public.stores as stores
  where stores.id = new.store_id
    and stores.business_id = new.business_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = '매장과 사업체 경계를 확인할 수 없습니다.';
  end if;

  select roles.*
  into v_role
  from public.account_access_roles as roles
  where roles.user_id = new.user_id;

  if new.status = 'active' then
    if new.membership_role = 'operator' and (
      v_store.operator_id <> new.user_id
      or public.access_role_for_user(new.user_id) is distinct from 'operator'
    ) then
      raise exception using
        errcode = '23514',
        message = '활성 운영자 소속은 현재 매장 담당 운영자와 일치해야 합니다.';
    elsif new.membership_role = 'employee' and (
      v_role.role_code is distinct from 'employee'
      or v_role.reports_to_operator_id is distinct from v_store.operator_id
      or public.access_role_for_user(new.user_id) is distinct from 'employee'
    ) then
      raise exception using
        errcode = '23514',
        message = '활성 직원 소속은 현재 담당 운영자의 매장과 일치해야 합니다.';
    end if;
  end if;

  if new.membership_role = 'operator'
    and v_store.operator_id = new.user_id
    and new.status <> 'active'
  then
    raise exception using
      errcode = '23514',
      message = '현재 매장 담당 운영자의 소속은 비활성화할 수 없습니다.';
  end if;

  if (
    new.receive_at_center
    or new.create_shipments
  ) and (
    tg_op = 'INSERT'
    or old.receive_at_center is distinct from new.receive_at_center
    or old.create_shipments is distinct from new.create_shipments
  ) and auth.uid() is not null and not public.is_owner() then
    raise exception using
      errcode = '42501',
      message = '중앙 입고와 송장 권한은 시스템 관리자만 부여할 수 있습니다.';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.validate_store_membership()
from public, anon, authenticated, service_role;

create trigger store_memberships_validate
before insert or update
on public.store_memberships
for each row
execute function public.validate_store_membership();

-- The backfill preserves the existing product-management contract. Operators
-- retain their own active stores and employees retain every current store of
-- their reporting operator. Central rights are deliberately never inferred.
insert into public.store_memberships (
  business_id,
  store_id,
  user_id,
  membership_role,
  status,
  manage_products,
  publish_products,
  prepare_orders,
  confirm_payments,
  receive_at_center,
  create_shipments,
  manage_staff,
  view_reports
)
select
  stores.business_id,
  stores.id,
  stores.operator_id,
  'operator',
  'active',
  true,
  true,
  true,
  true,
  false,
  false,
  true,
  true
from public.stores as stores;

insert into public.store_memberships (
  business_id,
  store_id,
  user_id,
  membership_role,
  status,
  manage_products,
  publish_products,
  prepare_orders,
  confirm_payments,
  receive_at_center,
  create_shipments,
  manage_staff,
  view_reports
)
select
  stores.business_id,
  stores.id,
  roles.user_id,
  'employee',
  'active',
  true,
  false,
  false,
  false,
  false,
  false,
  false,
  false
from public.account_access_roles as roles
join public.stores as stores
  on stores.operator_id = roles.reports_to_operator_id
where roles.role_code = 'employee'
  and public.access_role_for_user(roles.user_id) = 'employee';

insert into public.store_membership_permission_audits (
  membership_id,
  business_id,
  store_id,
  user_id,
  action,
  actor_kind,
  actor_role_snapshot,
  idempotency_key,
  reason,
  after_status,
  after_permissions,
  to_version
)
select
  memberships.id,
  memberships.business_id,
  memberships.store_id,
  memberships.user_id,
  'backfilled',
  'migration',
  'migration',
  gen_random_uuid(),
  '기존 운영자와 직원의 매장 관계를 명시적 소속으로 이관',
  memberships.status,
  app_private.store_membership_permissions_json(memberships),
  memberships.version
from public.store_memberships as memberships;

create or replace function app_private.sync_store_membership_relationship(
  p_business_id uuid,
  p_store_id uuid,
  p_user_id uuid,
  p_membership_role text,
  p_active boolean,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.store_memberships%rowtype;
  v_after public.store_memberships%rowtype;
  v_store public.stores%rowtype;
  v_role public.account_access_roles%rowtype;
  v_status text := case when coalesce(p_active, false) then 'active' else 'inactive' end;
  v_reset_permissions boolean := false;
begin
  if p_membership_role not in ('operator', 'employee') then
    raise exception using errcode = '22023', message = '지원하지 않는 매장 소속 역할입니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = '매장 소속 동기화 사유를 확인해 주세요.';
  end if;

  select stores.*
  into v_store
  from public.stores as stores
  where stores.id = p_store_id
    and stores.business_id = p_business_id;
  if not found then
    raise exception using errcode = '23503', message = '동기화할 매장을 찾을 수 없습니다.';
  end if;

  if p_active then
    select roles.*
    into v_role
    from public.account_access_roles as roles
    where roles.user_id = p_user_id;

    if p_membership_role = 'operator' and (
      v_store.operator_id <> p_user_id
      or public.access_role_for_user(p_user_id) is distinct from 'operator'
    ) then
      raise exception using errcode = '23514', message = '현재 매장 담당 운영자가 아닙니다.';
    elsif p_membership_role = 'employee' and (
      v_role.role_code is distinct from 'employee'
      or v_role.reports_to_operator_id is distinct from v_store.operator_id
      or public.access_role_for_user(p_user_id) is distinct from 'employee'
    ) then
      raise exception using errcode = '23514', message = '현재 매장 담당 직원이 아닙니다.';
    end if;
  end if;

  select memberships.*
  into v_before
  from public.store_memberships as memberships
  where memberships.store_id = p_store_id
    and memberships.user_id = p_user_id
  for update;

  if not found then
    if not p_active then return null; end if;

    insert into public.store_memberships (
      business_id,
      store_id,
      user_id,
      membership_role,
      status,
      manage_products,
      publish_products,
      prepare_orders,
      confirm_payments,
      receive_at_center,
      create_shipments,
      manage_staff,
      view_reports,
      created_by,
      updated_by
    ) values (
      p_business_id,
      p_store_id,
      p_user_id,
      p_membership_role,
      'active',
      true,
      p_membership_role = 'operator',
      p_membership_role = 'operator',
      p_membership_role = 'operator',
      false,
      false,
      p_membership_role = 'operator',
      p_membership_role = 'operator',
      v_actor,
      v_actor
    )
    returning * into v_after;
  else
    v_reset_permissions := p_active and (
      v_before.status <> 'active'
      or v_before.membership_role <> p_membership_role
    );

    if v_before.status = v_status
      and v_before.membership_role = p_membership_role
    then
      return v_before.id;
    end if;

    update public.store_memberships as memberships
    set
      business_id = p_business_id,
      membership_role = p_membership_role,
      status = v_status,
      manage_products = case when v_reset_permissions then true else memberships.manage_products end,
      publish_products = case when v_reset_permissions then p_membership_role = 'operator' else memberships.publish_products end,
      prepare_orders = case when v_reset_permissions then p_membership_role = 'operator' else memberships.prepare_orders end,
      confirm_payments = case when v_reset_permissions then p_membership_role = 'operator' else memberships.confirm_payments end,
      receive_at_center = case when v_reset_permissions then false else memberships.receive_at_center end,
      create_shipments = case when v_reset_permissions then false else memberships.create_shipments end,
      manage_staff = case when v_reset_permissions then p_membership_role = 'operator' else memberships.manage_staff end,
      view_reports = case when v_reset_permissions then p_membership_role = 'operator' else memberships.view_reports end,
      version = memberships.version + 1,
      updated_by = v_actor
    where memberships.id = v_before.id
    returning * into v_after;
  end if;

  insert into public.store_membership_permission_audits (
    membership_id,
    business_id,
    store_id,
    user_id,
    action,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    reason,
    before_status,
    after_status,
    before_permissions,
    after_permissions,
    from_version,
    to_version
  ) values (
    v_after.id,
    v_after.business_id,
    v_after.store_id,
    v_after.user_id,
    'relationship_synchronized',
    case when v_actor is null then 'system' else 'user' end,
    v_actor,
    coalesce(public.access_role_for_user(v_actor), 'system'),
    gen_random_uuid(),
    btrim(p_reason),
    case when v_before.id is null then null else v_before.status end,
    v_after.status,
    case
      when v_before.id is null then null
      else app_private.store_membership_permissions_json(v_before)
    end,
    app_private.store_membership_permissions_json(v_after),
    case when v_before.id is null then null else v_before.version end,
    v_after.version
  );

  return v_after.id;
end;
$$;

revoke all on function app_private.sync_store_membership_relationship(
  uuid, uuid, uuid, text, boolean, text
) from public, anon, authenticated, service_role;

create or replace function public.validate_store_operator_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.business_id is distinct from old.business_id then
    raise exception using
      errcode = '23514',
      message = '기존 매장의 사업체 경계는 변경할 수 없습니다.';
  end if;

  if public.access_role_for_user(new.operator_id) is distinct from 'operator' then
    raise exception using
      errcode = '23514',
      message = '매장 담당자는 현재 유효한 운영자여야 합니다.';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_store_operator_assignment()
from public, anon, authenticated, service_role;

create trigger stores_validate_operator_assignment
before insert or update of operator_id, business_id
on public.stores
for each row
execute function public.validate_store_operator_assignment();

create or replace function public.sync_store_operator_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_employee record;
begin
  if tg_op = 'UPDATE' and new.operator_id = old.operator_id then
    return new;
  end if;

  for v_membership in
    select memberships.*
    from public.store_memberships as memberships
    where memberships.store_id = new.id
      and memberships.status = 'active'
      and (
        (
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

  perform app_private.sync_store_membership_relationship(
    new.business_id,
    new.id,
    new.operator_id,
    'operator',
    true,
    '매장 담당 운영자 관계 동기화'
  );

  for v_employee in
    select roles.user_id
    from public.account_access_roles as roles
    where roles.role_code = 'employee'
      and roles.reports_to_operator_id = new.operator_id
      and public.access_role_for_user(roles.user_id) = 'employee'
    order by roles.user_id
  loop
    perform app_private.sync_store_membership_relationship(
      new.business_id,
      new.id,
      v_employee.user_id,
      'employee',
      true,
      '담당 운영자의 현재 매장에 직원 소속 동기화'
    );
  end loop;

  return new;
end;
$$;

revoke all on function public.sync_store_operator_memberships()
from public, anon, authenticated, service_role;

create trigger stores_sync_operator_memberships
after insert or update of operator_id
on public.stores
for each row
execute function public.sync_store_operator_memberships();

create or replace function public.protect_store_operator_access_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role_code = 'operator'
    and (tg_op = 'DELETE' or new.role_code <> 'operator')
    and exists (
      select 1
      from public.stores as stores
      where stores.operator_id = old.user_id
    )
  then
    raise exception using
      errcode = '23514',
      message = '담당 매장의 운영자를 먼저 변경한 뒤 운영자 역할을 해제해 주세요.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.protect_store_operator_access_role()
from public, anon, authenticated, service_role;

create trigger account_access_roles_protect_store_operator
before update of role_code or delete
on public.account_access_roles
for each row
execute function public.protect_store_operator_access_role();

create or replace function public.sync_employee_store_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_store record;
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

  if tg_op <> 'DELETE' and new.role_code = 'employee' and (
    tg_op = 'INSERT'
    or old.role_code <> 'employee'
    or new.reports_to_operator_id is distinct from old.reports_to_operator_id
  ) then
    for v_store in
      select stores.id, stores.business_id
      from public.stores as stores
      where stores.operator_id = new.reports_to_operator_id
      order by stores.id
    loop
      perform app_private.sync_store_membership_relationship(
        v_store.business_id,
        v_store.id,
        new.user_id,
        'employee',
        true,
        '직원 담당 운영자의 현재 매장에 소속 동기화'
      );
    end loop;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.sync_employee_store_memberships()
from public, anon, authenticated, service_role;

create trigger account_access_roles_sync_employee_memberships
after insert or update of role_code, reports_to_operator_id or delete
on public.account_access_roles
for each row
execute function public.sync_employee_store_memberships();

create or replace function public.has_store_permission(
  p_store_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.stores as stores
      join public.businesses as businesses
        on businesses.id = stores.business_id
       and businesses.status = 'active'
      where stores.id = p_store_id
        and stores.is_active
        and lower(btrim(coalesce(p_permission, ''))) in (
          'manage_products',
          'publish_products',
          'prepare_orders',
          'confirm_payments',
          'receive_at_center',
          'create_shipments',
          'manage_staff',
          'view_reports'
        )
        and (
          public.is_owner()
          or exists (
            select 1
            from public.store_memberships as memberships
            where memberships.store_id = stores.id
              and memberships.business_id = stores.business_id
              and memberships.user_id = auth.uid()
              and memberships.status = 'active'
              and case lower(btrim(coalesce(p_permission, '')))
                when 'manage_products' then memberships.manage_products
                when 'publish_products' then memberships.publish_products
                when 'prepare_orders' then memberships.prepare_orders
                when 'confirm_payments' then memberships.confirm_payments
                when 'receive_at_center' then memberships.receive_at_center
                when 'create_shipments' then memberships.create_shipments
                when 'manage_staff' then memberships.manage_staff
                when 'view_reports' then memberships.view_reports
                else false
              end
          )
        )
    ),
    false
  );
$$;

revoke all on function public.has_store_permission(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.has_store_permission(uuid, text)
to authenticated;

create or replace function public.has_business_permission(
  p_business_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.businesses as businesses
      where businesses.id = p_business_id
        and businesses.status = 'active'
        and lower(btrim(coalesce(p_permission, ''))) in (
          'manage_products',
          'publish_products',
          'prepare_orders',
          'confirm_payments',
          'receive_at_center',
          'create_shipments',
          'manage_staff',
          'view_reports'
        )
        and (
          public.is_owner()
          or exists (
            select 1
            from public.store_memberships as memberships
            join public.stores as stores
              on stores.id = memberships.store_id
             and stores.business_id = memberships.business_id
             and stores.is_active
            where memberships.business_id = businesses.id
              and memberships.user_id = auth.uid()
              and memberships.status = 'active'
              and case lower(btrim(coalesce(p_permission, '')))
                when 'manage_products' then memberships.manage_products
                when 'publish_products' then memberships.publish_products
                when 'prepare_orders' then memberships.prepare_orders
                when 'confirm_payments' then memberships.confirm_payments
                when 'receive_at_center' then memberships.receive_at_center
                when 'create_shipments' then memberships.create_shipments
                when 'manage_staff' then memberships.manage_staff
                when 'view_reports' then memberships.view_reports
                else false
              end
          )
        )
    ),
    false
  );
$$;

revoke all on function public.has_business_permission(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.has_business_permission(uuid, text)
to authenticated;

create or replace function public.can_manage_product_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_store_permission(p_store_id, 'manage_products');
$$;

revoke all on function public.can_manage_product_store(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.can_manage_product_store(uuid)
to authenticated;

create or replace function public.set_store_membership_access(
  p_membership_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_status text,
  p_permissions jsonb,
  p_reason text
)
returns table (
  membership_id uuid,
  membership_version bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_permissions jsonb;
  v_before public.store_memberships%rowtype;
  v_after public.store_memberships%rowtype;
  v_replay public.store_membership_permission_audits%rowtype;
begin
  if v_actor is null or v_actor_role <> 'owner' or not public.is_owner() then
    raise exception using errcode = '42501', message = '시스템 관리자만 매장 권한을 변경할 수 있습니다.';
  end if;
  if p_membership_id is null or p_expected_version is null or p_expected_version < 0 then
    raise exception using errcode = '22023', message = '매장 소속과 버전을 확인해 주세요.';
  end if;
  if p_idempotency_key is null
    or p_idempotency_key::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception using errcode = '22023', message = 'UUIDv4 멱등 키가 필요합니다.';
  end if;
  if v_status not in ('active', 'inactive') then
    raise exception using errcode = '22023', message = '매장 소속 상태를 확인해 주세요.';
  end if;
  if char_length(v_reason) not between 3 and 500 or v_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = '권한 변경 사유를 3자 이상 500자 이하로 입력해 주세요.';
  end if;
  if p_permissions is null
    or jsonb_typeof(p_permissions) <> 'object'
    or not p_permissions ?& array[
      'manage_products',
      'publish_products',
      'prepare_orders',
      'confirm_payments',
      'receive_at_center',
      'create_shipments',
      'manage_staff',
      'view_reports'
    ]
    or p_permissions - array[
      'manage_products',
      'publish_products',
      'prepare_orders',
      'confirm_payments',
      'receive_at_center',
      'create_shipments',
      'manage_staff',
      'view_reports'
    ] <> '{}'::jsonb
    or exists (
      select 1
      from jsonb_each(p_permissions) as entries(key, value)
      where jsonb_typeof(entries.value) <> 'boolean'
    )
  then
    raise exception using errcode = '22023', message = '매장 권한 8개를 모두 boolean 값으로 전달해 주세요.';
  end if;

  v_permissions := jsonb_build_object(
    'manage_products', (p_permissions ->> 'manage_products')::boolean,
    'publish_products', (p_permissions ->> 'publish_products')::boolean,
    'prepare_orders', (p_permissions ->> 'prepare_orders')::boolean,
    'confirm_payments', (p_permissions ->> 'confirm_payments')::boolean,
    'receive_at_center', (p_permissions ->> 'receive_at_center')::boolean,
    'create_shipments', (p_permissions ->> 'create_shipments')::boolean,
    'manage_staff', (p_permissions ->> 'manage_staff')::boolean,
    'view_reports', (p_permissions ->> 'view_reports')::boolean
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0)
  );

  select audits.*
  into v_replay
  from public.store_membership_permission_audits as audits
  where audits.actor_user_id = v_actor
    and audits.idempotency_key = p_idempotency_key;

  if found then
    if v_replay.action <> 'access_configured'
      or v_replay.membership_id <> p_membership_id
      or v_replay.from_version is distinct from p_expected_version
      or v_replay.requested_status is distinct from v_status
      or v_replay.requested_permissions is distinct from v_permissions
      or v_replay.reason is distinct from v_reason
    then
      raise exception using errcode = '23505', message = '이미 다른 권한 변경에 사용된 멱등 키입니다.';
    end if;

    return query select v_replay.membership_id, v_replay.to_version, true;
    return;
  end if;

  select memberships.*
  into v_before
  from public.store_memberships as memberships
  where memberships.id = p_membership_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '매장 소속을 찾을 수 없습니다.';
  end if;
  if v_before.version <> p_expected_version then
    raise exception using errcode = '40001', message = '다른 사용자가 먼저 매장 권한을 변경했습니다.';
  end if;

  update public.store_memberships as memberships
  set
    status = v_status,
    manage_products = (v_permissions ->> 'manage_products')::boolean,
    publish_products = (v_permissions ->> 'publish_products')::boolean,
    prepare_orders = (v_permissions ->> 'prepare_orders')::boolean,
    confirm_payments = (v_permissions ->> 'confirm_payments')::boolean,
    receive_at_center = (v_permissions ->> 'receive_at_center')::boolean,
    create_shipments = (v_permissions ->> 'create_shipments')::boolean,
    manage_staff = (v_permissions ->> 'manage_staff')::boolean,
    view_reports = (v_permissions ->> 'view_reports')::boolean,
    version = memberships.version + 1,
    updated_by = v_actor
  where memberships.id = v_before.id
  returning * into v_after;

  insert into public.store_membership_permission_audits (
    membership_id,
    business_id,
    store_id,
    user_id,
    action,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    requested_status,
    requested_permissions,
    reason,
    before_status,
    after_status,
    before_permissions,
    after_permissions,
    from_version,
    to_version
  ) values (
    v_after.id,
    v_after.business_id,
    v_after.store_id,
    v_after.user_id,
    'access_configured',
    'user',
    v_actor,
    v_actor_role,
    p_idempotency_key,
    v_status,
    v_permissions,
    v_reason,
    v_before.status,
    v_after.status,
    app_private.store_membership_permissions_json(v_before),
    app_private.store_membership_permissions_json(v_after),
    v_before.version,
    v_after.version
  );

  return query select v_after.id, v_after.version, false;
end;
$$;

revoke all on function public.set_store_membership_access(
  uuid, bigint, uuid, text, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.set_store_membership_access(
  uuid, bigint, uuid, text, jsonb, text
) to authenticated;

alter table public.store_memberships enable row level security;
alter table public.store_memberships force row level security;
alter table public.store_membership_permission_audits enable row level security;
alter table public.store_membership_permission_audits force row level security;

revoke all privileges on table
  public.store_memberships,
  public.store_membership_permission_audits
from public, anon, authenticated, service_role;

grant select on table
  public.store_memberships,
  public.store_membership_permission_audits
to authenticated;

create policy "Owners and members read store memberships"
on public.store_memberships
for select
to authenticated
using (
  (select public.is_owner())
  or user_id = (select auth.uid())
);

create policy "Owners and members read store membership audits"
on public.store_membership_permission_audits
for select
to authenticated
using (
  (select public.is_owner())
  or user_id = (select auth.uid())
);

comment on table public.store_memberships is
  'Internal NINETY-NINE VINTAGE store membership and permission boundary; never an external seller account.';
comment on function public.has_store_permission(uuid, text) is
  'Owner has implicit access; other actors require an active explicit membership flag for the active store.';
comment on function public.has_business_permission(uuid, text) is
  'Owner has implicit access; other actors require the requested flag on an active membership in the business.';
comment on function public.set_store_membership_access(uuid, bigint, uuid, text, jsonb, text) is
  'Owner-only CAS and idempotent permission configuration with append-only audit.';

commit;
