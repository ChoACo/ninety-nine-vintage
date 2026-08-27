begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Standard is the normal center grade. Newer centers created after the original
-- subscription backfill must receive a valid standard subscription row too.
alter table public.store_service_subscriptions
  alter column monthly_fee set default 30000;

insert into public.store_service_subscriptions (
  store_id,
  plan_code,
  status,
  monthly_fee,
  billing_anchor_day,
  started_at,
  next_billing_at
)
select
  stores.id,
  'standard',
  'active',
  30000,
  extract(day from clock_timestamp() at time zone 'Asia/Seoul')::integer,
  clock_timestamp(),
  clock_timestamp() + interval '1 month'
from public.stores as stores
on conflict (store_id) do nothing;

-- Commission is a platform-wide fixed policy. Historical settlement entries
-- retain their original immutable snapshot; every new entry uses exactly 5%.
update public.store_enterprise_profiles
set commission_rate = 0.05,
    updated_at = clock_timestamp()
where commission_rate is distinct from 0.05;

alter table public.store_enterprise_profiles
  drop constraint if exists store_enterprise_profiles_commission_rate_check;

alter table public.store_enterprise_profiles
  add constraint store_enterprise_profiles_commission_rate_check
  check (commission_rate = 0.05);

create or replace function app_private.store_commission_rate(
  p_store_id uuid,
  p_at timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select 0.05::numeric
$$;

revoke all on function app_private.store_commission_rate(uuid, timestamptz)
from public, anon, authenticated, service_role;

-- Operators can request Pro from Seller Center. Repeated clicks are replay-safe
-- and an already-Pro center cannot create a meaningless pending request.
create or replace function public.request_store_service_plan(
  p_store_id uuid,
  p_plan_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.store_service_subscriptions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_plan_code <> 'pro'
    or not public.has_store_permission(p_store_id, 'manage_products')
  then
    raise exception using
      errcode = '42501',
      message = 'Pro 등급 신청 권한을 확인해 주세요.';
  end if;

  insert into public.store_service_subscriptions (
    store_id,
    plan_code,
    requested_plan_code,
    status,
    monthly_fee,
    billing_anchor_day,
    started_at,
    next_billing_at,
    updated_at
  ) values (
    p_store_id,
    'standard',
    null,
    'active',
    30000,
    extract(day from v_now at time zone 'Asia/Seoul')::integer,
    v_now,
    v_now + interval '1 month',
    v_now
  )
  on conflict (store_id) do nothing;

  select subscriptions.*
  into v_row
  from public.store_service_subscriptions as subscriptions
  where subscriptions.store_id = p_store_id
  for update;

  if v_row.plan_code = 'pro' and v_row.status = 'active' then
    raise exception using
      errcode = '22023',
      message = '이미 Pro 등급이 적용된 센터입니다.';
  end if;

  if v_row.requested_plan_code = 'pro'
    and v_row.status = 'pending_approval'
  then
    return jsonb_build_object(
      'storeId', v_row.store_id,
      'requestedPlanCode', v_row.requested_plan_code,
      'status', v_row.status,
      'version', v_row.version,
      'idempotentReplay', true
    );
  end if;

  update public.store_service_subscriptions as subscriptions
  set requested_plan_code = 'pro',
      status = 'pending_approval',
      version = subscriptions.version + 1,
      updated_at = v_now
  where subscriptions.store_id = p_store_id
  returning subscriptions.* into v_row;

  return jsonb_build_object(
    'storeId', v_row.store_id,
    'requestedPlanCode', v_row.requested_plan_code,
    'status', v_row.status,
    'version', v_row.version,
    'idempotentReplay', false
  );
end;
$$;

revoke all on function public.request_store_service_plan(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.request_store_service_plan(uuid, text)
to authenticated;

alter table public.owner_store_management_events
  drop constraint if exists owner_store_management_events_action_check;

alter table public.owner_store_management_events
  add constraint owner_store_management_events_action_check
  check (
    action in (
      'create', 'update', 'archive', 'restore',
      'employee_assign', 'employee_remove',
      'operator_assign', 'operator_remove',
      'banner_update', 'plan_change'
    )
  );

create or replace function public.set_owner_store_service_plan(
  p_store_id uuid,
  p_plan_code text,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_grade_zero_owner();
  v_before public.store_service_subscriptions%rowtype;
  v_after public.store_service_subscriptions%rowtype;
  v_existing_action text;
  v_existing_request jsonb;
  v_request jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_plan_code not in ('standard', 'pro')
    or p_expected_version is null
    or p_idempotency_key is null
  then
    raise exception using
      errcode = '22023',
      message = '센터 등급 변경 정보를 확인해 주세요.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using
      errcode = '22023',
      message = '센터 등급 변경 사유를 확인해 주세요.';
  end if;
  if not exists (
    select 1 from public.stores as stores where stores.id = p_store_id
  ) then
    raise exception using errcode = 'P0002', message = '센터를 찾을 수 없습니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0)
  );

  v_request := jsonb_build_object(
    'action', 'plan_change',
    'storeId', p_store_id,
    'planCode', p_plan_code,
    'expectedVersion', p_expected_version
  );

  select events.action, events.request_snapshot, events.result
  into v_existing_action, v_existing_request, v_result
  from public.owner_store_management_events as events
  where events.actor_user_id = v_actor
    and events.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_action <> 'plan_change' or v_existing_request <> v_request then
      raise exception using
        errcode = '55000',
        message = '같은 중복 처리 방지 키로 다른 요청을 처리할 수 없습니다.';
    end if;
    return v_result;
  end if;

  select subscriptions.*
  into v_before
  from public.store_service_subscriptions as subscriptions
  where subscriptions.store_id = p_store_id
  for update;

  if not found or v_before.version is distinct from p_expected_version then
    raise exception using
      errcode = '40001',
      message = '센터 등급 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;

  if v_before.plan_code = p_plan_code
    and v_before.status = 'active'
    and v_before.requested_plan_code is null
  then
    v_result := jsonb_build_object(
      'storeId', v_before.store_id,
      'planCode', v_before.plan_code,
      'status', v_before.status,
      'version', v_before.version,
      'changed', false
    );
  else
    v_result := public.approve_owner_store_service_plan(
      p_store_id,
      p_plan_code,
      v_now,
      p_expected_version
    ) || jsonb_build_object('changed', true);
  end if;

  select subscriptions.*
  into v_after
  from public.store_service_subscriptions as subscriptions
  where subscriptions.store_id = p_store_id;

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
    'plan_change',
    p_store_id,
    btrim(p_reason),
    v_request,
    to_jsonb(v_before),
    to_jsonb(v_after),
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.set_owner_store_service_plan(
  uuid, text, bigint, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.set_owner_store_service_plan(
  uuid, text, bigint, uuid, text
) to authenticated;

commit;
