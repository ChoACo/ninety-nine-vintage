begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Buying is a customer action that is independent from a user's staff role.
-- Owners, operators, and employees may buy products from stores they manage,
-- provided they satisfy the same active commerce-account requirements as any
-- other authenticated buyer.
create or replace function public.can_purchase_product(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and p_product_id is not null
    and public.is_member(),
    false
  );
$$;

revoke all on function public.can_purchase_product(uuid) from public, anon;
grant execute on function public.can_purchase_product(uuid) to authenticated;

comment on function public.can_purchase_product(uuid) is
  'Allows every authenticated commerce-eligible role to purchase any store product, including products from a store they manage.';

drop trigger if exists auction_bids_reject_own_store on public.auction_bids;
drop trigger if exists cart_items_reject_own_store on public.cart_items;
drop trigger if exists commerce_order_items_reject_own_store on public.commerce_order_items;

comment on function app_private.reject_own_store_bid() is
  'Retired compatibility function. The blocking trigger was removed because staff roles may bid as buyers.';
comment on function app_private.reject_own_store_purchase() is
  'Retired compatibility function. The blocking triggers were removed because staff roles may purchase as buyers.';

commit;
