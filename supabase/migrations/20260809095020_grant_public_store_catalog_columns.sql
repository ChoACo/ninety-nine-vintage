begin;

-- Public catalog queries embed the active store name and slug through the
-- products.store_id relationship. Keep sensitive store columns private while
-- granting only the columns required for that relationship and storefront UI.
revoke all on table public.stores from anon, authenticated;
grant select (id, name, slug) on table public.stores to anon, authenticated;

-- The owner platform route authenticates the caller first, then invokes this
-- security-definer function with the server service client. Preserve the
-- function's own owner check while allowing that trusted server call.
grant execute on function public.get_owner_store_platform_management()
to service_role;

commit;
