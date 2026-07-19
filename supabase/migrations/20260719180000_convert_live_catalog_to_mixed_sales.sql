-- Convert the existing active catalog into a real mixed-sale catalog.
-- Stable odd/even ranking keeps half of the existing rows as auctions and
-- converts the other half to fixed-price products without inserting fixtures.

do $$
declare
  v_operator record;
begin
  for v_operator in
    select distinct coalesce(products.inquiry_operator_id, products.created_by) as operator_id
    from public.products as products
    where coalesce(products.inquiry_operator_id, products.created_by) is not null
  loop
    insert into public.stores (slug, name, description, operator_id)
    values (
      'operator-' || left(v_operator.operator_id::text, 8),
      'NINETY-NINE / ' || upper(left(v_operator.operator_id::text, 8)),
      'NINETY-NINE VINTAGE 큐레이션 숍',
      v_operator.operator_id
    )
    on conflict (slug) do nothing;
  end loop;
end;
$$;

update public.products as products
set store_id = stores.id
from public.stores as stores
where products.store_id is null
  and stores.operator_id = coalesce(products.inquiry_operator_id, products.created_by);

with ranked as (
  select
    products.id,
    row_number() over (order by products.created_at, products.id) as row_number
  from public.products as products
  where products.status = 'active'
), converted as (
  select id, (row_number % 2 = 0) as make_fixed
  from ranked
)
update public.products as products
set
  sale_type = case when converted.make_fixed then 'fixed' else 'auction' end,
  fixed_price = case when converted.make_fixed then products.current_price else null end,
  starting_price = case when converted.make_fixed then products.current_price else products.starting_price end,
  participant_count = case when converted.make_fixed then 0 else products.participant_count end,
  bid_history = case when converted.make_fixed then '[]'::jsonb else products.bid_history end,
  bid_locked_at = case when converted.make_fixed then null else products.bid_locked_at end,
  final_bid_id = case when converted.make_fixed then null else products.final_bid_id end,
  final_bid_amount = case when converted.make_fixed then null else products.final_bid_amount end,
  anti_sniping_base_closes_at = case when converted.make_fixed then null else products.anti_sniping_base_closes_at end,
  anti_sniping_extended_at = case when converted.make_fixed then null else products.anti_sniping_extended_at end,
  anti_sniping_extension_count = case when converted.make_fixed then 0 else products.anti_sniping_extension_count end,
  closes_at = case when converted.make_fixed then '9999-12-31 23:59:59+00'::timestamptz else products.closes_at end,
  updated_at = now()
from converted
where products.id = converted.id;

comment on table public.products is
  'Live NINETY-NINE VINTAGE catalog. Active rows are intentionally mixed between auction and fixed-price sales.';
