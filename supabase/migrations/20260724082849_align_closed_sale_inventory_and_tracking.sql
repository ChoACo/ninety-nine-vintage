-- A closed auction remains part of the public auction feed until payment has
-- produced an active inventory entitlement.  The explicit completion marker
-- keeps the catalog/sold split independent from mutable timestamps.
alter table public.products
  add column if not exists sale_completed_at timestamptz;

update public.products p
set sale_completed_at = inventory.completed_at
from (
  select product_id, min(paid_at) as completed_at
  from public.customer_inventory_items
  where ownership_status = 'active'
  group by product_id
) inventory
where p.id = inventory.product_id
  and p.sale_completed_at is null;

create index if not exists products_public_sale_state_idx
  on public.products (sale_type, sale_completed_at desc, publish_at desc, id desc)
  where status in ('active', 'closed');

create or replace function app_private.mark_product_sale_completed_from_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ownership_status = 'active' then
    update public.products
    set sale_completed_at = coalesce(sale_completed_at, new.paid_at, new.created_at, clock_timestamp())
    where id = new.product_id
      and sale_completed_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists mark_product_sale_completed_from_inventory
on public.customer_inventory_items;
create trigger mark_product_sale_completed_from_inventory
after insert or update of ownership_status, paid_at, product_id
on public.customer_inventory_items
for each row
execute function app_private.mark_product_sale_completed_from_inventory();

drop policy if exists "Public reads published products" on public.products;
create policy "Public reads published products"
on public.products
for select
to anon, authenticated
using (
  publish_at <= now()
  and (
    status = 'active'
    or (
      sale_type = 'auction'
      and status = 'closed'
      and final_bid_id is not null
      and final_bid_amount is not null
      and sale_completed_at is null
    )
  )
);

