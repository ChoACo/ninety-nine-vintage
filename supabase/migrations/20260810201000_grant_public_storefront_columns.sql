begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Storefront pages need the same non-sensitive fields that their active-store
-- policy already exposes. Keep operator, business, address, and payout fields
-- outside the public column grant.
grant select (id, name, slug, description, is_active)
on table public.stores to anon, authenticated;

commit;
