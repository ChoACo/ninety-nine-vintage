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
    and lower(btrim(coalesce(p_permission, ''))) in ('prepare_orders', 'create_shipments')
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
            when 'create_shipments' then actor_membership.create_shipments
            else false
          end
      )
    );
$$;

revoke all on function app_private.has_exact_store_or_group_permission(uuid, uuid, text)
from public, anon, authenticated, service_role;

create or replace function app_private.can_access_inventory_shipment(
  p_shipment_id uuid,
  p_permission text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with active_stores as (
    select distinct items.origin_store_id
    from public.inventory_shipment_items items
    where items.shipment_id = p_shipment_id
      and items.line_status not in ('excluded', 'cancelled')
  )
  select exists (select 1 from active_stores)
    and not exists (
      select 1
      from active_stores target
      where not app_private.has_exact_store_or_group_permission(
        target.origin_store_id,
        p_user_id,
        p_permission
      )
    );
$$;

revoke all on function app_private.can_access_inventory_shipment(uuid, text, uuid)
from public, anon, authenticated, service_role;

-- Preserve the audited Owner implementations behind private wrappers, then
-- make the public RPCs Owner-only. Operators manage store memberships through
-- the store-scoped staff contract instead of changing global account roles.
alter function public.set_member_access_role(uuid, text)
  rename to set_member_access_role_owner_legacy;
alter function public.set_member_access_role_owner_legacy(uuid, text)
  set schema app_private;
revoke all on function app_private.set_member_access_role_owner_legacy(uuid, text)
from public, anon, authenticated, service_role;

create function public.set_member_access_role(p_member_id uuid, p_role_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '전역 역할 변경은 소유자만 할 수 있습니다.';
  end if;
  return app_private.set_member_access_role_owner_legacy(p_member_id, p_role_code);
end;
$$;
revoke all on function public.set_member_access_role(uuid, text) from public, anon, service_role;
grant execute on function public.set_member_access_role(uuid, text) to authenticated;

alter function public.manage_member_sanction(text, uuid, uuid, timestamptz, timestamptz, text)
  rename to manage_member_sanction_owner_legacy;
alter function public.manage_member_sanction_owner_legacy(text, uuid, uuid, timestamptz, timestamptz, text)
  set schema app_private;
revoke all on function app_private.manage_member_sanction_owner_legacy(text, uuid, uuid, timestamptz, timestamptz, text)
from public, anon, authenticated, service_role;

create function public.manage_member_sanction(
  p_action text,
  p_member_id uuid,
  p_sanction_id uuid default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '전역 제재는 소유자만 관리할 수 있습니다.';
  end if;
  return app_private.manage_member_sanction_owner_legacy(
    p_action, p_member_id, p_sanction_id, p_starts_at, p_ends_at, p_reason
  );
end;
$$;
revoke all on function public.manage_member_sanction(text, uuid, uuid, timestamptz, timestamptz, text)
from public, anon, service_role;
grant execute on function public.manage_member_sanction(text, uuid, uuid, timestamptz, timestamptz, text)
to authenticated;

alter function public.add_member_warning(uuid, text, text)
  rename to add_member_warning_owner_legacy;
alter function public.add_member_warning_owner_legacy(uuid, text, text)
  set schema app_private;
revoke all on function app_private.add_member_warning_owner_legacy(uuid, text, text)
from public, anon, authenticated, service_role;

create function public.add_member_warning(
  p_member_id uuid,
  p_category text,
  p_reason text
)
returns table(
  warning_count integer,
  sanction_count integer,
  bid_blocked_until timestamptz,
  cancelled_bid_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '전역 경고는 소유자만 관리할 수 있습니다.';
  end if;
  return query
  select * from app_private.add_member_warning_owner_legacy(
    p_member_id, p_category, p_reason
  );
end;
$$;
revoke all on function public.add_member_warning(uuid, text, text)
from public, anon, service_role;
grant execute on function public.add_member_warning(uuid, text, text) to authenticated;

create or replace function public.get_operator_member_directory(
  p_limit integer default 200,
  p_offset integer default 0
)
returns table(
  id uuid,
  display_name text,
  access_role text,
  reports_to_operator_id uuid,
  warning_count integer,
  sanction_count integer,
  bid_blocked_until timestamptz,
  active_sanctions jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.access_role_for_user(auth.uid()) <> 'operator' then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  return query
  with actor_stores as (
    select membership.store_id
    from public.store_memberships membership
    where membership.user_id = auth.uid()
      and membership.status = 'active'
  ), transaction_members as (
    select inventory.member_id
    from public.customer_inventory_items inventory
    join actor_stores on actor_stores.store_id = inventory.origin_store_id
    union
    select orders.member_id
    from public.commerce_orders orders
    join public.commerce_order_items order_items on order_items.order_id = orders.id
    join actor_stores on actor_stores.store_id = order_items.store_id
    union
    select conversations.member_id
    from public.support_conversations conversations
    join actor_stores on actor_stores.store_id = conversations.store_id
  )
  select profile.id,
    profile.display_name,
    role_record.role_code,
    null::uuid,
    0,
    0,
    null::timestamptz,
    '[]'::jsonb
  from transaction_members relation
  join public.profiles profile on profile.id = relation.member_id
  join public.account_access_roles role_record on role_record.user_id = profile.id
  where profile.deleted_at is null
    and role_record.role_code in ('band_member', 'member')
  order by profile.display_name, profile.id
  limit greatest(1, least(coalesce(p_limit, 200), 500))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.get_operator_member_directory(integer, integer)
from public, anon, service_role;
grant execute on function public.get_operator_member_directory(integer, integer)
to authenticated;

create or replace function public.get_operator_member_storage(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select
      items.id,
      items.member_id,
      case when char_length(profiles.display_name) <= 1 then '*'
        else left(profiles.display_name, 1) || '**' end as member_name,
      items.product_id,
      products.title,
      coalesce(products.image_urls[1], '') as image_url,
      items.origin_store_id,
      stores.name as store_name,
      fulfillments.outbound_released,
      items.storage_started_at,
      items.storage_expires_at,
      items.paid_at
    from public.customer_inventory_items items
    join public.profiles profiles on profiles.id = items.member_id
    join public.products products on products.id = items.product_id
    join public.stores stores on stores.id = items.origin_store_id
    join public.inventory_item_fulfillments fulfillments on fulfillments.inventory_item_id = items.id
    where items.ownership_status = 'active'
      and app_private.has_exact_store_or_group_permission(
        items.origin_store_id, auth.uid(), 'prepare_orders'
      )
      and not exists (
        select 1 from public.inventory_shipment_items shipment_items
        where shipment_items.inventory_item_id = items.id
          and shipment_items.line_status not in ('excluded', 'cancelled')
      )
  ), paged as (
    select * from visible
    order by paid_at desc, id desc
    limit greatest(1, least(coalesce(p_limit, 100), 200))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', id, 'memberId', member_id, 'memberName', member_name,
      'productId', product_id, 'title', title, 'imageUrl', image_url,
      'originStoreId', origin_store_id, 'originStoreName', store_name,
      'fulfillmentStatus', case when outbound_released then 'stored' else 'waiting_outbound' end,
      'shipmentRequested', false, 'storageStartedAt', storage_started_at,
      'storageExpiresAt', storage_expires_at
    ) order by paid_at desc, id desc), '[]'::jsonb),
    'hasMore', (select count(*) from visible) >
      greatest(coalesce(p_offset, 0), 0) + greatest(1, least(coalesce(p_limit, 100), 200))
  ) from paged;
$$;

revoke all on function public.get_operator_member_storage(integer, integer)
from public, anon, service_role;
grant execute on function public.get_operator_member_storage(integer, integer)
to authenticated;

create or replace function public.get_inventory_exception_queue(
  p_include_resolved boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object('cases',coalesce(jsonb_agg(jsonb_build_object(
  'id',e.id,'inventoryItemId',e.inventory_item_id,'productId',i.product_id,
  'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'memberId',i.member_id,
  'businessId',e.business_id,'originStoreId',i.origin_store_id,'originStoreName',s.name,
  'shipmentId',e.shipment_id,'kind',e.kind,'status',e.status,'resolution',e.resolution,
  'publicReason',e.public_reason,'internalNote',e.internal_note,'dueAt',e.review_due_at,
  'version',e.version,'createdAt',e.created_at,'evidencePaths',to_jsonb(e.evidence_paths)
) order by e.created_at,e.id),'[]'::jsonb))
from (
  select candidate.* from public.inventory_exception_cases candidate
  where (p_include_resolved or candidate.status='open')
    and app_private.has_exact_store_or_group_permission(
      candidate.origin_store_id, auth.uid(), 'prepare_orders'
    )
  order by candidate.created_at,candidate.id
  limit greatest(1,least(coalesce(p_limit,100),500))
  offset greatest(coalesce(p_offset,0),0)
) e
join public.customer_inventory_items i on i.id=e.inventory_item_id
join public.products p on p.id=i.product_id
join public.stores s on s.id=i.origin_store_id;
$$;

create or replace function public.get_inventory_exception_candidates(
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
  'inventoryItemId',i.id,'productId',i.product_id,'title',p.title,
  'imageUrl',coalesce(p.image_urls[1],''),'memberId',i.member_id,'businessId',i.business_id,
  'originStoreId',i.origin_store_id,'originStoreName',s.name,'activeShipmentId',x.shipment_id,
  'physicalStatus',f.current_stage,'locationKind',f.location_kind,'isBlocked',f.is_blocked,
  'blockReason',f.block_reason,'version',f.version
) order by i.paid_at,i.id),'[]'::jsonb))
from (
  select candidate.*
  from public.customer_inventory_items candidate
  join public.inventory_item_fulfillments candidate_f on candidate_f.inventory_item_id=candidate.id
  where candidate.ownership_status='active'
    and candidate_f.current_stage not in ('packed','shipped','cancelled')
    and app_private.has_exact_store_or_group_permission(
      candidate.origin_store_id, auth.uid(), 'prepare_orders'
    )
  order by candidate.paid_at,candidate.id
  limit greatest(1,least(coalesce(p_limit,200),500))
  offset greatest(coalesce(p_offset,0),0)
) i
join public.products p on p.id=i.product_id
join public.stores s on s.id=i.origin_store_id
join public.inventory_item_fulfillments f on f.inventory_item_id=i.id
left join lateral(
  select shipment_item.shipment_id
  from public.inventory_shipment_items shipment_item
  where shipment_item.inventory_item_id=i.id
    and shipment_item.line_status in ('requested','held','ready','packed')
  limit 1
) x on true;
$$;

revoke all on function public.get_inventory_exception_queue(boolean, integer, integer)
from public, anon, service_role;
grant execute on function public.get_inventory_exception_queue(boolean, integer, integer)
to authenticated;
revoke all on function public.get_inventory_exception_candidates(integer, integer)
from public, anon, service_role;
grant execute on function public.get_inventory_exception_candidates(integer, integer)
to authenticated;

commit;
