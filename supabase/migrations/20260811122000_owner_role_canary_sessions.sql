begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

create table public.owner_role_canary_sessions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  target_role text not null check (target_role in ('operator', 'employee')),
  activated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  updated_at timestamptz not null default clock_timestamp(),
  constraint owner_role_canary_fixed_owner_check
    check (owner_id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid),
  constraint owner_role_canary_distinct_target_check
    check (owner_id <> target_user_id),
  constraint owner_role_canary_expiry_check
    check (expires_at > activated_at and expires_at <= activated_at + interval '3 minutes')
);

create table public.owner_role_canary_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  target_role text not null check (target_role in ('operator', 'employee')),
  action text not null check (action in ('started', 'ended')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);

alter table public.owner_role_canary_sessions enable row level security;
alter table public.owner_role_canary_sessions force row level security;
alter table public.owner_role_canary_audit enable row level security;
alter table public.owner_role_canary_audit force row level security;

revoke all on public.owner_role_canary_sessions from public, anon, authenticated;
revoke all on public.owner_role_canary_audit from public, anon, authenticated;
grant select, insert, update on public.owner_role_canary_sessions to service_role;
grant select, insert on public.owner_role_canary_audit to service_role;

create or replace function app_private.reject_owner_role_canary_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = '역할 카나리 감사 기록은 변경할 수 없습니다.';
end;
$$;

create trigger owner_role_canary_audit_append_only
before update or delete on public.owner_role_canary_audit
for each row execute function app_private.reject_owner_role_canary_audit_mutation();

create or replace function public.owner_role_canary_principal(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sessions.target_user_id
  from public.owner_role_canary_sessions sessions
  join public.account_access_roles owner_role
    on owner_role.user_id = sessions.owner_id
   and owner_role.role_code = 'owner'
   and owner_role.grade_level = 0
  join public.account_access_roles target_role
    on target_role.user_id = sessions.target_user_id
   and target_role.role_code = sessions.target_role
  join public.profiles target_profile
    on target_profile.id = sessions.target_user_id
   and target_profile.deleted_at is null
  where sessions.owner_id = p_user_id
    and sessions.ended_at is null
    and sessions.expires_at > clock_timestamp()
    and public.auth_user_has_kakao_identity(sessions.target_user_id)
  limit 1;
$$;

create or replace function public.current_authorization_principal()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.owner_role_canary_principal(auth.uid()), auth.uid());
$$;

