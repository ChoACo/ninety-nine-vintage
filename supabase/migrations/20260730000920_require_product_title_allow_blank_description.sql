begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Keep legacy blank-title rows readable while enforcing the storefront
-- headline requirement for every future insert or updated product row.
alter table public.products
  drop constraint if exists products_title_length_check;

alter table public.products
  add constraint products_title_length_check
  check (char_length(btrim(title)) between 1 and 160)
  not valid;

-- A single-product description is optional. Empty descriptions remain explicit
-- empty strings so existing readers do not need nullable handling.
alter table public.products
  drop constraint if exists products_description_length_check;

alter table public.products
  add constraint products_description_length_check
  check (char_length(btrim(description)) between 0 and 10000);

comment on constraint products_title_length_check on public.products is
  'New and updated products require a 1-160 character storefront title; legacy blank titles remain readable until edited.';

comment on constraint products_description_length_check on public.products is
  'Product descriptions may be blank and are limited to 10000 trimmed characters.';

commit;
