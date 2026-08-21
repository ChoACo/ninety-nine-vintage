begin;

-- Product uploads and product-management edits must remain available during
-- the former auction settlement window. Auction bid settlement rules remain
-- enforced by the authoritative place_bid RPC; this trigger no longer blocks
-- product INSERT/UPDATE mutations based on the clock.
create or replace function public.guard_product_auction_blackout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return new;
end;
$$;

revoke all on function public.guard_product_auction_blackout()
from public, anon, authenticated, service_role;

commit;
