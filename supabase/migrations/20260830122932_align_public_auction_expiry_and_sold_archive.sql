begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';

-- A no-bid auction remains public until the 21:00 KST closing boundary that
-- follows its three-day visibility period. Using publish_at + 3 days directly
-- hid products hours before finalize_due_auctions could close them.
create or replace function public.normalize_auction_drop_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_requested_at timestamptz;
begin
  if new.sale_type = 'auction' then
    if tg_op = 'INSERT' or (
      new.status = 'pending'
      and (old.status is distinct from new.status or old.publish_at is distinct from new.publish_at)
    ) then
      v_requested_at := coalesce(new.publish_at, clock_timestamp());
      new.publish_at := public.next_auction_drop_at(v_requested_at);
      new.closes_at := public.auction_close_at(new.publish_at);
    elsif new.status = 'pending' and new.closes_at is distinct from old.closes_at then
      new.closes_at := public.auction_close_at(new.publish_at);
    end if;

    new.auction_feed_expires_at := public.auction_close_at(
      new.publish_at + interval '3 days'
    );
  elsif tg_op = 'INSERT' or new.sale_type = 'fixed' then
    new.auction_feed_expires_at := null;
    new.past_at := null;
    new.past_expires_at := null;
    new.past_action := null;
    new.closes_at := timestamptz '9999-12-31 23:59:59+00';
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_auction_drop_schedule()
from public, anon, authenticated, service_role;

update public.products
set auction_feed_expires_at = public.auction_close_at(
  publish_at + interval '3 days'
)
where sale_type = 'auction'
  and status in ('pending', 'active')
  and auction_feed_expires_at is distinct from public.auction_close_at(
    publish_at + interval '3 days'
  );

