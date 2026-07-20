-- The live-auction experience is temporarily paused while the fixed-price
-- checkout is stabilized. UI and API guards are not a database security
-- boundary, so authenticated clients must not be able to call the RPC directly.
-- Re-enabling live auctions requires an explicit follow-up migration that
-- restores the authenticated EXECUTE grant after the feature is reviewed.

revoke all on function public.place_bid(uuid, bigint)
from public, anon, authenticated;
