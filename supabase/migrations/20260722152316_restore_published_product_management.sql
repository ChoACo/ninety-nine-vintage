-- Restore the operator workflow that can maintain a listing after publication.
-- Sale mechanics stay immutable once a product is public, while descriptive
-- fields and inspection notes remain correctable. Completed transaction
-- records and products with bid history remain immutable.

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
  v_pending_closes_at timestamptz;
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
  if v_product.status not in ('pending', 'active') then
    raise exception using
      errcode = 'P0001',
      message = '마감 또는 판매 완료된 상품 기록은 수정할 수 없습니다.';
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

  if v_product.status = 'active'
    and (
      p_store_id is distinct from v_product.store_id
      or p_sale_type is distinct from v_product.sale_type
      or p_starting_price is distinct from v_product.starting_price
      or p_bid_increment is distinct from v_product.bid_increment
      or p_publish_at is distinct from v_product.publish_at
    )
  then
    raise exception using
      errcode = 'P0001',
      message = '공개 중에는 숍·판매 방식·가격·입찰 단위·공개 시각을 변경할 수 없습니다.';
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
      message = '점검·하자 메모를 확인해 주세요.';
  end if;

  v_brand_slug := coalesce(
    nullif(
      trim(both '-' from regexp_replace(lower(btrim(p_brand)), '[^[:alnum:]]+', '-', 'g')),
      ''
    ),
    'etc'
  );
  v_pending_closes_at := case
    when p_sale_type = 'auction' then public.auction_close_at(p_publish_at)
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
    store_id = case when v_product.status = 'pending' then p_store_id else store_id end,
    sale_type = case when v_product.status = 'pending' then p_sale_type else sale_type end,
    starting_price = case when v_product.status = 'pending' then p_starting_price else starting_price end,
    current_price = case when v_product.status = 'pending' then p_starting_price else current_price end,
    fixed_price = case
      when v_product.status <> 'pending' then fixed_price
      when p_sale_type = 'fixed' then p_starting_price
      else null
    end,
    bid_increment = case when v_product.status = 'pending' then p_bid_increment else bid_increment end,
    publish_at = case when v_product.status = 'pending' then p_publish_at else publish_at end,
    closes_at = case when v_product.status = 'pending' then v_pending_closes_at else closes_at end,
    auction_feed_expires_at = case
      when v_product.status <> 'pending' then auction_feed_expires_at
      when p_sale_type = 'auction' then p_publish_at + interval '7 days'
      else null
    end,
    image_urls = p_image_urls,
    thumbnail_urls = p_thumbnail_urls,
    size_label = btrim(p_size_label),
    condition_grade = p_condition_grade,
    storage_class = p_storage_class,
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
  'Row-locked, optimistic listing editor for drafts and active products; active sale mechanics stay immutable';

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
  v_reference record;
  v_has_protected_reference boolean;
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
  if v_product.status not in ('pending', 'active') then
    raise exception using
      errcode = 'P0001',
      message = '마감 또는 판매 완료된 상품 기록은 삭제할 수 없습니다.';
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

  -- RESTRICT/NO ACTION constraints are transaction records that must survive
  -- product removal. Check them before DELETE because constraint triggers can
  -- report their error after the function's inner exception block completes.
  for v_reference in
    select
      pg_catalog.quote_ident(namespaces.nspname)
        || '.' || pg_catalog.quote_ident(relations.relname) as table_name,
      attributes.attname as column_name
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_class as relations
      on relations.oid = constraints.conrelid
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = relations.relnamespace
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = constraints.conrelid
      and attributes.attnum = constraints.conkey[1]
    where constraints.contype = 'f'
      and constraints.confrelid = 'public.products'::regclass
      and pg_catalog.array_length(constraints.conkey, 1) = 1
      and constraints.confdeltype in ('a', 'r')
  loop
    execute pg_catalog.format(
      'select exists (select 1 from %s where %I = $1)',
      v_reference.table_name,
      v_reference.column_name
    )
    into v_has_protected_reference
    using p_product_id;

    if v_has_protected_reference then
      raise exception using
        errcode = 'P0001',
        message = '주문·결제·배송 이력이 있는 상품은 삭제할 수 없습니다.';
    end if;
  end loop;

  select coalesce(array_agg(distinct storage_url), '{}'::text[])
  into v_storage_urls
  from unnest(v_product.image_urls || v_product.thumbnail_urls) as storage_url
  where nullif(btrim(storage_url), '') is not null;

  begin
    delete from public.products
    where id = p_product_id;
  exception
    when foreign_key_violation then
      raise exception using
        errcode = 'P0001',
        message = '주문·결제·배송 이력이 있는 상품은 삭제할 수 없습니다.';
  end;

  return v_storage_urls;
end;
$$;

revoke all on function public.delete_managed_product(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.delete_managed_product(uuid, timestamptz)
to authenticated;

comment on function public.delete_managed_product(uuid, timestamptz) is
  'Row-locked, optimistic deletion for draft or active products without bid, order, payment, or shipment history';
