-- Product-management writes must retain the authenticated actor all the way to
-- the database. Store ownership, state transitions, and optimistic concurrency
-- are therefore enforced here under row lock rather than by a service-role API.

create or replace function public.can_manage_product_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case public.access_role_for_user(auth.uid())
      when 'owner' then true
      when 'operator' then exists (
        select 1
        from public.stores as stores
        where stores.id = p_store_id
          and stores.operator_id = auth.uid()
          and stores.is_active
      )
      when 'employee' then exists (
        select 1
        from public.stores as stores
        join public.account_access_roles as employee_roles
          on employee_roles.user_id = auth.uid()
          and employee_roles.role_code = 'employee'
          and employee_roles.reports_to_operator_id = stores.operator_id
        where stores.id = p_store_id
          and stores.is_active
      )
      else false
    end,
    false
  );
$$;

revoke all on function public.can_manage_product_store(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.can_manage_product_store(uuid)
to authenticated;

comment on function public.can_manage_product_store(uuid) is
  'Owner manages every store; operators manage their store; employees inherit their reporting operator store';

-- Repair rows written through the former operator GET -> form -> PATCH loop.
-- Only Supabase public render URLs are rewritten; unrelated external URLs stay
-- byte-for-byte unchanged. Render query parameters are not part of an object
-- URL and are deliberately removed while preserving image order.
update public.products as products
set
  image_urls = coalesce((
    select array_agg(
      case
        when images.url like '%/storage/v1/render/image/public/%'
          then replace(
            split_part(images.url, '?', 1),
            '/storage/v1/render/image/public/',
            '/storage/v1/object/public/'
          )
        else images.url
      end
      order by images.position
    )
    from unnest(products.image_urls) with ordinality as images(url, position)
  ), products.image_urls),
  thumbnail_urls = coalesce((
    select array_agg(
      case
        when thumbnails.url like '%/storage/v1/render/image/public/%'
          then replace(
            split_part(thumbnails.url, '?', 1),
            '/storage/v1/render/image/public/',
            '/storage/v1/object/public/'
          )
        else thumbnails.url
      end
      order by thumbnails.position
    )
    from unnest(products.thumbnail_urls) with ordinality as thumbnails(url, position)
  ), products.thumbnail_urls)
where exists (
  select 1
  from unnest(products.image_urls || products.thumbnail_urls) as stored(url)
  where stored.url like '%/storage/v1/render/image/public/%'
);

-- Pending management rows are private to the responsible store team. The
-- separate public policy continues to expose only published catalog products.
drop policy if exists "Staff read every product" on public.products;
drop policy if exists "Product managers read scoped products" on public.products;
create policy "Product managers read scoped products"
on public.products
for select
to authenticated
using ((select public.can_manage_product_store(store_id)));

-- Every operator-created product starts in the review queue. Publication stays
-- behind publish_pending_products_now(), and an authenticated caller can insert
-- only into a store they are allowed to manage.
drop policy if exists "Staff insert products" on public.products;
create policy "Staff insert products"
on public.products
for insert
to authenticated
with check (
  (select public.can_manage_products())
  and store_id is not null
  and (select public.can_manage_product_store(store_id))
  and exists (
    select 1
    from public.stores as stores
    where stores.id = store_id
      and stores.is_active
  )
  and created_by = (select public.current_owner_delegated_operator())
  and updated_by = (select public.current_owner_delegated_operator())
  and status = 'pending'
  and participant_count = 0
  and current_price = starting_price
  and bid_history = '[]'::jsonb
  and bid_locked_at is null
  and final_bid_id is null
  and final_bid_amount is null
  and anti_sniping_extension_count = 0
  and anti_sniping_base_closes_at is null
  and anti_sniping_extended_at is null
  and cardinality(image_urls) between 1 and 12
  and cardinality(thumbnail_urls) = cardinality(image_urls)
  and not exists (
    select 1
    from unnest(image_urls || thumbnail_urls) as images(url)
    where images.url is null
      or char_length(images.url) > 4096
      or images.url !~* '^https?://'
      or images.url ~* '/storage/v1/render/image/public/'
  )
  and (
    (sale_type = 'auction' and fixed_price is null)
    or (
      sale_type = 'fixed'
      and fixed_price between 1 and 1000000000
      and starting_price = fixed_price
      and current_price = fixed_price
    )
  )
);

-- Switching a pending row between fixed and auction is itself a scheduling
-- change. The previous trigger only watched status/publish_at and could leave a
-- fixed-product sentinel deadline or a stale feed-expiry value behind.
create or replace function public.normalize_auction_drop_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_at timestamptz;
begin
  if new.sale_type = 'auction' then
    if tg_op = 'INSERT' or (
      new.status = 'pending'
      and (
        old.sale_type is distinct from new.sale_type
        or old.status is distinct from new.status
        or old.publish_at is distinct from new.publish_at
      )
    ) then
      v_requested_at := coalesce(new.publish_at, clock_timestamp());
      new.publish_at := public.next_auction_drop_at(v_requested_at);
      new.closes_at := public.auction_close_at(new.publish_at);
      new.auction_feed_expires_at := new.publish_at + interval '7 days';
    elsif new.status = 'pending' and new.closes_at is distinct from old.closes_at then
      new.closes_at := public.auction_close_at(new.publish_at);
      new.auction_feed_expires_at := new.publish_at + interval '7 days';
    elsif new.auction_feed_expires_at is null then
      new.auction_feed_expires_at := new.publish_at + interval '7 days';
    end if;
  elsif tg_op = 'INSERT' or new.sale_type = 'fixed' then
    new.auction_feed_expires_at := null;
    new.past_at := null;
    new.past_expires_at := null;
    new.past_action := null;
    new.closes_at := timestamptz '9999-12-31 23:59:59+00';
  end if;

  return new;
end;
$$;

revoke all on function public.normalize_auction_drop_schedule()
from public, anon, authenticated, service_role;

-- The legacy eight-argument function cannot carry the current product fields
-- and previously lacked store ownership. Keep the signature for migration
-- compatibility but remove direct application access.
revoke all on function public.update_managed_product(
  uuid, text, text, bigint, bigint, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

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
  v_role text := coalesce(public.access_role_for_user(v_actor), '');
  v_product public.products%rowtype;
  v_brand_slug text;
  v_publish_at timestamptz;
  v_closes_at timestamptz;
begin
  if v_actor is null or v_role not in ('owner', 'operator') then
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
  if not public.can_manage_product_store(v_product.store_id) then
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
    or not public.can_manage_product_store(p_store_id)
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
      message = '상품 검수 메모를 확인해 주세요.';
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
  'Row-locked, optimistic, store-scoped full editor for pending operator products';

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
  v_role text := coalesce(public.access_role_for_user(v_actor), '');
  v_product public.products%rowtype;
  v_storage_urls text[];
begin
  if v_actor is null or v_role not in ('owner', 'operator') then
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
  if not public.can_manage_product_store(v_product.store_id) then
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
  'Row-locked, optimistic, store-scoped deletion for pending products without bid history';
