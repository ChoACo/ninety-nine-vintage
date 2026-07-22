-- The operating model has two named stores.  Keep A's existing slug stable
-- for links, create B once, and make B the only seeded central-shipping
-- operator.  Further staff assignment remains owner-managed in the console.
do $$
begin
  if not exists (
    select 1 from public.account_access_roles
    where user_id = '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'
      and role_code = 'operator'
  ) or not exists (
    select 1 from public.account_access_roles
    where user_id = '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'
      and role_code = 'operator'
  ) then
    raise exception using errcode = '23514', message = 'A/B 매장 담당 운영자 계정을 확인할 수 없습니다.';
  end if;
end;
$$;

update public.stores
set
  name = '나인티 나인 빈티지',
  description = 'A 매장',
  updated_at = clock_timestamp()
where operator_id = '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee';

with business_scope as (
  select id from public.businesses order by id limit 1
)
insert into public.stores (
  slug, name, description, operator_id, business_id, is_active
)
select
  'dami-clothing-shop-b',
  '다미네 옷가게',
  'B 매장',
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  business_scope.id,
  true
from business_scope
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  operator_id = excluded.operator_id,
  is_active = true,
  updated_at = clock_timestamp();

with b_store as (
  select id, business_id
  from public.stores
  where slug = 'dami-clothing-shop-b'
), default_center as (
  select c.id, c.business_id
  from public.fulfillment_centers c
  join b_store s on s.business_id = c.business_id
  where c.is_default and c.status = 'active'
  order by c.id
  limit 1
)
insert into public.store_fulfillment_routes (
  business_id, store_id, fulfillment_center_id, route_mode, status
)
select b_store.business_id, b_store.id, default_center.id, 'co_located', 'active'
from b_store
join default_center on default_center.business_id = b_store.business_id
on conflict (store_id) do update
set
  fulfillment_center_id = excluded.fulfillment_center_id,
  route_mode = excluded.route_mode,
  status = 'active',
  version = public.store_fulfillment_routes.version + 1,
  updated_at = clock_timestamp();

with b_route as (
  select r.*
  from public.store_fulfillment_routes r
  join public.stores s on s.id = r.store_id
  where s.slug = 'dami-clothing-shop-b'
), owner_account as (
  select user_id
  from public.account_access_roles
  where role_code = 'owner'
  order by user_id
  limit 1
)
insert into public.store_fulfillment_route_events (
  route_id, sequence_no, event_type, actor_user_id, idempotency_key, reason, from_snapshot, to_snapshot
)
select
  b_route.id,
  1,
  'configured',
  owner_account.user_id,
  gen_random_uuid(),
  'B 매장 중앙 출고 경로 초기 등록',
  null,
  jsonb_build_object(
    'id', b_route.id,
    'storeId', b_route.store_id,
    'centerId', b_route.fulfillment_center_id,
    'routeMode', b_route.route_mode,
    'status', b_route.status,
    'version', b_route.version
  )
from b_route
cross join owner_account
where not exists (
  select 1 from public.store_fulfillment_route_events e where e.route_id = b_route.id
);

with default_center as (
  select id, business_id
  from public.fulfillment_centers
  where is_default and status = 'active'
  order by id
  limit 1
)
insert into public.fulfillment_center_staff_assignments (
  business_id, fulfillment_center_id, user_id, status, receive_at_center, create_shipments
)
select
  default_center.business_id,
  default_center.id,
  '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
  'active',
  true,
  true
from default_center
on conflict (fulfillment_center_id, user_id) do update
set
  status = 'active',
  receive_at_center = true,
  create_shipments = true,
  version = public.fulfillment_center_staff_assignments.version + 1,
  updated_at = clock_timestamp();