create or replace function public.get_public_sold_feed_products(
  p_sale_type text,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  title text,
  description text,
  category text,
  brand text,
  brand_slug text,
  publish_at timestamptz,
  closes_at timestamptz,
  status text,
  sale_type text,
  starting_price integer,
  current_price integer,
  fixed_price integer,
  bid_increment integer,
  participant_count integer,
  bid_history jsonb,
  anti_sniping_base_closes_at timestamptz,
  anti_sniping_extended_at timestamptz,
  anti_sniping_extension_count integer,
  bid_locked_at timestamptz,
  final_bid_amount integer,
  image_urls text[],
  thumbnail_urls text[],
  size_label text,
  sold_at timestamptz,
  sold_price integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    products.id,
    products.title,
    products.description,
    products.category,
    products.brand,
    products.brand_slug,
    products.publish_at,
    products.closes_at,
    products.status,
    products.sale_type,
    products.starting_price,
    products.current_price,
    products.fixed_price,
    products.bid_increment,
    products.participant_count,
    '[]'::jsonb,
    products.anti_sniping_base_closes_at,
    products.anti_sniping_extended_at,
    products.anti_sniping_extension_count,
    products.bid_locked_at,
    products.final_bid_amount,
    products.image_urls,
    products.thumbnail_urls,
    coalesce(nullif(btrim(products.size_label), ''), ''),
    products.sale_completed_at,
    case
      when products.sale_type = 'auction' then products.final_bid_amount
      else products.fixed_price
    end
  from public.products as products
  where products.status = 'closed'
    and products.sale_type = p_sale_type
    and products.sale_completed_at is not null
    and (
      (
        products.sale_type = 'auction'
        and products.final_bid_id is not null
        and products.final_bid_amount is not null
      )
      or (
        products.sale_type = 'fixed'
        and exists (
          select 1
          from public.customer_inventory_items inventory
          where inventory.product_id = products.id
            and inventory.ownership_status = 'active'
        )
      )
    )
  order by products.sale_completed_at desc, products.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.get_public_sold_auctions(
  p_limit integer default 24,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_brand_slug text default null
)
returns table (
  product_id uuid,
  title text,
  description text,
  brand text,
  brand_slug text,
  brand_source text,
  category text,
  status text,
  size_label text,
  condition_grade text,
  measurements jsonb,
  inspection_notes text[],
  image_urls text[],
  thumbnail_urls text[],
  sold_at timestamptz,
  winning_amount bigint,
  winner_display_name text,
  participant_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    products.id,
    products.title,
    products.description,
    products.brand,
    products.brand_slug,
    products.brand_source,
    products.category,
    products.status,
    products.size_label,
    products.condition_grade,
    products.measurements,
    products.inspection_notes,
    products.image_urls,
    products.thumbnail_urls,
    products.sale_completed_at,
    products.final_bid_amount::bigint,
    case
      when nullif(btrim(winner.bidder_display_name), '') is null then 'member****'
      else left(btrim(winner.bidder_display_name), 3) || '****'
    end,
    products.participant_count
  from public.products as products
  join public.auction_bids as winner
    on winner.id = products.final_bid_id
   and winner.product_id = products.id
  where products.status = 'closed'
    and products.sale_completed_at is not null
    and products.final_bid_id is not null
    and products.final_bid_amount is not null
    and (p_brand_slug is null or products.brand_slug = p_brand_slug)
    and (
      p_before is null
      or (p_before_id is null and products.sale_completed_at < p_before)
      or (
        p_before_id is not null
        and (products.sale_completed_at, products.id) < (p_before, p_before_id)
      )
    )
  order by products.sale_completed_at desc, products.id desc
  limit least(greatest(coalesce(p_limit, 24), 1), 100);
$$;

drop function if exists public.get_public_sold_product(uuid);
create function public.get_public_sold_product(p_product_id uuid)
returns table (
  product_id uuid,
  title text,
  description text,
  brand text,
  brand_slug text,
  category text,
  status text,
  sale_type text,
  size_label text,
  condition_grade text,
  measurements jsonb,
  inspection_notes text[],
  image_urls text[],
  thumbnail_urls text[],
  sold_at timestamptz,
  winning_amount bigint,
  winner_display_name text,
  participant_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    products.id,
    products.title,
    products.description,
    products.brand,
    products.brand_slug,
    products.category,
    products.status,
    products.sale_type,
    products.size_label,
    products.condition_grade,
    products.measurements,
    products.inspection_notes,
    products.image_urls,
    products.thumbnail_urls,
    products.sale_completed_at,
    case
      when products.sale_type = 'auction' then products.final_bid_amount::bigint
      else fixed_inventory.paid_amount
    end,
    case
      when products.sale_type = 'auction' then
        case
          when nullif(btrim(winner.bidder_display_name), '') is null then 'member****'
          else left(btrim(winner.bidder_display_name), 3) || '****'
        end
      else '비공개'
    end,
    case when products.sale_type = 'auction' then products.participant_count else 0 end
  from public.products as products
  left join public.auction_bids as winner
    on winner.id = products.final_bid_id
   and winner.product_id = products.id
   and products.sale_type = 'auction'
  left join lateral (
    select inventory.paid_amount
    from public.customer_inventory_items inventory
    where inventory.product_id = products.id
      and inventory.ownership_status = 'active'
    order by inventory.paid_at desc, inventory.id desc
    limit 1
  ) fixed_inventory on products.sale_type = 'fixed'
  where products.id = p_product_id
    and products.status = 'closed'
    and products.sale_completed_at is not null
    and (
      (
        products.sale_type = 'auction'
        and products.final_bid_id is not null
        and products.final_bid_amount is not null
        and winner.id is not null
      )
      or (
        products.sale_type = 'fixed'
        and fixed_inventory.paid_amount is not null
      )
    )
  limit 1;
$$;

create or replace function public.get_public_sold_brands()
returns table (brand text, brand_slug text, sold_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select min(products.brand), products.brand_slug, count(*)::bigint
  from public.products as products
  where products.status = 'closed'
    and products.sale_completed_at is not null
    and products.final_bid_id is not null
    and products.final_bid_amount is not null
  group by products.brand_slug
  order by count(*) desc, min(products.brand) asc;
$$;

revoke all on function public.get_public_sold_feed_products(text, integer, integer) from public;
revoke all on function public.get_public_sold_auctions(integer, timestamptz, uuid, text) from public;
revoke all on function public.get_public_sold_product(uuid) from public;
revoke all on function public.get_public_sold_brands() from public;
grant execute on function public.get_public_sold_feed_products(text, integer, integer) to anon, authenticated;
grant execute on function public.get_public_sold_auctions(integer, timestamptz, uuid, text) to anon, authenticated;
grant execute on function public.get_public_sold_product(uuid) to anon, authenticated;
grant execute on function public.get_public_sold_brands() to anon, authenticated;

-- Operators can inspect every store in a member's storage detail, while the
-- fulfillment work queue remains scoped by get_direct_store_fulfillment_groups.
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
      i.id,
      i.member_id,
      pf.display_name as member_name,
      i.product_id,
      p.title,
      coalesce(p.image_urls[1], '') as image_url,
      i.origin_store_id,
      s.name as store_name,
      f.outbound_released,
      i.storage_started_at,
      i.storage_expires_at,
      si.shipment_id,
      i.paid_at
    from public.customer_inventory_items i
    join public.profiles pf on pf.id = i.member_id
    join public.products p on p.id = i.product_id
    join public.stores s on s.id = i.origin_store_id
    join public.inventory_item_fulfillments f on f.inventory_item_id = i.id
    left join lateral (
      select x.shipment_id
      from public.inventory_shipment_items x
      where x.inventory_item_id = i.id
        and x.line_status not in ('excluded', 'cancelled')
      order by x.created_at desc
      limit 1
    ) si on true
    where i.ownership_status = 'active'
      and public.can_view_shared_fulfillment()
  ),
  paged as (
    select *
    from visible
    order by paid_at desc, id desc
    limit greatest(1, least(coalesce(p_limit, 100), 200))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', id,
      'memberId', member_id,
      'memberName', member_name,
      'productId', product_id,
      'title', title,
      'imageUrl', image_url,
      'originStoreId', origin_store_id,
      'originStoreName', store_name,
      'fulfillmentStatus', case when outbound_released then 'stored' else 'waiting_outbound' end,
      'shipmentRequested', shipment_id is not null,
      'storageStartedAt', storage_started_at,
      'storageExpiresAt', storage_expires_at
    ) order by paid_at desc, id desc), '[]'::jsonb),
    'hasMore', (select count(*) from visible) >
      greatest(coalesce(p_offset, 0), 0) + greatest(1, least(coalesce(p_limit, 100), 200))
  )
  from paged;
