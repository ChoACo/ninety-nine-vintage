begin;

set local lock_timeout = '10s';

alter table public.inventory_shipments
  add column unit_kind text,
  add column unit_store_id uuid references public.stores(id) on delete restrict,
  add column fulfillment_group_id uuid references public.store_fulfillment_groups(id) on delete restrict,
  add column processing_store_id uuid references public.stores(id) on delete restrict,
  add column unit_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(unit_snapshot) = 'object');

create or replace function app_private.refresh_inventory_shipment_unit(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_ids uuid[];
  v_store_names text[];
  v_store_count integer;
  v_group_id uuid;
  v_group_name text;
  v_representative_store_id uuid;
  v_processing_store_name text;
begin
  select array_agg(distinct items.origin_store_id order by items.origin_store_id),
    array_agg(distinct stores.name order by stores.name),
    count(distinct items.origin_store_id)::integer
  into v_store_ids, v_store_names, v_store_count
  from public.inventory_shipment_items as items
  join public.stores on stores.id = items.origin_store_id
  where items.shipment_id = p_shipment_id
    and items.line_status not in ('excluded', 'cancelled');
  if coalesce(v_store_count, 0) < 1 then
    return;
  end if;

  if v_store_count = 1 then
    update public.inventory_shipments
    set unit_kind = 'store', unit_store_id = v_store_ids[1],
        fulfillment_group_id = null, processing_store_id = v_store_ids[1],
        unit_snapshot = jsonb_build_object(
          'unitKind', 'store', 'storeIds', to_jsonb(v_store_ids),
          'storeNames', to_jsonb(v_store_names), 'processingStoreId', v_store_ids[1]
        )
    where id = p_shipment_id;
    return;
  end if;

  select groups.id, groups.name, groups.representative_store_id, processing.name
  into v_group_id, v_group_name, v_representative_store_id, v_processing_store_name
  from public.store_fulfillment_groups as groups
  join public.stores as processing on processing.id = groups.representative_store_id
  where groups.is_active
    and groups.shipping_charge_mode = 'per_group'
    and not exists (
      select 1 from unnest(v_store_ids) as selected_store_id
      where not exists (
        select 1 from public.store_fulfillment_group_members as members
        where members.group_id = groups.id and members.store_id = selected_store_id
      )
    );
  if not found then
    raise exception using
      errcode = '23514',
      message = '연결되지 않은 매장 상품은 하나의 배송 요청으로 묶을 수 없습니다.';
  end if;

  update public.inventory_shipments
  set unit_kind = 'fulfillment_group', unit_store_id = null,
      fulfillment_group_id = v_group_id,
      processing_store_id = v_representative_store_id,
      unit_snapshot = jsonb_build_object(
        'unitKind', 'fulfillment_group', 'groupId', v_group_id,
        'groupName', v_group_name, 'storeIds', to_jsonb(v_store_ids),
        'storeNames', to_jsonb(v_store_names),
        'processingStoreId', v_representative_store_id,
        'processingStoreName', v_processing_store_name
      )
  where id = p_shipment_id;
end;
$$;

revoke all on function app_private.refresh_inventory_shipment_unit(uuid)
from public, anon, authenticated, service_role;

do $$
declare v_shipment_id uuid;
begin
  for v_shipment_id in select id from public.inventory_shipments order by id loop
    perform app_private.refresh_inventory_shipment_unit(v_shipment_id);
  end loop;
end;
$$;

alter table public.inventory_shipments
  add constraint inventory_shipments_unit_kind_check
    check (unit_kind is null or unit_kind in ('store', 'fulfillment_group')),
  add constraint inventory_shipments_unit_shape_check
    check (
      (unit_kind is null and unit_store_id is null and fulfillment_group_id is null and processing_store_id is null)
      or
      (unit_kind = 'store' and unit_store_id is not null and fulfillment_group_id is null
        and processing_store_id = unit_store_id)
      or
      (unit_kind = 'fulfillment_group' and unit_store_id is null and fulfillment_group_id is not null)
    );

create or replace function app_private.enforce_inventory_shipment_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.refresh_inventory_shipment_unit(coalesce(new.shipment_id, old.shipment_id));
  return null;
end;
$$;

revoke all on function app_private.enforce_inventory_shipment_unit()
from public, anon, authenticated, service_role;

create constraint trigger inventory_shipment_items_enforce_unit
after insert or update or delete
on public.inventory_shipment_items
deferrable initially deferred
for each row execute function app_private.enforce_inventory_shipment_unit();

create unique index inventory_shipments_one_active_store_unit_idx
on public.inventory_shipments(member_id, unit_store_id)
where unit_kind = 'store' and status not in ('shipped', 'cancelled');

create unique index inventory_shipments_one_active_group_unit_idx
on public.inventory_shipments(member_id, fulfillment_group_id)
where unit_kind = 'fulfillment_group' and status not in ('shipped', 'cancelled');

comment on column public.inventory_shipments.unit_snapshot is
  'Immutable-at-request store or fulfillment-group routing snapshot; one shipment and tracking number per unit.';

commit;
