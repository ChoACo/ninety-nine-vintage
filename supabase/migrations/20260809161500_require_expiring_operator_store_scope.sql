begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- An operator workspace is always one store. A persisted "all stores" filter
-- was a presentation preference, not an authorization boundary, so retire it.
delete from public.operator_store_scope_preferences
where selected_store_id is null;

alter table public.operator_store_scope_preferences
  alter column selected_store_id set not null,
  add column access_mode text not null default 'assigned'
    check (access_mode in ('assigned', 'owner_support')),
  add column expires_at timestamptz not null
    default (clock_timestamp() + interval '30 minutes');

comment on table public.operator_store_scope_preferences is
  'One short-lived selected store for the operator workspace; never an all-store authorization.';
comment on column public.operator_store_scope_preferences.access_mode is
  'assigned for an operator membership, owner_support for an explicit Owner support session.';
comment on column public.operator_store_scope_preferences.expires_at is
  'Server-enforced expiry for the selected operator workspace store.';

create or replace function public.get_operator_store_scope()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_row public.operator_store_scope_preferences%rowtype;
  v_store public.stores%rowtype;
  v_active boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  v_role := public.access_role_for_user(v_user_id);
  if v_role not in ('operator', 'owner') then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;

  select * into v_row
  from public.operator_store_scope_preferences
  where user_id = v_user_id;
  if not found then
    return jsonb_build_object(
      'active', false,
      'accessMode', case when v_role = 'owner' then 'owner_support' else 'assigned' end,
      'storeId', null,
      'expiresAt', null
    );
  end if;

  select * into v_store from public.stores
  where id = v_row.selected_store_id and is_active;
  if found and v_row.expires_at > clock_timestamp() then
    v_active := (v_role = 'owner' and v_row.access_mode = 'owner_support')
      or (v_role = 'operator' and v_row.access_mode = 'assigned' and exists (
        select 1 from public.store_memberships membership
        where membership.user_id = v_user_id
          and membership.store_id = v_row.selected_store_id
          and membership.membership_role = 'operator'
          and membership.status = 'active'
      ));
  end if;

  return jsonb_build_object(
    'active', v_active,
    'accessMode', v_row.access_mode,
    'storeId', v_row.selected_store_id,
    'expiresAt', v_row.expires_at
  );
end;
$$;

create or replace function public.set_active_operator_store_scope(
  p_store_id uuid,
  p_access_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_expires_at timestamptz := clock_timestamp() + interval '30 minutes';
begin
  if v_user_id is null or p_store_id is null then
    raise exception using errcode = '22023', message = '센터를 선택해 주세요.';
  end if;
  v_role := public.access_role_for_user(v_user_id);
  if v_role = 'owner' then
    if p_access_mode <> 'owner_support' then
      raise exception using errcode = '42501', message = '소유자 지원 접근을 선택해 주세요.';
    end if;
    if not exists (select 1 from public.stores where id = p_store_id and is_active) then
      raise exception using errcode = 'P0002', message = '활성 센터를 찾을 수 없습니다.';
    end if;
  elsif v_role = 'operator' then
    if p_access_mode <> 'assigned' or not exists (
      select 1 from public.store_memberships membership
      join public.stores store on store.id = membership.store_id and store.is_active
      where membership.user_id = v_user_id
        and membership.store_id = p_store_id
        and membership.membership_role = 'operator'
        and membership.status = 'active'
    ) then
      raise exception using errcode = '42501', message = '배정된 센터만 선택할 수 있습니다.';
    end if;
  else
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;

  insert into public.operator_store_scope_preferences(
    user_id, selected_store_id, access_mode, expires_at
  ) values (
    v_user_id, p_store_id, p_access_mode, v_expires_at
  )
  on conflict (user_id) do update set
    selected_store_id = excluded.selected_store_id,
    access_mode = excluded.access_mode,
    expires_at = excluded.expires_at,
    updated_at = clock_timestamp();

  return jsonb_build_object(
    'active', true,
    'accessMode', p_access_mode,
    'storeId', p_store_id,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function public.require_active_operator_store_scope()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope jsonb := public.get_operator_store_scope();
begin
  if coalesce((v_scope ->> 'active')::boolean, false) is not true
    or nullif(v_scope ->> 'storeId', '') is null
  then
    raise exception using errcode = '42501', message = '센터를 다시 선택해 주세요.';
  end if;
  return (v_scope ->> 'storeId')::uuid;
end;
$$;

create or replace function app_private.operator_scope_allows_store(
  p_store_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.operator_store_scope_preferences scope
    join public.stores selected_store
      on selected_store.id = scope.selected_store_id
     and selected_store.is_active
    join public.stores target_store
      on target_store.id = p_store_id
     and target_store.is_active
    where scope.user_id = p_user_id
      and scope.expires_at > clock_timestamp()
      and (
        (public.access_role_for_user(p_user_id) = 'owner'
          and scope.access_mode = 'owner_support')
        or
        (public.access_role_for_user(p_user_id) = 'operator'
          and scope.access_mode = 'assigned'
          and exists (
            select 1 from public.store_memberships membership
            where membership.user_id = p_user_id
              and membership.store_id = scope.selected_store_id
              and membership.membership_role = 'operator'
              and membership.status = 'active'
          ))
      )
      and (
        scope.selected_store_id = p_store_id
        or exists (
          select 1
          from public.store_fulfillment_group_members selected_member
          join public.store_fulfillment_groups fulfillment_group
            on fulfillment_group.id = selected_member.group_id
           and fulfillment_group.is_active
          join public.store_fulfillment_group_members target_member
            on target_member.group_id = selected_member.group_id
          where selected_member.store_id = scope.selected_store_id
            and target_member.store_id = p_store_id
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
      (public.access_role_for_user(p_user_id) = 'owner')
      or exists (
        select 1
        from public.store_memberships membership
        where membership.store_id = p_store_id
          and membership.user_id = p_user_id
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
          on fulfillment_group.id = target_member.group_id
         and fulfillment_group.is_active
        join public.store_fulfillment_group_members actor_member
          on actor_member.group_id = target_member.group_id
        join public.store_memberships actor_membership
          on actor_membership.store_id = actor_member.store_id
         and actor_membership.user_id = p_user_id
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

revoke all on function public.set_operator_store_scope(text, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.set_active_operator_store_scope(uuid, text)
from public, anon, service_role;
revoke all on function public.require_active_operator_store_scope()
from public, anon, service_role;
revoke all on function app_private.operator_scope_allows_store(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.has_exact_store_or_group_permission(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.set_active_operator_store_scope(uuid, text) to authenticated;
grant execute on function public.require_active_operator_store_scope() to authenticated;

commit;
