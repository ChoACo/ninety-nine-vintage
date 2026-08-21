begin;

-- Owners deliberately choose a short-lived support scope. Operators do not
-- choose a center: their single active assignment is their authorization
-- scope. Keep fulfillment-group access bounded to that assigned center.
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
  with actor as (
    select
      public.access_role_for_user(p_user_id) as role_code,
      case
        when p_user_id = auth.uid() then public.current_authorization_principal()
        else p_user_id
      end as principal_id
  )
  select p_store_id is not null
    and p_user_id is not null
    and exists (
      select 1
      from public.stores target_store
      cross join actor
      where target_store.id = p_store_id
        and target_store.is_active
        and (
          (
            actor.role_code = 'owner'
            and exists (
              select 1
              from public.operator_store_scope_preferences scope
              join public.stores selected_store
                on selected_store.id = scope.selected_store_id
               and selected_store.is_active
              where scope.user_id = p_user_id
                and scope.access_mode = 'owner_support'
                and scope.expires_at > clock_timestamp()
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
            )
          )
          or (
            actor.role_code = 'operator'
            and exists (
              select 1
              from public.store_memberships assigned
              join public.stores assigned_store
                on assigned_store.id = assigned.store_id
               and assigned_store.business_id = assigned.business_id
               and assigned_store.is_active
              where assigned.user_id = actor.principal_id
                and assigned.membership_role = 'operator'
                and assigned.status = 'active'
                and (
                  assigned.store_id = p_store_id
                  or exists (
                    select 1
                    from public.store_fulfillment_group_members assigned_member
                    join public.store_fulfillment_groups fulfillment_group
                      on fulfillment_group.id = assigned_member.group_id
                     and fulfillment_group.is_active
                    join public.store_fulfillment_group_members target_member
                      on target_member.group_id = assigned_member.group_id
                    where assigned_member.store_id = assigned.store_id
                      and target_member.store_id = p_store_id
                  )
                )
            )
          )
        )
    );
$$;

revoke all on function app_private.operator_scope_allows_store(uuid, uuid)
from public, anon, authenticated, service_role;

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
        select 1
        from public.store_memberships membership
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
          on fulfillment_group.id = target_member.group_id
         and fulfillment_group.is_active
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
          and case lower(btrim(p_permission))
            when 'prepare_orders' then actor_membership.prepare_orders
            when 'receive_at_center' then actor_membership.receive_at_center
            when 'create_shipments' then actor_membership.create_shipments
            else false
          end
      )
    );
$$;

revoke all on function app_private.has_exact_store_or_group_permission(
  uuid, uuid, text
) from public, anon, authenticated, service_role;

commit;
