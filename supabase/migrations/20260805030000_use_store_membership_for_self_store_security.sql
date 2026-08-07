begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Stage 2: authorization boundaries must use the authoritative operator
-- memberships. stores.operator_id remains the representative column only.

create or replace function app_private.is_active_store_operator(
  p_store_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from public.store_memberships as memberships
    where memberships.store_id = p_store_id
      and memberships.user_id = p_user_id
      and memberships.membership_role = 'operator'
      and memberships.status = 'active'
  ), false);
$$;

revoke all on function app_private.is_active_store_operator(uuid, uuid)
from public, anon, authenticated, service_role;

-- A buyer who is assigned to any operator membership of the product store is
-- still blocked from buying that store's products, including secondary
-- operators and an Owner assigned as an operator.
create or replace function public.can_purchase_product(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and (
      public.access_role_for_user(auth.uid()) in ('member', 'band_member')
      or exists (
        select 1
        from public.commerce_buyer_accounts as buyers
        where buyers.user_id = auth.uid()
          and buyers.status = 'active'
      )
    )
    and not exists (
      select 1
      from public.products as products
      where products.id = p_product_id
        and app_private.is_active_store_operator(products.store_id, auth.uid())
    ), false
  );
$$;

revoke all on function public.can_purchase_product(uuid) from public, anon;
grant execute on function public.can_purchase_product(uuid) to authenticated;

create or replace function app_private.reject_own_store_bid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app_private.is_active_store_operator(
    (select products.store_id from public.products as products where products.id = new.product_id),
    new.bidder_id
  ) then
    raise exception using
      errcode = '42501',
      message = '본인이 운영하는 센터의 상품에는 입찰할 수 없습니다.';
  end if;
  return new;
end;
$$;

revoke all on function app_private.reject_own_store_bid()
from public, anon, authenticated;

drop trigger if exists auction_bids_reject_own_store on public.auction_bids;
create trigger auction_bids_reject_own_store
before insert on public.auction_bids
for each row execute function app_private.reject_own_store_bid();

create or replace function app_private.reject_own_store_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid;
  v_store uuid;
begin
  if tg_table_name = 'cart_items' then
    v_buyer := new.member_id;
  else
    select orders.member_id
    into v_buyer
    from public.commerce_orders as orders
    where orders.id = new.order_id;
  end if;

  select products.store_id
  into v_store
  from public.products as products
  where products.id = new.product_id;

  if app_private.is_active_store_operator(v_store, v_buyer) then
    raise exception using
      errcode = '42501',
      message = '본인이 운영하는 센터의 상품은 구매할 수 없습니다.';
  end if;
  return new;
end;
$$;

revoke all on function app_private.reject_own_store_purchase()
from public, anon, authenticated;

drop trigger if exists cart_items_reject_own_store on public.cart_items;
create trigger cart_items_reject_own_store
before insert on public.cart_items
for each row execute function app_private.reject_own_store_purchase();

drop trigger if exists commerce_order_items_reject_own_store on public.commerce_order_items;
create trigger commerce_order_items_reject_own_store
before insert on public.commerce_order_items
for each row execute function app_private.reject_own_store_purchase();

commit;