-- Keep the existing RPC name for compatibility, but make the archive cover
-- both canonical auction settlements (including Owner recovery offers) and
-- paid fixed-price inventory.
drop function if exists public.get_public_sold_auctions(integer, timestamptz, uuid, text);
create function public.get_public_sold_auctions(
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
    products.brand_source,
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
      when products.sale_type = 'auction'
        then coalesce(products.final_bid_amount, recovery_sale.offered_amount)::bigint
      else fixed_inventory.paid_amount::bigint
    end,
    case
      when products.sale_type = 'fixed' then '비공개'
      when nullif(btrim(coalesce(winner.bidder_display_name, recovery_sale.bidder_display_name_snapshot)), '') is null
        then 'member****'
      else left(btrim(coalesce(winner.bidder_display_name, recovery_sale.bidder_display_name_snapshot)), 3) || '****'
    end,
    case when products.sale_type = 'auction' then products.participant_count else 0 end
  from public.products as products
  left join public.auction_bids as winner
    on winner.id = products.final_bid_id
   and winner.product_id = products.id
   and products.sale_type = 'auction'
  left join lateral (
    select offers.offered_amount, offers.bidder_display_name_snapshot
    from public.auction_purchase_offers as offers
    join public.manual_transfer_orders as orders
      on orders.purchase_offer_id = offers.id
     and orders.product_id = offers.product_id
     and orders.buyer_id = offers.bidder_id
     and orders.status = 'confirmed'
    join public.customer_inventory_items as inventory
      on inventory.manual_transfer_order_id = orders.id
     and inventory.product_id = offers.product_id
     and inventory.member_id = offers.bidder_id
     and inventory.ownership_status = 'active'
    where offers.product_id = products.id
      and offers.status = 'settled'
    order by offers.settled_at desc nulls last, offers.id desc
    limit 1
  ) as recovery_sale on products.sale_type = 'auction'
  left join lateral (
    select inventory.paid_amount
    from public.customer_inventory_items as inventory
    where inventory.product_id = products.id
      and inventory.ownership_status = 'active'
      and inventory.paid_amount is not null
    order by inventory.paid_at desc, inventory.id desc
    limit 1
  ) as fixed_inventory on products.sale_type = 'fixed'
  where products.status = 'closed'
    and products.sale_completed_at is not null
    and (
      (
        products.sale_type = 'auction'
        and (
          (products.final_bid_id is not null and products.final_bid_amount is not null and winner.id is not null)
          or recovery_sale.offered_amount is not null
        )
      )
      or (products.sale_type = 'fixed' and fixed_inventory.paid_amount is not null)
    )
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

create or replace function public.get_public_sold_product(p_product_id uuid)
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
      when products.sale_type = 'auction'
        then coalesce(products.final_bid_amount, recovery_sale.offered_amount)::bigint
      else fixed_inventory.paid_amount::bigint
    end,
    case
      when products.sale_type = 'fixed' then '비공개'
      when nullif(btrim(coalesce(winner.bidder_display_name, recovery_sale.bidder_display_name_snapshot)), '') is null
        then 'member****'
      else left(btrim(coalesce(winner.bidder_display_name, recovery_sale.bidder_display_name_snapshot)), 3) || '****'
    end,
    case when products.sale_type = 'auction' then products.participant_count else 0 end
  from public.products as products
  left join public.auction_bids as winner
    on winner.id = products.final_bid_id
   and winner.product_id = products.id
   and products.sale_type = 'auction'
  left join lateral (
    select offers.offered_amount, offers.bidder_display_name_snapshot
    from public.auction_purchase_offers as offers
    join public.manual_transfer_orders as orders
      on orders.purchase_offer_id = offers.id
     and orders.product_id = offers.product_id
     and orders.buyer_id = offers.bidder_id
     and orders.status = 'confirmed'
    join public.customer_inventory_items as inventory
      on inventory.manual_transfer_order_id = orders.id
     and inventory.product_id = offers.product_id
     and inventory.member_id = offers.bidder_id
     and inventory.ownership_status = 'active'
    where offers.product_id = products.id
      and offers.status = 'settled'
    order by offers.settled_at desc nulls last, offers.id desc
    limit 1
  ) as recovery_sale on products.sale_type = 'auction'
  left join lateral (
    select inventory.paid_amount
    from public.customer_inventory_items as inventory
    where inventory.product_id = products.id
      and inventory.ownership_status = 'active'
      and inventory.paid_amount is not null
    order by inventory.paid_at desc, inventory.id desc
    limit 1
  ) as fixed_inventory on products.sale_type = 'fixed'
  where products.id = p_product_id
    and products.status = 'closed'
    and products.sale_completed_at is not null
    and (
      (
        products.sale_type = 'auction'
        and (
          (products.final_bid_id is not null and products.final_bid_amount is not null and winner.id is not null)
          or recovery_sale.offered_amount is not null
        )
      )
      or (products.sale_type = 'fixed' and fixed_inventory.paid_amount is not null)
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
    and (
      (
        products.sale_type = 'auction'
        and (
          exists (
            select 1 from public.auction_bids as winner
            where winner.id = products.final_bid_id
              and winner.product_id = products.id
              and products.final_bid_amount is not null
          )
          or exists (
            select 1
            from public.auction_purchase_offers as offers
            join public.manual_transfer_orders as orders
              on orders.purchase_offer_id = offers.id
             and orders.product_id = offers.product_id
             and orders.buyer_id = offers.bidder_id
             and orders.status = 'confirmed'
            join public.customer_inventory_items as inventory
              on inventory.manual_transfer_order_id = orders.id
             and inventory.product_id = offers.product_id
             and inventory.member_id = offers.bidder_id
             and inventory.ownership_status = 'active'
            where offers.product_id = products.id
              and offers.status = 'settled'
          )
        )
      )
      or (
        products.sale_type = 'fixed'
        and exists (
          select 1 from public.customer_inventory_items as inventory
          where inventory.product_id = products.id
            and inventory.ownership_status = 'active'
            and inventory.paid_amount is not null
        )
      )
    )
  group by products.brand_slug
  order by count(*) desc, min(products.brand) asc;
$$;

revoke all on function public.get_public_sold_auctions(integer, timestamptz, uuid, text) from public;
revoke all on function public.get_public_sold_product(uuid) from public;
revoke all on function public.get_public_sold_brands() from public;
grant execute on function public.get_public_sold_auctions(integer, timestamptz, uuid, text) to anon, authenticated;
grant execute on function public.get_public_sold_product(uuid) to anon, authenticated;
grant execute on function public.get_public_sold_brands() to anon, authenticated;

comment on function public.get_public_sold_auctions(integer, timestamptz, uuid, text) is
  'Compatibility-named public sold catalog for canonical auction and fixed-price settlements.';

commit;
