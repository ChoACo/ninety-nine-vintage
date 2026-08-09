begin;

-- A shipment is operable only when the actor can create shipments for every
-- active origin-store line. Group membership expands logistics work only and
-- never grants product, member, revenue, or settlement access.
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
  select p_user_id is not null
    and lower(btrim(coalesce(p_permission, ''))) in ('prepare_orders', 'create_shipments')
    and exists (select 1 from active_stores)
    and not exists (
      select 1
      from active_stores target
      where not (
        exists (
          select 1
          from public.store_memberships direct_membership
          where direct_membership.store_id = target.origin_store_id
            and direct_membership.user_id = p_user_id
            and direct_membership.status = 'active'
            and case lower(btrim(p_permission))
              when 'prepare_orders' then direct_membership.prepare_orders
              when 'create_shipments' then direct_membership.create_shipments
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
          where target_member.store_id = target.origin_store_id
            and case lower(btrim(p_permission))
              when 'prepare_orders' then actor_membership.prepare_orders
              when 'create_shipments' then actor_membership.create_shipments
              else false
            end
        )
      )
    );
$$;

revoke all on function app_private.can_access_inventory_shipment(uuid, text, uuid)
from public, anon, authenticated, service_role;

create or replace function public.get_inventory_shipment_queue(
  p_include_shipped boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_shipments jsonb;
  v_completed jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = '택배 신청 조회 권한이 없습니다.';
  end if;

  perform public.refresh_inventory_delivery_history();

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', shipments.id,
    'memberId', shipments.member_id,
    'memberName', case
      when char_length(profiles.display_name) <= 1 then '*'
      else left(profiles.display_name, 1) || repeat('*', least(char_length(profiles.display_name) - 1, 3))
    end,
    'businessId', shipments.business_id,
    'status', shipments.status,
    'version', shipments.version,
    'settlementMethod', shipments.settlement_method,
    'shippingFeeStatus', case
      when shipments.settlement_method = 'manual_transfer' then payments.status
      else 'confirmed'
    end,
    'requestedAt', shipments.created_at,
    'packedAt', shipments.packed_at,
    'shippedAt', shipments.shipped_at,
    'courier', shipments.courier,
    'trackingNumber', shipments.tracking_number,
    'addressSnapshot', jsonb_build_object(
      'label', coalesce(shipments.address_snapshot ->> 'label', '배송지'),
      'recipientName', '작업 시 확인',
      'phone', '***-****-****',
      'postalCode', null,
      'address', '작업 시 확인'
    ),
    'itemCount', (select count(*) from public.inventory_shipment_items x where x.shipment_id = shipments.id),
    'activeItemCount', (select count(*) from public.inventory_shipment_items x where x.shipment_id = shipments.id and x.line_status not in ('excluded', 'cancelled')),
    'releasedItemCount', (select count(*) from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id where x.shipment_id = shipments.id and x.line_status not in ('excluded', 'cancelled') and f.outbound_released),
    'unreleasedItemCount', (select count(*) from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id where x.shipment_id = shipments.id and x.line_status not in ('excluded', 'cancelled') and not f.outbound_released),
    'heldItemCount', (select count(*) from public.inventory_shipment_items x where x.shipment_id = shipments.id and x.line_status = 'held'),
    'storeWorks', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', works.id, 'storeId', works.origin_store_id, 'storeName', stores.name,
      'status', works.status, 'version', works.version
    ) order by stores.name, works.origin_store_id), '[]'::jsonb)
      from public.inventory_shipment_store_works works
      join public.stores stores on stores.id = works.origin_store_id
      where works.shipment_id = shipments.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', shipment_items.inventory_item_id,
      'productId', shipment_items.product_id,
      'title', products.title,
      'imageUrl', coalesce(products.image_urls[1], ''),
      'lineStatus', shipment_items.line_status,
      'released', fulfillments.outbound_released,
      'originStoreId', shipment_items.origin_store_id,
      'originStoreName', stores.name,
      'isBlocked', fulfillments.is_blocked
    ) order by stores.name, shipment_items.created_at, shipment_items.inventory_item_id), '[]'::jsonb)
      from public.inventory_shipment_items shipment_items
      join public.products products on products.id = shipment_items.product_id
      join public.inventory_item_fulfillments fulfillments on fulfillments.inventory_item_id = shipment_items.inventory_item_id
      join public.stores stores on stores.id = shipment_items.origin_store_id
      where shipment_items.shipment_id = shipments.id)
  ) order by shipments.created_at desc, shipments.id desc), '[]'::jsonb)
  into v_shipments
  from (
    select candidate.*
    from public.inventory_shipments candidate
    where candidate.delivery_completed_at is null
      and (p_include_shipped or candidate.status <> 'shipped')
      and app_private.can_access_inventory_shipment(candidate.id, 'create_shipments', v_actor)
    order by candidate.created_at desc, candidate.id desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(coalesce(p_offset, 0), 0)
  ) shipments
  join public.profiles profiles on profiles.id = shipments.member_id
  left join public.shipping_fee_payments payments on payments.id = shipments.shipping_fee_payment_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shipmentId', history.shipment_id,
    'memberId', history.member_id,
    'memberName', case when char_length(history.member_name) <= 1 then '*' else left(history.member_name, 1) || '**' end,
    'courier', history.courier,
    'trackingNumber', history.tracking_number,
    'itemCount', history.item_count,
    'products', history.product_summaries,
    'shippedAt', history.shipped_at,
    'completedAt', history.completed_at,
    'purgeAfter', history.purge_after
  ) order by history.completed_at desc, history.shipment_id desc), '[]'::jsonb)
  into v_completed
  from (
    select candidate.*
    from public.inventory_delivery_history candidate
    where app_private.can_access_inventory_shipment(candidate.shipment_id, 'create_shipments', v_actor)
    order by candidate.completed_at desc, candidate.shipment_id desc
    limit 500
  ) history;

  return jsonb_build_object(
    'shipments', coalesce(v_shipments, '[]'::jsonb),
    'completedDeliveries', coalesce(v_completed, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_inventory_shipment_queue(boolean, integer, integer)
from public, anon, service_role;
grant execute on function public.get_inventory_shipment_queue(boolean, integer, integer)
to authenticated;

create or replace function app_private.assert_inventory_shipment_mutation_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    new.status in ('packed', 'shipped')
    or old.status in ('packed', 'shipped')
    or old.courier is distinct from new.courier
    or old.tracking_number is distinct from new.tracking_number
  ) and not app_private.can_access_inventory_shipment(new.id, 'create_shipments', auth.uid())
  then
    raise exception using errcode = '42501', message = '택배 발송 권한이 없습니다.';
  end if;
  return new;
end;
$$;

revoke all on function app_private.assert_inventory_shipment_mutation_gate()
from public, anon, authenticated, service_role;

-- The trigger is the common mutation boundary used by packing, dispatch, and
-- tracking correction, including direct RPC calls that bypass the UI.
drop trigger if exists inventory_shipments_mutation_gate on public.inventory_shipments;
create trigger inventory_shipments_mutation_gate
before update on public.inventory_shipments
for each row execute function app_private.assert_inventory_shipment_mutation_gate();

commit;