create or replace function public.begin_owner_role_canary(
  p_owner_id uuid,
  p_target_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role text;
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz := v_now + interval '3 minutes';
begin
  if p_owner_id <> '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
    or p_target_user_id is null
    or p_target_user_id = p_owner_id
    or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500
  then
    raise exception using errcode = '22023', message = '역할 카나리 요청이 올바르지 않습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_owner_id::text));

  if not exists (
    select 1 from public.account_access_roles roles
    join public.profiles profiles on profiles.id = roles.user_id and profiles.deleted_at is null
    where roles.user_id = p_owner_id and roles.role_code = 'owner' and roles.grade_level = 0
  ) then
    raise exception using errcode = '42501', message = '고정 소유자 계정만 역할 카나리를 시작할 수 있습니다.';
  end if;

  select roles.role_code into v_target_role
  from public.account_access_roles roles
  join public.profiles profiles on profiles.id = roles.user_id and profiles.deleted_at is null
  where roles.user_id = p_target_user_id
    and roles.role_code in ('operator', 'employee')
    and public.auth_user_has_kakao_identity(roles.user_id);

  if v_target_role is null then
    raise exception using errcode = '42501', message = '활성 운영자 또는 직원 계정만 카나리 대상으로 사용할 수 있습니다.';
  end if;

  update public.owner_member_mode_sessions
  set ended_at = v_now, updated_at = v_now
  where owner_id = p_owner_id and ended_at is null;

  insert into public.owner_role_canary_sessions (
    owner_id, target_user_id, target_role, activated_at, expires_at, ended_at, reason, updated_at
  ) values (
    p_owner_id, p_target_user_id, v_target_role, v_now, v_expires_at, null, btrim(p_reason), v_now
  )
  on conflict (owner_id) do update set
    target_user_id = excluded.target_user_id,
    target_role = excluded.target_role,
    activated_at = excluded.activated_at,
    expires_at = excluded.expires_at,
    ended_at = null,
    reason = excluded.reason,
    updated_at = excluded.updated_at;

  insert into public.owner_role_canary_audit (
    owner_id, target_user_id, target_role, action, reason, metadata
  ) values (
    p_owner_id, p_target_user_id, v_target_role, 'started', btrim(p_reason),
    jsonb_build_object('expiresAt', v_expires_at)
  );

  return jsonb_build_object(
    'active', true, 'targetUserId', p_target_user_id, 'roleCode', v_target_role,
    'expiresAt', v_expires_at, 'serverNow', v_now
  );
end;
$$;

create or replace function public.end_owner_role_canary(
  p_owner_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.owner_role_canary_sessions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_owner_id <> '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
    or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500
  then
    raise exception using errcode = '22023', message = '역할 카나리 종료 요청이 올바르지 않습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_owner_id::text));
  select * into v_session from public.owner_role_canary_sessions where owner_id = p_owner_id for update;

  if found and v_session.ended_at is null then
    update public.owner_role_canary_sessions
    set ended_at = v_now, updated_at = v_now
    where owner_id = p_owner_id;
    insert into public.owner_role_canary_audit (
      owner_id, target_user_id, target_role, action, reason,
      metadata
    ) values (
      p_owner_id, v_session.target_user_id, v_session.target_role, 'ended', btrim(p_reason),
      jsonb_build_object('expiredBeforeEnd', v_session.expires_at <= v_now)
    );
  end if;

  return jsonb_build_object('active', false, 'serverNow', v_now);
end;
$$;

revoke all on function public.owner_role_canary_principal(uuid) from public, anon, authenticated, service_role;
revoke all on function public.current_authorization_principal() from public, anon, authenticated, service_role;
revoke all on function public.begin_owner_role_canary(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.end_owner_role_canary(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.owner_role_canary_principal(uuid) to service_role;
grant execute on function public.current_authorization_principal() to service_role;
grant execute on function public.begin_owner_role_canary(uuid, uuid, text) to service_role;
grant execute on function public.end_owner_role_canary(uuid, text) to service_role;

create or replace function public.access_role_for_user(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when profiles.deleted_at is not null then null
    when canary.target_role is not null then canary.target_role
    when public.owner_member_mode_is_active(p_user_id) then 'member'
    when roles.role_code = 'owner' and exists (
      select 1 from auth.users users where users.id = roles.user_id
    ) then 'owner'
    when roles.role_code = 'member' and public.is_owner_hidden_test_member(roles.user_id) then 'member'
    when roles.role_code <> 'owner' and public.auth_user_has_kakao_identity(roles.user_id) then roles.role_code
    else null
  end
  from public.account_access_roles roles
  join public.profiles profiles on profiles.id = roles.user_id
  left join lateral (
    select target_roles.role_code as target_role
    from public.owner_role_canary_sessions sessions
    join public.account_access_roles target_roles
      on target_roles.user_id = sessions.target_user_id
     and target_roles.role_code = sessions.target_role
    join public.profiles target_profiles
      on target_profiles.id = sessions.target_user_id
     and target_profiles.deleted_at is null
    where sessions.owner_id = p_user_id
      and sessions.ended_at is null
      and sessions.expires_at > clock_timestamp()
      and public.auth_user_has_kakao_identity(sessions.target_user_id)
    limit 1
  ) canary on true
  where roles.user_id = p_user_id;
$$;

revoke all on function public.access_role_for_user(uuid) from public, anon;
grant execute on function public.access_role_for_user(uuid) to authenticated, service_role;

create or replace function public.has_store_permission(p_store_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_permission, ''))) in ('prepare_orders', 'receive_at_center', 'create_shipments')
      then app_private.has_exact_store_or_group_permission(
        p_store_id, auth.uid(), p_permission
      )
    else coalesce(exists (
      select 1
      from public.stores store
      join public.businesses business on business.id = store.business_id and business.status = 'active'
      where store.id = p_store_id and store.is_active and (
        public.is_owner()
        or exists (
          select 1 from public.store_memberships membership
          where membership.store_id = store.id
            and membership.business_id = store.business_id
            and membership.user_id = public.current_authorization_principal()
            and membership.status = 'active'
            and case lower(btrim(coalesce(p_permission, '')))
              when 'manage_products' then membership.manage_products
              when 'publish_products' then membership.publish_products
              when 'confirm_payments' then false
              when 'manage_staff' then membership.manage_staff
              when 'view_reports' then membership.view_reports
              else false
            end
        )
      )
    ), false)
  end;
$$;

create or replace function public.has_business_permission(p_business_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_permission, ''))) in (
      'prepare_orders', 'receive_at_center', 'create_shipments', 'confirm_payments'
    ) then false
    else coalesce(exists (
      select 1 from public.businesses business
      where business.id = p_business_id and business.status = 'active' and (
        public.is_owner()
        or exists (
          select 1
          from public.store_memberships membership
          join public.stores store
            on store.id = membership.store_id
           and store.business_id = membership.business_id
           and store.is_active
          where membership.business_id = business.id
            and membership.user_id = public.current_authorization_principal()
            and membership.status = 'active'
            and case lower(btrim(coalesce(p_permission, '')))
              when 'manage_products' then membership.manage_products
              when 'publish_products' then membership.publish_products
              when 'manage_staff' then membership.manage_staff
              when 'view_reports' then membership.view_reports
              else false
            end
        )
      )
    ), false)
  end;
$$;

revoke all on function public.has_store_permission(uuid, text) from public, anon;
grant execute on function public.has_store_permission(uuid, text) to authenticated;
revoke all on function public.has_business_permission(uuid, text) from public, anon;
grant execute on function public.has_business_permission(uuid, text) to authenticated;

create or replace function public.get_operator_store_scope()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_principal_id uuid;
  v_role text;
  v_row public.operator_store_scope_preferences%rowtype;
  v_active boolean := false;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = '로그인이 필요합니다.'; end if;
  v_principal_id := public.current_authorization_principal();
  v_role := public.access_role_for_user(v_user_id);
  if v_role not in ('operator', 'owner') then raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.'; end if;

  select * into v_row from public.operator_store_scope_preferences where user_id = v_user_id;
  if not found then
    return jsonb_build_object('active', false, 'accessMode', case when v_role = 'owner' then 'owner_support' else 'assigned' end, 'storeId', null, 'expiresAt', null);
  end if;
  if v_role = 'owner' and v_row.access_mode <> 'owner_support' then
    return jsonb_build_object('active', false, 'accessMode', 'owner_support', 'storeId', null, 'expiresAt', null);
  elsif v_role = 'operator' and v_row.access_mode <> 'assigned' then
    return jsonb_build_object('active', false, 'accessMode', 'assigned', 'storeId', null, 'expiresAt', null);
  end if;
  if v_row.expires_at > clock_timestamp() and exists (select 1 from public.stores where id = v_row.selected_store_id and is_active) then
    v_active := (v_role = 'owner' and v_row.access_mode = 'owner_support') or
      (v_role = 'operator' and v_row.access_mode = 'assigned' and exists (
        select 1 from public.store_memberships membership
        where membership.user_id = v_principal_id and membership.store_id = v_row.selected_store_id
          and membership.membership_role = 'operator' and membership.status = 'active'
      ));
  end if;
  return jsonb_build_object('active', v_active, 'accessMode', v_row.access_mode, 'storeId', v_row.selected_store_id, 'expiresAt', v_row.expires_at);
end;
$$;

create or replace function public.set_active_operator_store_scope(p_store_id uuid, p_access_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_principal_id uuid;
  v_role text;
  v_expires_at timestamptz := clock_timestamp() + interval '30 minutes';
begin
  if v_user_id is null or p_store_id is null then raise exception using errcode = '22023', message = '센터를 선택해 주세요.'; end if;
  v_principal_id := public.current_authorization_principal();
  v_role := public.access_role_for_user(v_user_id);
  if v_role = 'owner' then
    if p_access_mode <> 'owner_support' then raise exception using errcode = '42501', message = '소유자 지원 접근을 선택해 주세요.'; end if;
    if not exists (select 1 from public.stores where id = p_store_id and is_active) then raise exception using errcode = 'P0002', message = '활성 센터를 찾을 수 없습니다.'; end if;
  elsif v_role = 'operator' then
    if p_access_mode <> 'assigned' or not exists (
      select 1 from public.store_memberships membership join public.stores store on store.id = membership.store_id and store.is_active
      where membership.user_id = v_principal_id and membership.store_id = p_store_id
        and membership.membership_role = 'operator' and membership.status = 'active'
    ) then raise exception using errcode = '42501', message = '배정된 센터만 선택할 수 있습니다.'; end if;
  else
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  insert into public.operator_store_scope_preferences(user_id, selected_store_id, access_mode, expires_at)
  values (v_user_id, p_store_id, p_access_mode, v_expires_at)
  on conflict (user_id) do update set selected_store_id = excluded.selected_store_id,
    access_mode = excluded.access_mode, expires_at = excluded.expires_at, updated_at = clock_timestamp();
  return jsonb_build_object('active', true, 'accessMode', p_access_mode, 'storeId', p_store_id, 'expiresAt', v_expires_at);
end;
$$;

create or replace function app_private.operator_scope_allows_store(p_store_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.operator_store_scope_preferences scope
    join public.stores selected_store on selected_store.id = scope.selected_store_id and selected_store.is_active
    join public.stores target_store on target_store.id = p_store_id and target_store.is_active
    cross join lateral (select case when p_user_id = auth.uid() then public.current_authorization_principal() else p_user_id end as id) principal
    where scope.user_id = p_user_id and scope.expires_at > clock_timestamp() and (
      (public.access_role_for_user(p_user_id) = 'owner' and scope.access_mode = 'owner_support') or
      (public.access_role_for_user(p_user_id) = 'operator' and scope.access_mode = 'assigned' and exists (
        select 1 from public.store_memberships membership
        where membership.user_id = principal.id and membership.store_id = scope.selected_store_id
          and membership.membership_role = 'operator' and membership.status = 'active'
      ))
    ) and (
      scope.selected_store_id = p_store_id or exists (
        select 1 from public.store_fulfillment_group_members selected_member
        join public.store_fulfillment_groups fulfillment_group on fulfillment_group.id = selected_member.group_id and fulfillment_group.is_active
        join public.store_fulfillment_group_members target_member on target_member.group_id = selected_member.group_id
        where selected_member.store_id = scope.selected_store_id and target_member.store_id = p_store_id
      )
    )
  );
$$;

create or replace function app_private.has_exact_store_or_group_permission(
  p_store_id uuid,
  p_user_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_store_id is not null
    and p_user_id is not null
    and lower(btrim(coalesce(p_permission, ''))) in (
      'prepare_orders', 'receive_at_center', 'create_shipments'
    )
    and app_private.operator_scope_allows_store(p_store_id, p_user_id)
    and (
      public.access_role_for_user(p_user_id) = 'owner'
      or exists (
        select 1 from public.store_memberships membership
        where membership.store_id = p_store_id
          and membership.user_id = case
            when p_user_id = auth.uid() then public.current_authorization_principal()
            else p_user_id
          end
          and membership.status = 'active'
          and case lower(btrim(p_permission))
            when 'prepare_orders' then membership.prepare_orders
            when 'receive_at_center' then membership.receive_at_center
            when 'create_shipments' then membership.create_shipments
            else false
          end
      )
      or exists (
        select 1
        from public.store_fulfillment_group_members target_member
        join public.store_fulfillment_groups fulfillment_group
          on fulfillment_group.id = target_member.group_id and fulfillment_group.is_active
        join public.store_fulfillment_group_members actor_member
          on actor_member.group_id = target_member.group_id
        join public.store_memberships actor_membership
          on actor_membership.store_id = actor_member.store_id
         and actor_membership.user_id = case
           when p_user_id = auth.uid() then public.current_authorization_principal()
           else p_user_id
         end
         and actor_membership.status = 'active'
        where target_member.store_id = p_store_id
          and actor_member.store_id = public.require_active_operator_store_scope()
          and case lower(btrim(p_permission))
            when 'prepare_orders' then actor_membership.prepare_orders
            when 'receive_at_center' then actor_membership.receive_at_center
            when 'create_shipments' then actor_membership.create_shipments
            else false
          end
      )
    );
$$;

revoke all on function public.get_operator_store_scope() from public, anon, service_role;
grant execute on function public.get_operator_store_scope() to authenticated;
revoke all on function public.set_active_operator_store_scope(uuid, text) from public, anon, service_role;
grant execute on function public.set_active_operator_store_scope(uuid, text) to authenticated;
revoke all on function app_private.operator_scope_allows_store(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.has_exact_store_or_group_permission(uuid, uuid, text) from public, anon, authenticated, service_role;

comment on table public.owner_role_canary_sessions is
  'Service-only three-minute lease that evaluates the fixed Owner session through an existing operator or employee authorization principal without changing either stored role.';
comment on table public.owner_role_canary_audit is
  'Append-only evidence for every Owner role-canary start and explicit end.';

commit;
