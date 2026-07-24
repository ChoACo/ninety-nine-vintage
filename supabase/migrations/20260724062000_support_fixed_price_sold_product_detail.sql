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
    case
      when products.sale_type = 'auction' then products.closes_at
      else coalesce(fixed_order.paid_at, fixed_order.created_at, products.updated_at)
    end,
    case
      when products.sale_type = 'auction' then products.final_bid_amount::bigint
      else fixed_order.unit_price
    end,
    case
      when products.sale_type = 'auction' then
        case
          when nullif(btrim(winner.bidder_display_name), '') is null then 'member****'
          else left(btrim(winner.bidder_display_name), 3) || '****'
        end
      else '비공개'
    end,
    case
      when products.sale_type = 'auction' then products.participant_count
      else 0
    end
  from public.products as products
  left join public.auction_bids as winner
    on winner.id = products.final_bid_id
   and winner.product_id = products.id
   and products.sale_type = 'auction'
  left join lateral (
    select
      order_items.unit_price,
      order_items.paid_at,
      order_items.created_at
    from public.commerce_order_items as order_items
    where order_items.product_id = products.id
    order by
      order_items.paid_at desc nulls last,
      order_items.created_at desc,
      order_items.id desc
    limit 1
  ) as fixed_order on products.sale_type = 'fixed'
  where products.id = p_product_id
    and products.status = 'closed'
    and (
      (
        products.sale_type = 'auction'
        and products.final_bid_id is not null
        and products.final_bid_amount is not null
        and winner.id is not null
      )
      or (
        products.sale_type = 'fixed'
        and fixed_order.unit_price is not null
      )
    )
  limit 1;
$$;

revoke all on function public.get_public_sold_product(uuid) from public;
grant execute on function public.get_public_sold_product(uuid) to anon, authenticated;
