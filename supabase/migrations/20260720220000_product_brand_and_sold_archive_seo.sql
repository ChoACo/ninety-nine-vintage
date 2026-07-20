-- Structured product brands and public sold archive SEO surfaces.
-- Additive defaults keep the currently deployed application compatible while
-- the API and admin UI are rolled out immediately after this migration.

alter table public.products
  add column if not exists brand text,
  add column if not exists brand_slug text,
  add column if not exists brand_source text;

with inferred as (
  select
    products.id,
    (
      select nullif(regexp_replace(token.value, '^[[:punct:][:space:]]+|[[:punct:][:space:]]+$', '', 'g'), '')
      from regexp_split_to_table(
        regexp_replace(btrim(products.title), '^\s*\[[^]]+\]\s*', ''),
        '\s+'
      ) with ordinality as token(value, position)
      where nullif(regexp_replace(token.value, '^[[:punct:][:space:]]+|[[:punct:][:space:]]+$', '', 'g'), '') is not null
      order by token.position
      limit 1
    ) as inferred_brand
  from public.products as products
)
update public.products as products
set
  brand = coalesce(inferred.inferred_brand, '기타'),
  brand_slug = coalesce(
    nullif(
      trim(both '-' from regexp_replace(lower(coalesce(inferred.inferred_brand, '')), '[^[:alnum:]]+', '-', 'g')),
      ''
    ),
    'etc'
  ),
  brand_source = 'inferred'
from inferred
where products.id = inferred.id
  and (products.brand is null or products.brand_slug is null or products.brand_source is null);

alter table public.products
  alter column brand set default '기타',
  alter column brand set not null,
  alter column brand_slug set default 'etc',
  alter column brand_slug set not null,
  alter column brand_source set default 'inferred',
  alter column brand_source set not null;

alter table public.products
  drop constraint if exists products_brand_nonempty,
  add constraint products_brand_nonempty check (char_length(btrim(brand)) between 1 and 80),
  drop constraint if exists products_brand_slug_nonempty,
  add constraint products_brand_slug_nonempty check (char_length(btrim(brand_slug)) between 1 and 80),
  drop constraint if exists products_brand_source_check,
  add constraint products_brand_source_check check (brand_source in ('explicit', 'inferred'));

create index if not exists products_sold_brand_cursor_idx
  on public.products (brand_slug, closes_at desc, id desc)
  where status = 'closed' and final_bid_id is not null and final_bid_amount is not null;

drop function if exists public.get_public_sold_auctions(integer, timestamptz, uuid);

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
    products.closes_at,
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
    and products.final_bid_id is not null
    and products.final_bid_amount is not null
    and (p_brand_slug is null or products.brand_slug = p_brand_slug)
    and (
      p_before is null
      or (p_before_id is null and products.closes_at < p_before)
      or (p_before_id is not null and (products.closes_at, products.id) < (p_before, p_before_id))
    )
  order by products.closes_at desc, products.id desc
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
    products.size_label,
    products.condition_grade,
    products.measurements,
    products.inspection_notes,
    products.image_urls,
    products.thumbnail_urls,
    products.closes_at,
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
  where products.id = p_product_id
    and products.status = 'closed'
    and products.final_bid_id is not null
    and products.final_bid_amount is not null
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
    and products.final_bid_id is not null
    and products.final_bid_amount is not null
  group by products.brand_slug
  order by count(*) desc, min(products.brand) asc;
$$;

revoke all on function public.get_public_sold_auctions(integer, timestamptz, uuid, text) from public;
revoke all on function public.get_public_sold_product(uuid) from public;
revoke all on function public.get_public_sold_brands() from public;
grant execute on function public.get_public_sold_auctions(integer, timestamptz, uuid, text) to anon, authenticated;
grant execute on function public.get_public_sold_product(uuid) to anon, authenticated;
grant execute on function public.get_public_sold_brands() to anon, authenticated;
