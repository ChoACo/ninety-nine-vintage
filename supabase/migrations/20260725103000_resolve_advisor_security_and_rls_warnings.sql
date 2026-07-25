begin;

-- Keep the public sold archive callable by guests without exposing a
-- SECURITY DEFINER entry point through PostgREST. The existing implementations
-- move to the unexposed app_private schema, and public SECURITY INVOKER wrappers
-- preserve the exact RPC signatures used by the storefront.
alter function public.get_public_sold_feed_products(text, integer, integer)
  set schema app_private;
alter function public.get_public_sold_auctions(integer, timestamptz, uuid, text)
  set schema app_private;
alter function public.get_public_sold_product(uuid)
  set schema app_private;
alter function public.get_public_sold_brands()
  set schema app_private;

revoke all on function app_private.get_public_sold_feed_products(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function app_private.get_public_sold_auctions(integer, timestamptz, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.get_public_sold_product(uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.get_public_sold_brands()
  from public, anon, authenticated, service_role;

grant usage on schema app_private to anon, authenticated, service_role;
grant execute on function app_private.get_public_sold_feed_products(text, integer, integer)
  to anon, authenticated, service_role;
grant execute on function app_private.get_public_sold_auctions(integer, timestamptz, uuid, text)
  to anon, authenticated, service_role;
grant execute on function app_private.get_public_sold_product(uuid)
  to anon, authenticated, service_role;
grant execute on function app_private.get_public_sold_brands()
  to anon, authenticated, service_role;

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
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_public_sold_feed_products(
    p_sale_type,
    p_limit,
    p_offset
  );
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
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_public_sold_auctions(
    p_limit,
    p_before,
    p_before_id,
    p_brand_slug
  );
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
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_public_sold_product(p_product_id);
$$;

create function public.get_public_sold_brands()
returns table (brand text, brand_slug text, sold_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_public_sold_brands();
$$;

revoke all on function public.get_public_sold_feed_products(text, integer, integer)
  from public;
revoke all on function public.get_public_sold_auctions(integer, timestamptz, uuid, text)
  from public;
revoke all on function public.get_public_sold_product(uuid)
  from public;
revoke all on function public.get_public_sold_brands()
  from public;
grant execute on function public.get_public_sold_feed_products(text, integer, integer)
  to anon, authenticated, service_role;
grant execute on function public.get_public_sold_auctions(integer, timestamptz, uuid, text)
  to anon, authenticated, service_role;
grant execute on function public.get_public_sold_product(uuid)
  to anon, authenticated, service_role;
grant execute on function public.get_public_sold_brands()
  to anon, authenticated, service_role;

-- The server clock does not read protected data, so elevated execution is
-- unnecessary. Keeping the existing grants preserves guest clock sync.
alter function public.get_auction_server_time() security invoker;

-- Remove anonymous execution from every remaining elevated public function.
-- Authenticated and service-role grants are deliberately preserved because
-- those RPCs enforce their own member, role, store, and CAS contracts.
do $$
declare
  target_function regprocedure;
begin
  for target_function in
    select procedures.oid::regprocedure
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.prosecdef
  loop
    execute format(
      'revoke all on function %s from public, anon',
      target_function
    );
  end loop;
end;
$$;

-- Future migration-created functions must opt into public or anonymous
-- execution rather than inheriting PostgreSQL's default PUBLIC grant.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- Public buckets already serve known object URLs without a SELECT policy.
-- Removing this broad policy prevents anonymous object enumeration while
-- preserving image delivery and the existing staff upload/delete policies.
drop policy if exists "Public reads product images" on storage.objects;

-- Cache auth and role helpers once per statement instead of once per row.
drop policy if exists "Members read their commerce orders"
  on public.commerce_orders;
create policy "Members read their commerce orders"
on public.commerce_orders
for select
to authenticated
using (member_id = (select auth.uid()));

drop policy if exists "Members read their commerce items"
  on public.commerce_order_items;
create policy "Members read their commerce items"
on public.commerce_order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.commerce_orders as orders
    where orders.id = commerce_order_items.order_id
      and orders.member_id = (select auth.uid())
  )
);

drop policy if exists "Members read commerce order transfers"
  on public.commerce_order_transfers;
create policy "Members read commerce order transfers"
on public.commerce_order_transfers
for select
to authenticated
using (member_id = (select auth.uid()));

drop policy if exists "Members read their manual transfer ledger"
  on public.manual_transfer_payment_ledger;
create policy "Members read their manual transfer ledger"
on public.manual_transfer_payment_ledger
for select
to authenticated
using (
  exists (
    select 1
    from public.manual_transfer_orders as auction_orders
    where auction_orders.id =
      manual_transfer_payment_ledger.manual_transfer_order_id
      and auction_orders.buyer_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.commerce_order_transfers as commerce_transfers
    where commerce_transfers.id =
      manual_transfer_payment_ledger.commerce_order_transfer_id
      and commerce_transfers.member_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.shipping_fee_payments as shipping_payments
    where shipping_payments.id =
      manual_transfer_payment_ledger.shipping_fee_payment_id
      and shipping_payments.member_id = (select auth.uid())
  )
);

drop policy if exists "Members read their shipping credits"
  on public.shipping_credit_ledger;
create policy "Members read their shipping credits"
on public.shipping_credit_ledger
for select
to authenticated
using (
  member_id = (select auth.uid())
  or (select public.is_staff())
);

drop policy if exists "Members read their shipping payments"
  on public.shipping_fee_payments;
create policy "Members read their shipping payments"
on public.shipping_fee_payments
for select
to authenticated
using (
  member_id = (select auth.uid())
  or (select public.is_staff())
);

drop policy if exists "Members manage their wishlist"
  on public.wishlist_items;
create policy "Members manage their wishlist"
on public.wishlist_items
for all
to authenticated
using (member_id = (select auth.uid()))
with check (member_id = (select auth.uid()));

-- Merge overlapping SELECT policies without changing their OR semantics.
drop policy if exists "Members read their bids" on public.auction_bids;
drop policy if exists "Staff read every bid" on public.auction_bids;
create policy "Members or staff read authorized bids"
on public.auction_bids
for select
to authenticated
using (
  (
    bidder_id = (select auth.uid())
    and (select public.is_member())
  )
  or (
    (select public.is_staff())
    and (
      (select public.is_owner())
      or not app_private.is_owner_hidden_test_member_for_policy(bidder_id)
    )
  )
);

drop policy if exists "Members read products in their commerce orders"
  on public.products;
drop policy if exists "Product managers read scoped products"
  on public.products;
drop policy if exists "Public reads published products"
  on public.products;

create policy "Public reads published products"
on public.products
for select
to anon
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

create policy "Authenticated users read authorized products"
on public.products
for select
to authenticated
using (
  (
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
  )
  or exists (
    select 1
    from public.commerce_order_items as commerce_items
    join public.commerce_orders as commerce_orders
      on commerce_orders.id = commerce_items.order_id
    where commerce_items.product_id = products.id
      and commerce_orders.member_id = (select auth.uid())
  )
  or (select public.can_manage_product_store(products.store_id))
);

drop policy if exists "Members read their own profile" on public.profiles;
drop policy if exists "Owners read all profiles" on public.profiles;
create policy "Members and owners read authorized profiles"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select public.is_owner())
);

