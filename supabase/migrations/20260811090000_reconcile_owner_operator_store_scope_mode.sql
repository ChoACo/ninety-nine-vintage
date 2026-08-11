begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- A scope preference may have been created before owner_support existed, or
-- while the same account was still an operator. Expire that legacy selection
-- and let the owner explicitly choose a support store again.
update public.operator_store_scope_preferences as scope
set access_mode = 'owner_support',
    expires_at = clock_timestamp(),
    updated_at = clock_timestamp()
from public.account_access_roles as role
where role.user_id = scope.user_id
  and role.role_code = 'owner'
  and scope.access_mode <> 'owner_support';

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

  -- A role can change without deleting the persisted preference. Never return
  -- the previous role's mode to the client, otherwise the selector can only
  -- submit a mode that the set RPC must reject.
  if v_role = 'owner' and v_row.access_mode <> 'owner_support' then
    return jsonb_build_object(
      'active', false,
      'accessMode', 'owner_support',
      'storeId', null,
      'expiresAt', null
    );
  elsif v_role = 'operator' and v_row.access_mode <> 'assigned' then
    return jsonb_build_object(
      'active', false,
      'accessMode', 'assigned',
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

revoke all on function public.get_operator_store_scope()
  from public, anon;
grant execute on function public.get_operator_store_scope() to authenticated;

commit;