$$;

-- Winners are derived from the authoritative final bid.  Payment confirmation
-- is the removal boundary; creating a transfer request is not.
create or replace function public.get_operator_winning_members(
  p_limit integer default 50,
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
      winner.bidder_id as member_id,
      pf.display_name as member_name,
      pending_order.id as payment_order_id,
      p.id as product_id,
      p.title,
      coalesce(p.image_urls[1], '') as image_url,
      p.store_id,
      s.name as store_name,
      p.final_bid_amount as expected_amount,
      coalesce(pending_order.status, 'not_started') as payment_status,
      p.closes_at as won_at
    from public.products p
    join public.auction_bids winner
      on winner.id = p.final_bid_id
     and winner.product_id = p.id
    join public.profiles pf on pf.id = winner.bidder_id
    join public.stores s on s.id = p.store_id
    left join lateral (
      select o.id, o.status
      from public.manual_transfer_orders o
      where o.product_id = p.id
        and o.buyer_id = winner.bidder_id
        and o.status = 'awaiting_manual_transfer'
      order by o.requested_at desc, o.id desc
      limit 1
    ) pending_order on true
    where p.sale_type = 'auction'
      and p.status = 'closed'
      and p.final_bid_id is not null
      and p.final_bid_amount is not null
      and winner.bidder_id is not null
      and public.can_view_shared_fulfillment()
      and (public.is_owner() or public.has_store_permission(p.store_id, 'prepare_orders'))
      and not exists (
        select 1
        from public.manual_transfer_orders confirmed_order
        where confirmed_order.product_id = p.id
          and confirmed_order.buyer_id = winner.bidder_id
          and confirmed_order.status = 'confirmed'
      )
  ),
  grouped as (
    select
      member_id,
      member_name,
      count(*)::integer as item_count,
      sum(expected_amount)::bigint as total_amount,
      max(won_at) as latest_won_at,
      jsonb_agg(jsonb_build_object(
        'paymentOrderId', payment_order_id,
        'productId', product_id,
        'title', title,
        'imageUrl', image_url,
        'originStoreId', store_id,
        'originStoreName', store_name,
        'amount', expected_amount,
        'paymentStatus', payment_status
      ) order by won_at desc, product_id desc) as items
    from visible
    group by member_id, member_name
  ),
  paged as (
    select *
    from grouped
    order by latest_won_at desc, member_id
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'members', coalesce(jsonb_agg(jsonb_build_object(
      'memberId', member_id,
      'memberName', member_name,
      'itemCount', item_count,
      'totalAmount', total_amount,
      'latestWonAt', latest_won_at,
      'items', items
    ) order by latest_won_at desc, member_id), '[]'::jsonb),
    'hasMore', (select count(*) from grouped) >
      greatest(coalesce(p_offset, 0), 0) + greatest(1, least(coalesce(p_limit, 50), 100))
  )
  from paged;
