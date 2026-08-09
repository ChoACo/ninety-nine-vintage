begin;

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
    and (
      exists (
        select 1
        from public.store_memberships membership
        join public.stores store
          on store.id = membership.store_id
         and store.business_id = membership.business_id
         and store.is_active
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
          and case lower(btrim(p_permission))
            when 'prepare_orders' then actor_membership.prepare_orders
            when 'receive_at_center' then actor_membership.receive_at_center
            when 'create_shipments' then actor_membership.create_shipments
            else false
          end
      )
    );
$$;

revoke all on function app_private.has_exact_store_or_group_permission(uuid, uuid, text)
from public, anon, authenticated, service_role;

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
  select case
    when lower(btrim(coalesce(p_permission, ''))) in (
      'prepare_orders', 'receive_at_center', 'create_shipments'
    ) then app_private.has_exact_store_or_group_permission(
      p_store_id, auth.uid(), p_permission
    )
    else coalesce(exists (
      select 1
      from public.stores store
      join public.businesses business
        on business.id = store.business_id
       and business.status = 'active'
      where store.id = p_store_id
        and store.is_active
        and (
          public.is_owner()
          or exists (
            select 1
            from public.store_memberships membership
            where membership.store_id = store.id
              and membership.business_id = store.business_id
              and membership.user_id = auth.uid()
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

revoke all on function public.has_store_permission(uuid, text) from public, anon;
grant execute on function public.has_store_permission(uuid, text) to authenticated;

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
  select case
    when lower(btrim(coalesce(p_permission, ''))) in (
      'prepare_orders', 'receive_at_center', 'create_shipments', 'confirm_payments'
    ) then false
    else coalesce(exists (
      select 1
      from public.businesses business
      where business.id = p_business_id
        and business.status = 'active'
        and (
          public.is_owner()
          or exists (
            select 1
            from public.store_memberships membership
            join public.stores store
              on store.id = membership.store_id
             and store.business_id = membership.business_id
             and store.is_active
            where membership.business_id = business.id
              and membership.user_id = auth.uid()
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

revoke all on function public.has_business_permission(uuid, text) from public, anon;
grant execute on function public.has_business_permission(uuid, text) to authenticated;

commit;
