-- Product publication is a store permission, not an approval workflow.
-- Keep legacy pending rows as explicit drafts, while allowing every actor with
-- publish_products on the origin store to publish immediately.

create or replace function public.publish_pending_products_now(
  p_product_ids uuid[]
)
returns table (
  requested_count integer,
  published_count integer,
  skipped_count integer,
  published_ids uuid[],
  skipped_ids uuid[],
  published_at timestamptz,
  closes_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_ids uuid[];
  v_published_ids uuid[] := '{}'::uuid[];
  v_skipped_ids uuid[] := '{}'::uuid[];
  v_auction_closes_at timestamptz := public.auction_close_at(v_now);
begin
  if v_actor is null then
    raise exception using
      errcode = '42501',
      message = '상품 공개 권한이 필요합니다.';
  end if;

  if p_product_ids is null
    or cardinality(p_product_ids) = 0
    or cardinality(p_product_ids) > 200
  then
    raise exception using
      errcode = '22023',
      message = '공개할 상품을 1~200개 선택해 주세요.';
  end if;

  select coalesce(
    array_agg(input.product_id order by input.first_position),
    '{}'::uuid[]
  )
  into v_ids
  from (
    select values_with_position.product_id,
      min(values_with_position.position) as first_position
    from unnest(p_product_ids) with ordinality
      as values_with_position(product_id, position)
    where values_with_position.product_id is not null
    group by values_with_position.product_id
  ) as input;

  if cardinality(v_ids) = 0 then
    raise exception using
      errcode = '22023',
      message = '공개할 상품 ID를 확인해 주세요.';
  end if;

  with published as (
    update public.products as products
    set
      status = 'active',
      publish_at = v_now,
      closes_at = case
        when products.sale_type = 'auction' then v_auction_closes_at
        else timestamptz '9999-12-31 23:59:59+00'
      end,
      auction_feed_expires_at = case
        when products.sale_type = 'auction' then v_now + interval '7 days'
        else null
      end,
      updated_by = v_actor
    where products.id = any(v_ids)
      and products.status = 'pending'
      and public.has_store_permission(products.store_id, 'publish_products')
    returning products.id
  )
  select coalesce(array_agg(published.id order by published.id), '{}'::uuid[])
  into v_published_ids
  from published;

  select coalesce(
    array_agg(requested.id order by requested.position),
    '{}'::uuid[]
  )
  into v_skipped_ids
  from unnest(v_ids) with ordinality as requested(id, position)
  where not (requested.id = any(v_published_ids));

  return query select
    cardinality(v_ids),
    cardinality(v_published_ids),
    cardinality(v_skipped_ids),
    v_published_ids,
    v_skipped_ids,
    v_now,
    v_auction_closes_at;
end;
$$;

revoke all on function public.publish_pending_products_now(uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.publish_pending_products_now(uuid[])
to authenticated;

comment on function public.publish_pending_products_now(uuid[]) is
  'Publishes drafts immediately for Owner or an active store member with publish_products; there is no approval actor.';

-- Product drafting is governed by manage_products at the same store boundary.
-- The previous definitions repeated an owner/operator role gate before checking
-- that permission, which prevented an explicitly permissioned employee from
-- editing or deleting the draft they were allowed to create.

create or replace function public.update_operator_product(
  p_product_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_description text,
  p_category text,
  p_brand text,
  p_store_id uuid,
  p_sale_type text,
  p_starting_price bigint,
  p_bid_increment bigint,
  p_publish_at timestamptz,
  p_image_urls text[],
  p_thumbnail_urls text[],
  p_size_label text,
  p_condition_grade text,
  p_storage_class text,
  p_measurements jsonb,
  p_inspection_notes text[]
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products%rowtype;
  v_brand_slug text;
  v_publish_at timestamptz;
  v_closes_at timestamptz;
begin
  if v_actor is null then
    raise exception using
      errcode = '42501',
      message = '상품 관리 권한이 필요합니다.';
  end if;
  if p_product_id is null or p_expected_updated_at is null then
    raise exception using
      errcode = '22023',
      message = '상품과 수정 버전을 확인해 주세요.';
  end if;

  select products.*
  into v_product
  from public.products as products
  where products.id = p_product_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '상품을 찾을 수 없습니다.';
  end if;
  if not public.has_store_permission(v_product.store_id, 'manage_products') then
    raise exception using
      errcode = '42501',
      message = '다른 숍의 상품은 수정할 수 없습니다.';
  end if;
  if v_product.updated_at <> p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = '다른 운영자가 먼저 수정했습니다. 목록을 새로고침해 주세요.';
  end if;
  if v_product.status = 'closed' then
    raise exception using
      errcode = 'P0001',
      message = '마감된 상품 기록은 일반 편집기로 변경할 수 없습니다.';
  end if;
  if v_product.status <> 'pending' then
    raise exception using
      errcode = 'P0001',
      message = '공개 중인 상품은 전용 운영 절차로만 변경할 수 있습니다.';
  end if;
  if v_product.participant_count <> 0
    or v_product.final_bid_id is not null
    or exists (
      select 1
      from public.auction_bids as bids
      where bids.product_id = p_product_id
    )
  then
    raise exception using
      errcode = 'P0001',
      message = '입찰 기록이 있는 상품은 일반 편집기로 변경할 수 없습니다.';
  end if;

  if p_store_id is null
    or not public.has_store_permission(p_store_id, 'manage_products')
    or not exists (
      select 1
      from public.stores as stores
      where stores.id = p_store_id
        and stores.is_active
    )
  then
    raise exception using
      errcode = '42501',
      message = '상품을 등록할 숍 권한을 확인해 주세요.';
  end if;

  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 160
    or char_length(btrim(coalesce(p_description, ''))) not between 1 and 10000
    or char_length(btrim(coalesce(p_category, ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_brand, ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_size_label, ''))) > 80
    or p_sale_type is null
    or p_sale_type not in ('auction', 'fixed')
    or p_starting_price is null
    or p_starting_price not between 1 and 1000000000
    or p_bid_increment is null
    or p_bid_increment not between 1 and 100000000
    or p_publish_at is null
    or p_condition_grade is null
    or p_condition_grade not in ('S', 'A+', 'A', 'B')
    or p_storage_class is null
    or p_storage_class not in ('small', 'large')
    or p_image_urls is null
    or cardinality(p_image_urls) < 1
    or cardinality(p_image_urls) > 12
    or p_thumbnail_urls is null
    or cardinality(p_thumbnail_urls) < 1
    or cardinality(p_thumbnail_urls) <> cardinality(p_image_urls)
    or p_measurements is null
    or jsonb_typeof(p_measurements) <> 'object'
    or p_inspection_notes is null
  then
    raise exception using
      errcode = '22023',
      message = '상품 수정 값을 확인해 주세요.';
  end if;

  if exists (
    select 1
    from unnest(p_image_urls || p_thumbnail_urls) as images(url)
    where images.url is null
      or char_length(images.url) > 4096
      or images.url !~* '^https?://'
      or images.url ~* '/storage/v1/render/image/public/'
  ) then
    raise exception using
      errcode = '22023',
      message = '상품 이미지 URL을 확인해 주세요.';
  end if;

  if exists (
    select 1
    from jsonb_each(p_measurements) as measurements(key, value)
    where measurements.key not in ('shoulder', 'chest', 'sleeve', 'length')
      or case
        when jsonb_typeof(measurements.value) = 'number'
          then (measurements.value #>> '{}')::numeric <= 0
        else true
      end
  ) then
    raise exception using
      errcode = '22023',
      message = '상품 실측값을 확인해 주세요.';
  end if;

  if cardinality(p_inspection_notes) > 30
    or exists (
      select 1
      from unnest(p_inspection_notes) as notes(note)
      where notes.note is null
        or char_length(btrim(notes.note)) not between 1 and 500
    )
  then
    raise exception using
      errcode = '22023',
      message = '상태·하자 메모를 확인해 주세요.';
  end if;

  v_brand_slug := coalesce(
    nullif(
      trim(both '-' from regexp_replace(lower(btrim(p_brand)), '[^[:alnum:]]+', '-', 'g')),
      ''
    ),
    'etc'
  );
  v_publish_at := p_publish_at;
  v_closes_at := case
    when p_sale_type = 'auction' then public.auction_close_at(v_publish_at)
    else timestamptz '9999-12-31 23:59:59+00'
  end;

  update public.products
  set
    title = btrim(p_title),
    description = btrim(p_description),
    category = btrim(p_category),
    brand = btrim(p_brand),
    brand_slug = v_brand_slug,
    brand_source = 'explicit',
    store_id = p_store_id,
    sale_type = p_sale_type,
    starting_price = p_starting_price,
    current_price = p_starting_price,
    fixed_price = case when p_sale_type = 'fixed' then p_starting_price else null end,
    bid_increment = p_bid_increment,
    publish_at = v_publish_at,
    closes_at = v_closes_at,
    auction_feed_expires_at = case
      when p_sale_type = 'auction' then v_publish_at + interval '7 days'
      else null
    end,
    image_urls = p_image_urls,
    thumbnail_urls = p_thumbnail_urls,
    size_label = btrim(p_size_label),
    condition_grade = p_condition_grade,
    storage_class = p_storage_class,
    measurements = p_measurements,
    inspection_notes = p_inspection_notes,
    updated_by = v_actor
  where id = p_product_id;

  return query
  select products.*
  from public.products as products
  where products.id = p_product_id;
end;
$$;

revoke all on function public.update_operator_product(
  uuid, timestamptz, text, text, text, text, uuid, text, bigint, bigint,
  timestamptz, text[], text[], text, text, text, jsonb, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.update_operator_product(
  uuid, timestamptz, text, text, text, text, uuid, text, bigint, bigint,
  timestamptz, text[], text[], text, text, text, jsonb, text[]
) to authenticated;

comment on function public.update_operator_product(
  uuid, timestamptz, text, text, text, text, uuid, text, bigint, bigint,
  timestamptz, text[], text[], text, text, text, jsonb, text[]
) is
  'Row-locked, optimistic, manage_products-scoped full editor for pending products';

create or replace function public.delete_managed_product(
  p_product_id uuid,
  p_expected_updated_at timestamptz
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products%rowtype;
  v_storage_urls text[];
begin
  if v_actor is null then
    raise exception using
      errcode = '42501',
      message = '상품 관리 권한이 필요합니다.';
  end if;
  if p_product_id is null or p_expected_updated_at is null then
    raise exception using
      errcode = '22023',
      message = '상품과 수정 버전을 확인해 주세요.';
  end if;

  select products.*
  into v_product
  from public.products as products
  where products.id = p_product_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '삭제할 상품을 찾을 수 없습니다.';
  end if;
  if not public.has_store_permission(v_product.store_id, 'manage_products') then
    raise exception using
      errcode = '42501',
      message = '다른 숍의 상품은 삭제할 수 없습니다.';
  end if;
  if v_product.updated_at <> p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = '다른 운영자가 먼저 수정했습니다. 목록을 새로고침해 주세요.';
  end if;
  if v_product.status <> 'pending' then
    raise exception using
      errcode = 'P0001',
      message = '공개 또는 마감된 상품은 삭제할 수 없습니다.';
  end if;
  if v_product.participant_count <> 0
    or v_product.final_bid_id is not null
    or exists (
      select 1
      from public.auction_bids as bids
      where bids.product_id = p_product_id
    )
  then
    raise exception using
      errcode = 'P0001',
      message = '입찰 기록이 있는 상품은 삭제할 수 없습니다.';
  end if;

  select coalesce(array_agg(distinct storage_url), '{}'::text[])
  into v_storage_urls
  from unnest(v_product.image_urls || v_product.thumbnail_urls) as storage_url
  where nullif(btrim(storage_url), '') is not null;

  delete from public.products
  where id = p_product_id;

  return v_storage_urls;
end;
$$;

revoke all on function public.delete_managed_product(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.delete_managed_product(uuid, timestamptz)
to authenticated;

comment on function public.delete_managed_product(uuid, timestamptz) is
  'Row-locked, optimistic, manage_products-scoped deletion for pending products without bid history';