$$;

-- As soon as a non-cancelled shipment line exists, the item moves out of the
-- member storage list and remains accessible through shipment history only.
create or replace function public.get_my_inventory_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'rolloutEnabled', coalesce(bool_or(rs.unified_inventory_reads_enabled), false),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'productId', i.product_id,
      'title', p.title,
      'imageUrl', coalesce(p.image_urls[1], ''),
      'sourceKind', i.source_kind,
      'sourceReference', coalesce(i.commerce_order_item_id, i.manual_transfer_order_id, i.legacy_payment_order_id),
      'originStoreId', i.origin_store_id,
      'originStoreName', s.name,
      'ownershipStatus', i.ownership_status,
      'rolloutEnabled', rs.unified_inventory_reads_enabled,
      'itemSelectedShipmentsEnabled', rs.item_selected_shipments_enabled,
      'requestEligible', (
        rs.item_selected_shipments_enabled
        and i.ownership_status = 'active'
        and f.current_stage in ('entitled', 'preparing', 'in_transit_to_center', 'center_received', 'center_stored')
        and not f.is_blocked
      ),
      'requestBlockReason', case
        when not rs.item_selected_shipments_enabled or i.ownership_status <> 'active' or f.is_blocked
          or f.current_stage not in ('entitled', 'preparing', 'in_transit_to_center', 'center_received', 'center_stored')
          then 'unavailable'
      end,
      'storageStartedAt', i.storage_started_at,
      'storageExpiresAt', i.storage_expires_at,
      'activeShipmentId', null
    ) order by i.paid_at desc, i.id), '[]'::jsonb),
    'serverTime', clock_timestamp()
  )
  from public.customer_inventory_items i
  join public.products p on p.id = i.product_id
  join public.stores s on s.id = i.origin_store_id
  join public.inventory_item_fulfillments f on f.inventory_item_id = i.id
  join public.inventory_fulfillment_rollout_settings rs on rs.business_id = i.business_id
  where i.member_id = auth.uid()
    and rs.unified_inventory_reads_enabled
    and i.legacy_commerce_shipment_id is null
    and not exists (
      select 1
      from public.inventory_shipment_items shipment_item
      where shipment_item.inventory_item_id = i.id
        and shipment_item.line_status not in ('excluded', 'cancelled')
    );
$$;

alter table public.inventory_command_receipts
  drop constraint if exists inventory_command_receipts_command_name_check;
alter table public.inventory_command_receipts
  add constraint inventory_command_receipts_command_name_check
  check (command_name in (
    'confirm_payment', 'request_shipment', 'release_store_items',
    'center_receive', 'center_store', 'pack_shipment', 'ship_shipment',
    'open_exception', 'resolve_exception', 'submit_refund_account',
    'review_refund', 'refund_account_access', 'append_exception_evidence',
    'configure_rollout', 'review_shipping_fee_refund', 'reconcile_inventory_item',
    'release_paid_items', 'submit_shipping_fee_refund_account',
    'shipping_fee_refund_account_access', 'configure_center_assignment',
    'revise_tracking'
  ));

alter table public.inventory_shipment_events
  drop constraint if exists inventory_shipment_events_event_type_check;
alter table public.inventory_shipment_events
  add constraint inventory_shipment_events_event_type_check
  check (event_type in (
    'requested', 'store_items_released', 'ready_to_pack', 'packed', 'shipped',
    'line_held', 'line_resumed', 'line_excluded', 'cancelled',
    'reconciliation_required', 'tracking_updated', 'tracking_deleted'
  ));

