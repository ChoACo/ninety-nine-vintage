\set ON_ERROR_STOP on

do $$
declare
  elevated_anon_count integer;
  wrapper_count integer;
  duplicate_policy_count integer;
begin
  select count(*)
  into elevated_anon_count
  from pg_catalog.pg_proc as procedures
  join pg_catalog.pg_namespace as namespaces
    on namespaces.oid = procedures.pronamespace
  where namespaces.nspname = 'public'
    and procedures.prosecdef
    and has_function_privilege('anon', procedures.oid, 'execute');

  if elevated_anon_count <> 0 then
    raise exception
      'expected zero anonymous public SECURITY DEFINER functions, found %',
      elevated_anon_count;
  end if;

  select count(*)
  into wrapper_count
  from pg_catalog.pg_proc as procedures
  join pg_catalog.pg_namespace as namespaces
    on namespaces.oid = procedures.pronamespace
  where namespaces.nspname = 'public'
    and procedures.proname in (
      'get_public_sold_feed_products',
      'get_public_sold_auctions',
      'get_public_sold_product',
      'get_public_sold_brands'
    )
    and not procedures.prosecdef
    and has_function_privilege('anon', procedures.oid, 'execute');

  if wrapper_count <> 4 then
    raise exception
      'expected four anonymous SECURITY INVOKER sold wrappers, found %',
      wrapper_count;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname = 'get_auction_server_time'
      and not procedures.prosecdef
      and has_function_privilege('anon', procedures.oid, 'execute')
  ) then
    raise exception 'public auction clock must remain anonymous and invoker-safe';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public reads product images'
  ) then
    raise exception 'broad product image listing policy still exists';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'Members read their bids',
        'Staff read every bid',
        'Members read products in their commerce orders',
        'Product managers read scoped products',
        'Members read their own profile',
        'Owners read all profiles',
        'Employees read pending shipping requests',
        'Members read their shipping requests and staff read all',
        'Employees read pending shipping items',
        'Members read their shipping items and staff read all'
      )
  ) then
    raise exception 'superseded permissive policies still exist';
  end if;

  select count(*)
  into duplicate_policy_count
  from (
    select tablename
    from pg_policies
    where schemaname = 'public'
      and cmd = 'SELECT'
      and 'authenticated' = any(roles)
      and tablename in (
        'auction_bids',
        'products',
        'profiles',
        'shipping_requests',
        'shipping_request_items'
      )
    group by tablename
    having count(*) > 1
  ) as duplicate_tables;

  if duplicate_policy_count <> 0 then
    raise exception 'target tables still have duplicate authenticated SELECT policies';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'commerce_orders',
        'commerce_order_items',
        'commerce_order_transfers',
        'manual_transfer_payment_ledger',
        'shipping_credit_ledger',
        'shipping_fee_payments',
        'wishlist_items'
      )
      and (
        regexp_replace(
          coalesce(qual, ''),
          '\(\s*SELECT\s+auth[.]uid[(][)](\s+AS\s+uid)?\s*\)',
          '',
          'gi'
        ) ~ 'auth[.]uid[(][)]'
        or regexp_replace(
          coalesce(with_check, ''),
          '\(\s*SELECT\s+auth[.]uid[(][)](\s+AS\s+uid)?\s*\)',
          '',
          'gi'
        ) ~ 'auth[.]uid[(][)]'
      )
  ) then
    raise exception 'target policy still evaluates auth.uid per row';
  end if;
end;
$$;

set role anon;
select count(*) from public.get_public_sold_feed_products('auction', 10, 0);
select count(*) from public.get_public_sold_auctions(10, null, null, null);
select count(*) from public.get_public_sold_product(null);
select count(*) from public.get_public_sold_brands();
select public.get_auction_server_time() is not null;
reset role;
