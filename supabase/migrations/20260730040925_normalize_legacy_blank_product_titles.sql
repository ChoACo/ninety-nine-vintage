begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- The title constraint added in 20260730000920 is intentionally NOT VALID so
-- legacy rows stay readable. PostgreSQL still checks it on every later UPDATE,
-- including the sale-completion timestamp written by inventory projection.
-- Give those legacy rows a deterministic storefront title before validating.
update public.products
set title = left(
  coalesce(
    nullif(btrim(description), ''),
    nullif(btrim(brand), ''),
    '이름 미등록 상품 ' || left(id::text, 8)
  ),
  160
)
where nullif(btrim(title), '') is null;

alter table public.products
  validate constraint products_title_length_check;

comment on constraint products_title_length_check on public.products is
  'Every product has a 1-160 character storefront title; legacy blank rows were normalized before validation.';

commit;
