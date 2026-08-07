begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Stage 0/1 of the multi-operator transition.
-- stores.operator_id remains the representative operator for compatibility.
-- store_memberships is the authoritative assignment for operator access.

-- Do not silently choose a winner if legacy data already violates the new
-- one-operator-to-one-store rule. The migration must stop and expose it.
do $$
begin
  if exists (
    select 1
    from public.store_memberships as memberships
    where memberships.membership_role = 'operator'
      and memberships.status = 'active'
    group by memberships.user_id
    having count(distinct memberships.store_id) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = '한 운영자가 여러 센터에 활성 배정된 기존 데이터가 있어 다중 운영자 전환을 중단했습니다.';
  end if;

  if exists (
    select stores.operator_id
    from public.stores as stores
    join public.account_access_roles as roles
      on roles.user_id = stores.operator_id
    where roles.role_code = 'operator'
       or (roles.role_code = 'owner' and coalesce(roles.grade_level, 99) = 0)
    group by stores.operator_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = '한 운영자가 여러 대표 센터에 지정된 기존 데이터가 있어 다중 운영자 전환을 중단했습니다.';
  end if;

  if exists (
    select 1
    from public.stores as stores
    join public.account_access_roles as roles
      on roles.user_id = stores.operator_id
    join public.store_memberships as memberships
      on memberships.store_id = stores.id
     and memberships.user_id = stores.operator_id
    where (
      roles.role_code = 'operator'
      or (roles.role_code = 'owner' and coalesce(roles.grade_level, 99) = 0)
    )
      and memberships.membership_role <> 'operator'
  ) then
    raise exception using
      errcode = '23514',
      message = '대표 운영자와 같은 센터에 다른 멤버십 역할이 있어 운영자 멤버십 전환을 중단했습니다.';
  end if;
end;
$$;

-- One active operator membership per user enforces operator -> one store.
-- There is intentionally no store-side uniqueness constraint: one store may
-- have multiple active operator memberships.
create unique index if not exists store_memberships_one_active_operator_per_user_idx
  on public.store_memberships (user_id)
  where membership_role = 'operator' and status = 'active';

create index if not exists store_memberships_active_operator_store_idx
  on public.store_memberships (store_id, user_id)
  where membership_role = 'operator' and status = 'active';

-- Preserve every existing representative assignment as an explicit operator
-- membership. Grade-zero owners are included so legacy Owner-assigned stores
-- can use the same operator-center scope in a later application stage.
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
from public.stores as stores
join public.account_access_roles as roles
  on roles.user_id = stores.operator_id
where roles.role_code = 'operator'
   or (roles.role_code = 'owner' and coalesce(roles.grade_level, 99) = 0)
on conflict (store_id, user_id) do nothing;

-- Replace the legacy one-to-one validation with:
--   * operator/grade-zero owner role validation;
--   * operator uniqueness enforced by the partial unique index above;
--   * employee reporting to any active operator of the same store.
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
    if new.membership_role = 'operator' and not (
      v_role.role_code = 'operator'
      or (v_role.role_code = 'owner' and coalesce(v_role.grade_level, 99) = 0)
    ) then
      raise exception using
        errcode = '23514',
        message = '활성 운영자 소속은 운영자 또는 최고 등급 소유자만 가질 수 있습니다.';
    elsif new.membership_role = 'employee' and (
      v_role.role_code is distinct from 'employee'
      or public.access_role_for_user(new.user_id) is distinct from 'employee'
      or not exists (
        select 1
        from public.store_memberships as operator_memberships
        join public.account_access_roles as operator_roles
          on operator_roles.user_id = operator_memberships.user_id
        where operator_memberships.store_id = new.store_id
          and operator_memberships.user_id = v_role.reports_to_operator_id
          and operator_memberships.membership_role = 'operator'
          and operator_memberships.status = 'active'
          and (
            operator_roles.role_code = 'operator'
            or (operator_roles.role_code = 'owner'
              and coalesce(operator_roles.grade_level, 99) = 0)
          )
      )
    ) then
      raise exception using
        errcode = '23514',
        message = '활성 직원 소속은 같은 센터의 운영자에게 보고해야 합니다.';
    end if;
  end if;

  -- The representative column remains a compatibility invariant. A
  -- representative operator must be changed before its membership is removed.
  if new.membership_role = 'operator'
    and v_store.operator_id = new.user_id
    and new.status <> 'active'
  then
    raise exception using
      errcode = '23514',
      message = '대표 운영자를 먼저 변경한 뒤 운영자 소속을 해제해 주세요.';
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

commit;