create or replace function public.revise_inventory_shipment_tracking(
  p_shipment_id uuid,
  p_expected_version bigint,
  p_action text,
  p_courier text,
  p_tracking_number text,
  p_idempotency_key uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_sh public.inventory_shipments%rowtype;
  v_fp text;
  v_receipt public.inventory_command_receipts%rowtype;
  v_result jsonb;
begin
  if v_actor is null or not public.can_view_shared_fulfillment() then
    raise exception using errcode = '42501', message = '송장 수정 권한이 없습니다.';
  end if;
  if p_idempotency_key is null
    or p_action not in ('update', 'delete')
    or (
      p_action = 'update'
      and (
        char_length(btrim(coalesce(p_courier, ''))) not between 1 and 80
        or char_length(btrim(coalesce(p_tracking_number, ''))) not between 3 and 120
      )
    )
    or (
      p_action = 'delete'
      and (p_courier is not null or p_tracking_number is not null)
    )
  then
    raise exception using errcode = '22023', message = '송장 수정 내용을 확인해 주세요.';
  end if;

  v_fp := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'shipment', p_shipment_id,
    'version', p_expected_version,
    'action', p_action,
    'courier', case when p_action = 'update' then btrim(p_courier) end,
    'tracking', case when p_action = 'update' then btrim(p_tracking_number) end,
    'note', btrim(coalesce(p_note, '')),
    'flow', 'tracking_revision'
  ));

  select * into v_receipt
  from public.inventory_command_receipts
  where actor_user_id = v_actor
    and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'revise_tracking'
      or v_receipt.request_fingerprint <> v_fp
    then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  perform app_private.lock_inventory_shipment(p_shipment_id);
  select * into v_sh
  from public.inventory_shipments
  where id = p_shipment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '배송 신청을 찾지 못했습니다.';
  end if;
  if v_sh.version <> p_expected_version or v_sh.status <> 'shipped' then
    raise exception using errcode = 'PT409', message = '발송 상태가 변경되었습니다.';
  end if;

  if p_action = 'update' then
    update public.inventory_shipments
    set courier = btrim(p_courier),
      tracking_number = btrim(p_tracking_number),
      version = version + 1,
      updated_at = clock_timestamp()
    where id = v_sh.id
    returning * into v_sh;

    insert into public.inventory_shipment_events(
      shipment_id, sequence_no, event_type, from_status, to_status,
      actor_kind, actor_user_id, idempotency_key, reason, metadata
    ) values (
      v_sh.id,
      coalesce((select max(sequence_no) + 1 from public.inventory_shipment_events
        where shipment_id = v_sh.id), 1),
      'tracking_updated', 'shipped', 'shipped',
      'user', v_actor, p_idempotency_key, p_note,
      jsonb_build_object('courier', v_sh.courier, 'trackingNumber', v_sh.tracking_number)
    );
  else
    update public.inventory_shipment_items
    set line_status = 'packed',
      updated_at = clock_timestamp()
    where shipment_id = v_sh.id
      and line_status = 'shipped';

    update public.inventory_item_fulfillments fulfillment
    set current_stage = 'packed',
      location_kind = 'center',
      storage_location_code = null,
      version = version + 1,
      last_event_at = clock_timestamp(),
      updated_at = clock_timestamp()
    from public.inventory_shipment_items shipment_item
    where shipment_item.shipment_id = v_sh.id
      and shipment_item.inventory_item_id = fulfillment.inventory_item_id
      and shipment_item.line_status = 'packed';

    update public.inventory_shipments
    set status = 'packed',
      courier = null,
      tracking_number = null,
      shipped_at = null,
      shipped_by = null,
      version = version + 1,
      updated_at = clock_timestamp()
    where id = v_sh.id
    returning * into v_sh;

    insert into public.inventory_shipment_events(
      shipment_id, sequence_no, event_type, from_status, to_status,
      actor_kind, actor_user_id, idempotency_key, reason
    ) values (
      v_sh.id,
      coalesce((select max(sequence_no) + 1 from public.inventory_shipment_events
        where shipment_id = v_sh.id), 1),
      'tracking_deleted', 'shipped', 'packed',
      'user', v_actor, p_idempotency_key, p_note
    );
  end if;

  v_result := jsonb_build_object(
    'id', v_sh.id,
    'version', v_sh.version,
    'status', v_sh.status,
    'idempotent_replay', false
  );
  insert into public.inventory_command_receipts
  values (
    v_actor, p_idempotency_key, 'revise_tracking', v_sh.id,
    v_fp, v_result, clock_timestamp()
  );
  return v_result;
end;
$$;

revoke all on function public.get_operator_member_storage(integer, integer)
from public, anon, service_role;
revoke all on function public.get_operator_winning_members(integer, integer)
from public, anon, service_role;
revoke all on function public.get_my_inventory_overview()
from public, anon, service_role;
revoke all on function public.revise_inventory_shipment_tracking(
  uuid, bigint, text, text, text, uuid, text
) from public, anon, service_role;
grant execute on function public.get_operator_member_storage(integer, integer)
to authenticated;
grant execute on function public.get_operator_winning_members(integer, integer)
to authenticated;
grant execute on function public.get_my_inventory_overview()
to authenticated;
grant execute on function public.revise_inventory_shipment_tracking(
  uuid, bigint, text, text, text, uuid, text
) to authenticated;
