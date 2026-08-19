-- Center mall presentation: a short mall info blurb and an optional header
-- image per store, edited from the operator platform (매장 설정) and surfaced on
-- the home page center-mall grid.

begin;

alter table public.stores
  add column if not exists mall_info text,
  add column if not exists mall_image text;

-- The storefront navigator reads only public presentation fields. A previous
-- hardening migration intentionally revoked table-wide access, so explicitly
-- extend its column-level grant without exposing operator or business fields.
grant select (
  id,
  slug,
  name,
  description,
  is_active,
  mall_info,
  mall_image
) on table public.stores to anon, authenticated;

alter table public.stores
  add constraint stores_mall_info_length_check
    check (mall_info is null or char_length(mall_info) between 1 and 200),
  add constraint stores_mall_image_length_check
    check (mall_image is null or char_length(mall_image) between 1 and 500);

create or replace function public.configure_store_mall(
  p_store_id uuid,
  p_mall_info text,
  p_mall_image text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_store public.stores%rowtype;
begin
  if auth.uid() is null or not (
    public.is_owner()
    or public.has_store_permission(p_store_id, 'manage_products')
  ) then
    raise exception using errcode = '42501', message = '센터몰 정보 설정 권한이 없습니다.';
  end if;
  if p_mall_info is not null and char_length(p_mall_info) not between 1 and 200 then
    raise exception using errcode = '22023', message = '센터몰 정보는 200자 이하로 입력해 주세요.';
  end if;
  if p_mall_image is not null and char_length(p_mall_image) not between 1 and 500 then
    raise exception using errcode = '22023', message = '센터몰 이미지 주소를 확인해 주세요.';
  end if;
  update public.stores set
    mall_info = p_mall_info,
    mall_image = p_mall_image,
    updated_at = clock_timestamp()
  where id = p_store_id and is_active
  returning * into v_store;
  if not found then
    raise exception using errcode = 'P0002', message = '설정할 센터를 찾지 못했습니다.';
  end if;
  return jsonb_build_object(
    'storeId', v_store.id,
    'mallInfo', v_store.mall_info,
    'mallImage', v_store.mall_image
  );
end;
$$;

revoke all on function public.configure_store_mall(uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.configure_store_mall(uuid, text, text)
to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'store-mall-images',
  'store-mall-images',
  true,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public reads store mall images" on storage.objects;
create policy "Public reads store mall images"
on storage.objects
for select
to public
using (bucket_id = 'store-mall-images');

drop policy if exists "Store staff upload store mall images" on storage.objects;
create policy "Store staff upload store mall images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'store-mall-images'
  and (
    (select public.is_admin())
    or (
      coalesce((storage.foldername(name))[1], '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and public.has_store_permission((storage.foldername(name))[1]::uuid, 'manage_products')
    )
  )
);

drop policy if exists "Store staff update store mall images" on storage.objects;
create policy "Store staff update store mall images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'store-mall-images'
  and (
    (select public.is_admin())
    or (
      coalesce((storage.foldername(name))[1], '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and public.has_store_permission((storage.foldername(name))[1]::uuid, 'manage_products')
    )
  )
)
with check (
  bucket_id = 'store-mall-images'
  and (
    (select public.is_admin())
    or (
      coalesce((storage.foldername(name))[1], '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and public.has_store_permission((storage.foldername(name))[1]::uuid, 'manage_products')
    )
  )
);

drop policy if exists "Store staff delete store mall images" on storage.objects;
create policy "Store staff delete store mall images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'store-mall-images'
  and (
    (select public.is_admin())
    or (
      coalesce((storage.foldername(name))[1], '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and public.has_store_permission((storage.foldername(name))[1]::uuid, 'manage_products')
    )
  )
);

commit;
