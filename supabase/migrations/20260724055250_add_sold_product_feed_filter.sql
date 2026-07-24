create index if not exists products_public_sold_feed_idx
  on public.products (sale_type, updated_at desc, id desc)
  where status = 'closed';

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
    case
      when products.sale_type = 'auction' then products.closes_at
      else products.updated_at
    end,
    case
      when products.sale_type = 'auction' then products.final_bid_amount
      else products.fixed_price
    end
  from public.products as products
  where products.status = 'closed'
    and products.sale_type = p_sale_type
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
          from public.commerce_order_items as order_items
          where order_items.product_id = products.id
        )
      )
    )
  order by
    case
      when products.sale_type = 'auction' then products.closes_at
      else products.updated_at
    end desc,
    products.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.get_public_sold_feed_products(text, integer, integer)
from public;
grant execute on function public.get_public_sold_feed_products(text, integer, integer)
to anon, authenticated;