drop policy if exists "Employees read pending shipping requests"
  on public.shipping_requests;
drop policy if exists "Members read their shipping requests and staff read all"
  on public.shipping_requests;
create policy "Members and staff read authorized shipping requests"
on public.shipping_requests
for select
to authenticated
using (
  (
    (select public.is_employee())
    and status = 'requested'
    and not app_private.is_owner_hidden_test_member_for_policy(member_id)
  )
  or (
    member_id = (select auth.uid())
    and (select public.is_member())
  )
  or (
    (select public.is_staff())
    and (
      (select public.is_owner())
      or not app_private.is_owner_hidden_test_member_for_policy(member_id)
    )
  )
);

drop policy if exists "Employees read pending shipping items"
  on public.shipping_request_items;
drop policy if exists "Members read their shipping items and staff read all"
  on public.shipping_request_items;
create policy "Members and staff read authorized shipping items"
on public.shipping_request_items
for select
to authenticated
using (
  exists (
    select 1
    from public.shipping_requests as requests
    where requests.id = shipping_request_items.request_id
      and (
        (
          (select public.is_employee())
          and requests.status = 'requested'
          and not app_private.is_owner_hidden_test_member_for_policy(
            requests.member_id
          )
        )
        or (
          requests.member_id = (select auth.uid())
          and (select public.is_member())
        )
        or (
          (select public.is_staff())
          and (
            (select public.is_owner())
            or not app_private.is_owner_hidden_test_member_for_policy(
              requests.member_id
            )
          )
        )
      )
  )
);

comment on function public.get_public_sold_feed_products(text, integer, integer)
  is 'Public SECURITY INVOKER facade over the unexposed sold-feed reader.';
comment on function public.get_public_sold_auctions(integer, timestamptz, uuid, text)
  is 'Public SECURITY INVOKER facade over the unexposed sold-auction reader.';
comment on function public.get_public_sold_product(uuid)
  is 'Public SECURITY INVOKER facade over the unexposed sold-product reader.';
comment on function public.get_public_sold_brands()
  is 'Public SECURITY INVOKER facade over the unexposed sold-brand reader.';

commit;
