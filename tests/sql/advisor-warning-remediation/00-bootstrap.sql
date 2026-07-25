\set ON_ERROR_STOP on

create schema auth;
create schema app_private;
create schema storage;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create function auth.uid()
returns uuid
language sql
stable
as $$ select null::uuid $$;

create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select false $$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select false $$;

create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select false $$;

create function public.is_employee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select false $$;

create function public.can_manage_product_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select false $$;

create function public.unrelated_private_function()
returns boolean
language sql
security definer
set search_path = ''
as $$ select true $$;

create function app_private.is_owner_hidden_test_member_for_policy(
  p_member_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select false $$;

grant execute on function public.is_member() to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_owner() to anon, authenticated;
grant execute on function public.is_employee() to anon, authenticated;
grant execute on function public.can_manage_product_store(uuid)
  to anon, authenticated;
grant execute on function public.unrelated_private_function()
  to anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function
  app_private.is_owner_hidden_test_member_for_policy(uuid)
  to authenticated;

create table public.commerce_orders (
  id uuid primary key,
  member_id uuid not null
);
create table public.commerce_order_items (
  order_id uuid not null,
  product_id uuid not null
);
create table public.commerce_order_transfers (
  id uuid primary key,
  member_id uuid not null
);
create table public.manual_transfer_orders (
  id uuid primary key,
  buyer_id uuid not null
);
create table public.shipping_fee_payments (
  id uuid primary key,
  member_id uuid not null
);
create table public.manual_transfer_payment_ledger (
  manual_transfer_order_id uuid,
  commerce_order_transfer_id uuid,
  shipping_fee_payment_id uuid
);
create table public.shipping_credit_ledger (
  member_id uuid not null
);
create table public.wishlist_items (
  member_id uuid not null
);
create table public.auction_bids (
  bidder_id uuid not null
);
create table public.products (
  id uuid primary key,
  store_id uuid,
  publish_at timestamptz not null default now(),
  status text not null default 'active',
  sale_type text not null default 'auction',
  final_bid_id uuid,
  final_bid_amount integer,
  sale_completed_at timestamptz
);
create table public.profiles (
  id uuid primary key
);
create table public.shipping_requests (
  id uuid primary key,
  member_id uuid not null,
  status text not null
);
create table public.shipping_request_items (
  request_id uuid not null
);
create table storage.objects (
  bucket_id text not null,
  name text not null
);

alter table public.commerce_orders enable row level security;
alter table public.commerce_order_items enable row level security;
alter table public.commerce_order_transfers enable row level security;
alter table public.manual_transfer_payment_ledger enable row level security;
alter table public.shipping_credit_ledger enable row level security;
alter table public.shipping_fee_payments enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.auction_bids enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.shipping_requests enable row level security;
alter table public.shipping_request_items enable row level security;
alter table storage.objects enable row level security;

create policy "Members read their commerce orders"
on public.commerce_orders for select to authenticated using (true);
create policy "Members read their commerce items"
on public.commerce_order_items for select to authenticated using (true);
create policy "Members read commerce order transfers"
on public.commerce_order_transfers for select to authenticated using (true);
create policy "Members read their manual transfer ledger"
on public.manual_transfer_payment_ledger
for select to authenticated using (true);
create policy "Members read their shipping credits"
on public.shipping_credit_ledger for select to authenticated using (true);
create policy "Members read their shipping payments"
on public.shipping_fee_payments for select to authenticated using (true);
create policy "Members manage their wishlist"
on public.wishlist_items for all to authenticated
using (true) with check (true);
create policy "Members read their bids"
on public.auction_bids for select to authenticated using (true);
create policy "Staff read every bid"
on public.auction_bids for select to authenticated using (true);
create policy "Members read products in their commerce orders"
on public.products for select to authenticated using (true);
create policy "Product managers read scoped products"
on public.products for select to authenticated using (true);
create policy "Public reads published products"
on public.products for select to anon, authenticated using (true);
create policy "Members read their own profile"
on public.profiles for select to authenticated using (true);
create policy "Owners read all profiles"
on public.profiles for select to authenticated using (true);
create policy "Employees read pending shipping requests"
on public.shipping_requests for select to authenticated using (true);
create policy "Members read their shipping requests and staff read all"
on public.shipping_requests for select to authenticated using (true);
create policy "Employees read pending shipping items"
on public.shipping_request_items for select to authenticated using (true);
create policy "Members read their shipping items and staff read all"
on public.shipping_request_items for select to authenticated using (true);
create policy "Public reads product images"
on storage.objects for select to public using (bucket_id = 'product-images');

create function public.get_auction_server_time()
returns timestamptz
language sql
security definer
set search_path = ''
as $$ select clock_timestamp() $$;

create function public.get_public_sold_feed_products(
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
    null::uuid, null::text, null::text, null::text, null::text, null::text,
    null::timestamptz, null::timestamptz, null::text, null::text,
    null::integer, null::integer, null::integer, null::integer, null::integer,
    null::jsonb, null::timestamptz, null::timestamptz, null::integer,
    null::timestamptz, null::integer, null::text[], null::text[], null::text,
    null::timestamptz, null::integer
  where false;
$$;

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
    null::uuid, null::text, null::text, null::text, null::text, null::text,
    null::text, null::text, null::text, null::text, null::jsonb, null::text[],
    null::text[], null::text[], null::timestamptz, null::bigint, null::text,
    null::integer
  where false;
$$;

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
    null::uuid, null::text, null::text, null::text, null::text, null::text,
    null::text, null::text, null::text, null::text, null::jsonb, null::text[],
    null::text[], null::text[], null::timestamptz, null::bigint, null::text,
    null::integer
  where false;
$$;

create function public.get_public_sold_brands()
returns table (brand text, brand_slug text, sold_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select null::text, null::text, null::bigint where false;
$$;

grant execute on function public.get_auction_server_time()
  to anon, authenticated;
grant execute on function
  public.get_public_sold_feed_products(text, integer, integer)
  to anon, authenticated;
grant execute on function
  public.get_public_sold_auctions(integer, timestamptz, uuid, text)
  to anon, authenticated;
grant execute on function public.get_public_sold_product(uuid)
  to anon, authenticated;
grant execute on function public.get_public_sold_brands()
  to anon, authenticated;
