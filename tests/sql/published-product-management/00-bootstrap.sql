\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.stores (
  id uuid primary key,
  manager_id uuid not null,
  is_active boolean not null default true
);

create table public.products (
  id uuid primary key,
  store_id uuid not null references public.stores (id) on delete restrict,
  title text not null,
  description text not null,
  category text not null,
  brand text not null,
  brand_slug text not null,
  brand_source text not null default 'explicit',
  sale_type text not null check (sale_type in ('auction', 'fixed')),
  starting_price bigint not null,
  current_price bigint not null,
  fixed_price bigint,
  bid_increment bigint not null,
  status text not null check (status in ('pending', 'active', 'closed', 'sold')),
  participant_count integer not null default 0,
  final_bid_id uuid,
  publish_at timestamptz not null,
  closes_at timestamptz not null,
  auction_feed_expires_at timestamptz,
  image_urls text[] not null,
  thumbnail_urls text[] not null,
  size_label text not null default '',
  condition_grade text not null default 'A',
  storage_class text not null default 'small',
  measurements jsonb not null default '{}'::jsonb,
  inspection_notes text[] not null default '{}'::text[],
  created_by uuid,
  updated_by uuid,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.auction_bids (
  id uuid primary key,
  product_id uuid not null references public.products (id) on delete restrict
);

create table public.commerce_order_items (
  id uuid primary key,
  product_id uuid not null references public.products (id) on delete restrict
);

create function public.has_store_permission(p_store_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission = 'manage_products'
    and exists (
      select 1
      from public.stores
      where id = p_store_id
        and manager_id = auth.uid()
        and is_active
    )
$$;

revoke all on function public.has_store_permission(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.has_store_permission(uuid, text) to authenticated;

create function public.auction_close_at(p_publish_at timestamptz)
returns timestamptz
language sql
immutable
as $$
  select p_publish_at + interval '1 day'
$$;

create function public.touch_product_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger products_touch_updated_at
before update on public.products
for each row execute function public.touch_product_updated_at();
