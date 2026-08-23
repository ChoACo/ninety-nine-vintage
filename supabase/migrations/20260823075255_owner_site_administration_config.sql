begin;

create table if not exists public.platform_config (
  config_key text primary key default 'default' check (config_key = 'default'),
  global_delivery_fee bigint not null default 4000
    check (global_delivery_fee between 0 and 100000),
  storage_duration_days integer not null default 14
    check (storage_duration_days between 1 and 90),
  home_sections jsonb not null default '{"featuredAuction":true,"centerMall":true,"archiveShop":true}'::jsonb
    check (jsonb_typeof(home_sections) = 'object'),
  banners jsonb not null default '[]'::jsonb
    check (jsonb_typeof(banners) = 'array' and jsonb_array_length(banners) <= 20),
  policy_markdown text not null default '',
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.platform_config (config_key)
values ('default')
on conflict (config_key) do nothing;

alter table public.platform_config enable row level security;
alter table public.platform_config force row level security;

drop policy if exists "Public reads platform config" on public.platform_config;
create policy "Public reads platform config"
on public.platform_config for select
to anon, authenticated
using (config_key = 'default');

revoke all on table public.platform_config from public, anon, authenticated;
grant select on table public.platform_config to anon, authenticated;

create or replace function public.update_owner_platform_config(
  p_global_delivery_fee bigint,
  p_storage_duration_days integer,
  p_home_sections jsonb,
  p_banners jsonb,
  p_policy_markdown text,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_current public.platform_config%rowtype;
  v_next public.platform_config%rowtype;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_global_delivery_fee not between 0 and 100000
    or p_storage_duration_days not between 1 and 90
    or jsonb_typeof(p_home_sections) <> 'object'
    or jsonb_typeof(p_banners) <> 'array'
    or jsonb_array_length(p_banners) > 20
    or char_length(coalesce(p_policy_markdown, '')) > 20000
    or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500
  then
    raise exception using errcode = '22023', message = '플랫폼 설정 값을 확인해 주세요.';
  end if;

  select * into strict v_current
  from public.platform_config
  where config_key = 'default'
  for update;

  if v_current.version <> p_expected_version then
    raise exception using errcode = '40001', message = '플랫폼 설정이 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;

  update public.stores
  set regular_shipping_fee = p_global_delivery_fee,
      updated_at = clock_timestamp()
  where regular_shipping_fee is null
     or regular_shipping_fee = v_current.global_delivery_fee;

  update public.store_enterprise_profiles
  set small_storage_days = p_storage_duration_days,
      updated_at = clock_timestamp()
  where small_storage_days = v_current.storage_duration_days;

  update public.platform_config
  set global_delivery_fee = p_global_delivery_fee,
      storage_duration_days = p_storage_duration_days,
      home_sections = p_home_sections,
      banners = p_banners,
      policy_markdown = p_policy_markdown,
      version = version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where config_key = 'default'
  returning * into strict v_next;

  insert into public.security_activity_logs (
    actor_user_id, category, event_type, action, source,
    entity_type, entity_id, severity, metadata
  ) values (
    v_actor, 'owner', 'platform_config', 'config_changed', 'owner_workspace',
    'platform_config', null, 'notice',
    jsonb_build_object(
      'reason', btrim(p_reason),
      'beforeVersion', v_current.version,
      'afterVersion', v_next.version,
      'globalDeliveryFee', p_global_delivery_fee,
      'storageDurationDays', p_storage_duration_days
    )
  );

  return to_jsonb(v_next) - 'updated_by';
end;
$$;

revoke all on function public.update_owner_platform_config(bigint,integer,jsonb,jsonb,text,integer,text)
from public, anon, authenticated, service_role;
grant execute on function public.update_owner_platform_config(bigint,integer,jsonb,jsonb,text,integer,text)
to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'platform-content',
  'platform-content',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public reads platform content" on storage.objects;
create policy "Public reads platform content"
on storage.objects for select
to public
using (bucket_id = 'platform-content');

drop policy if exists "Owner uploads platform content" on storage.objects;
create policy "Owner uploads platform content"
on storage.objects for insert
to authenticated
with check (bucket_id = 'platform-content' and (select public.is_owner()));

drop policy if exists "Owner updates platform content" on storage.objects;
create policy "Owner updates platform content"
on storage.objects for update
to authenticated
using (bucket_id = 'platform-content' and (select public.is_owner()))
with check (bucket_id = 'platform-content' and (select public.is_owner()));

drop policy if exists "Owner deletes platform content" on storage.objects;
create policy "Owner deletes platform content"
on storage.objects for delete
to authenticated
using (bucket_id = 'platform-content' and (select public.is_owner()));

create or replace function public.quote_commerce_shipping_fee(
  p_product_ids uuid[], p_shipping_region text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_requested integer;
  v_valid integer;
  v_products bigint;
  v_shipping bigint;
  v_charges jsonb;
  v_missing boolean;
  v_default_delivery_fee bigint;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='로그인이 필요합니다.'; end if;
  if p_shipping_region not in ('regular','remote_area') then
    raise exception using errcode='22023',message='배송 지역 구분을 확인해 주세요.';
  end if;
  select global_delivery_fee into strict v_default_delivery_fee
  from public.platform_config where config_key = 'default';
  v_requested:=coalesce(array_length(p_product_ids,1),0);
  if v_requested=0 or v_requested>50 or v_requested<>(select count(distinct value) from unnest(p_product_ids) value)
  then raise exception using errcode='22023',message='배송비 견적 상품을 확인해 주세요.'; end if;
  select count(*)::integer,sum(current_price)::bigint into v_valid,v_products from public.products
  where id=any(p_product_ids) and sale_type='fixed' and status='active'
    and publish_at<=clock_timestamp() and public.can_purchase_product(id);
  if v_valid<>v_requested then raise exception using errcode='42501',message='구매할 수 없는 센터 상품이 포함되어 있습니다.'; end if;
  with scoped as (
    select p.id product_id,p.title,p.current_price,s.id store_id,s.name store_name,
      case when p_shipping_region='remote_area' then s.remote_area_shipping_fee
        else coalesce(s.regular_shipping_fee,v_default_delivery_fee) end amount
    from public.products p join public.stores s on s.id=p.store_id where p.id=any(p_product_ids)
  ), charges as (
    select 'store:'||store_id::text charge_key,store_id billing_store_id,max(store_name) unit_name,max(amount) amount,
      sum(current_price)::bigint product_subtotal,
      jsonb_agg(product_id order by product_id) product_ids,
      jsonb_agg(jsonb_build_object('id',product_id,'title',title,'amount',current_price) order by product_id) products
    from scoped group by store_id
  )
  select coalesce(sum(amount),0),coalesce(bool_or(amount is null),true),coalesce(jsonb_agg(jsonb_build_object(
    'chargeKey',charge_key,'mode','per_store','unitKind','store','unitName',unit_name,
    'billingStoreId',billing_store_id,'billingStoreName',unit_name,'amount',amount,
    'productSubtotal',product_subtotal,'storeIds',jsonb_build_array(billing_store_id),
    'storeNames',jsonb_build_array(unit_name),'productIds',product_ids,'products',products,
    'shippingRegion',p_shipping_region) order by charge_key),'[]'::jsonb)
  into v_shipping,v_missing,v_charges from charges;
  if v_missing or v_shipping<1 then raise exception using errcode='55000',message='센터의 일반·제주 및 도서산간 택배비 설정을 확인해 주세요.'; end if;
  return jsonb_build_object('productSubtotal',v_products,'shippingFee',v_shipping,'total',v_products+v_shipping,
    'shippingRegion',p_shipping_region,'chargeCount',jsonb_array_length(v_charges),'charges',v_charges);
end;
$$;

revoke all on function public.quote_commerce_shipping_fee(uuid[],text)
from public,anon,service_role;
grant execute on function public.quote_commerce_shipping_fee(uuid[],text) to authenticated;

commit;
