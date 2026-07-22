-- Center addresses are not collected or printed as sender information.  The
-- legacy columns remain only to preserve historic migrations and audit rows;
-- this migration clears them, removes every active-status dependency, and
-- revokes the old address-writing RPC.
alter table public.fulfillment_centers
  drop constraint if exists fulfillment_centers_configuration_required_check,
  drop constraint if exists fulfillment_centers_address_line2_check,
  drop constraint if exists fulfillment_centers_active_details_check;

update public.fulfillment_centers
set
  postal_code = null,
  address_line1 = null,
  address_line2 = null,
  contact_name = null,
  contact_phone = null,
  status = case when status = 'configuration_required' then 'active' else status end,
  version = version + 1,
  updated_at = clock_timestamp();

revoke all on function public.configure_fulfillment_center(
  uuid, bigint, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;

comment on function public.configure_fulfillment_center(
  uuid, bigint, text, text, text, text, text, uuid
) is 'Retired: fulfillment-center sender addresses are not collected.';

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
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'Owner 권한이 필요합니다.';
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
  left join public.account_last_seen as last_seen on last_seen.user_id = roles.user_id
  where roles.role_code in ('operator', 'employee')
    and public.auth_user_has_kakao_identity(roles.user_id)
  order by
    case roles.role_code when 'operator' then 0 else 1 end,
    profiles.display_name,
    profiles.id;
end;
$$;

revoke all on function public.get_owner_fulfillment_staff_directory() from public, anon, authenticated, service_role;
grant execute on function public.get_owner_fulfillment_staff_directory() to authenticated;

create or replace function public.get_owner_inventory_fulfillment_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'Owner 권한이 필요합니다.';
  end if;

  select jsonb_build_object(
    'stores', coalesce((select jsonb_agg(to_jsonb(q) order by q.name, q.id) from (
      select id, business_id, name, slug, description, is_active, updated_at from public.stores
    ) q), '[]'::jsonb),
    'centers', coalesce((select jsonb_agg(to_jsonb(q) order by q.name, q.id) from (
      select id, business_id, code, name, status, is_default, version, updated_at
      from public.fulfillment_centers
    ) q), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at desc, q.id) from (
      select id, business_id, store_id, fulfillment_center_id, route_mode, status, version, updated_at
      from public.store_fulfillment_routes
    ) q), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at desc, q.id) from (
      select id, business_id, fulfillment_center_id, user_id, status, receive_at_center, create_shipments, version, updated_at
      from public.fulfillment_center_staff_assignments
    ) q), '[]'::jsonb),
    'rollouts', coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at desc, q.business_id) from (
      select business_id, entitlement_projection_enabled, unified_inventory_reads_enabled, item_selected_shipments_enabled, shipping_fee_amount, version, updated_at
      from public.inventory_fulfillment_rollout_settings
    ) q), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_owner_inventory_fulfillment_configuration() from public, anon, authenticated, service_role;
grant execute on function public.get_owner_inventory_fulfillment_configuration() to authenticated;
