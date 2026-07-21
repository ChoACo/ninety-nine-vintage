-- Resume the live-auction RPC without widening direct table permissions.
-- public.place_bid remains the authoritative transaction: it validates the
-- authenticated member, locks the product, and enforces auction timing and
-- minimum-bid rules before mutating products and auction_bids.

revoke all on function public.place_bid(uuid, bigint)
from public, anon, authenticated;

grant execute on function public.place_bid(uuid, bigint)
to authenticated;
