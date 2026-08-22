begin;

alter table public.stores
  add column if not exists logo_url text,
  add column if not exists banner_url text,
  add column if not exists concept_tags text[] not null default '{}',
  add column if not exists default_courier text not null default 'CJ대한통운';

alter table public.store_enterprise_profiles
  add column if not exists mail_order_registration_number text,
  add column if not exists business_postal_code text,
  add column if not exists business_address text,
  add column if not exists business_address_detail text;

alter table public.stores
  add constraint stores_logo_url_length_check check (logo_url is null or char_length(logo_url) <= 500),
  add constraint stores_banner_url_length_check check (banner_url is null or char_length(banner_url) <= 500),
  add constraint stores_concept_tags_count_check check (cardinality(concept_tags) <= 8),
  add constraint stores_default_courier_check check (default_courier in ('CJ대한통운','우체국택배','로젠택배','한진택배','롯데택배'));

grant select (id,slug,name,description,is_active,mall_info,mall_image,logo_url,banner_url,concept_tags)
on table public.stores to anon, authenticated;

create or replace function public.save_operator_store_settings(
  p_store_id uuid,
  p_name text,
  p_bio text,
  p_logo_url text,
  p_banner_url text,
  p_concept_tags text[],
  p_representative_name text,
  p_business_registration_number text,
  p_mail_order_registration_number text,
  p_business_postal_code text,
  p_business_address text,
  p_business_address_detail text,
  p_default_courier text,
  p_regular_shipping_fee bigint,
  p_remote_area_shipping_fee bigint,
  p_bank_name text,
  p_account_holder text,
  p_account_number_ciphertext text,
  p_account_number_masked text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_business_number text := regexp_replace(coalesce(p_business_registration_number,''),'[^0-9]','','g');
  v_tags text[];
begin
  if v_actor is null or not (public.is_owner() or public.has_store_permission(p_store_id,'manage_store')) then
    raise exception using errcode='42501', message='매장 설정 권한이 없습니다.';
  end if;
  select coalesce(array_agg(distinct btrim(tag)) filter (where nullif(btrim(tag),'') is not null),'{}'::text[])
  into v_tags from unnest(coalesce(p_concept_tags,'{}'::text[])) tag;
  if char_length(btrim(coalesce(p_name,''))) not between 1 and 30
    or char_length(btrim(coalesce(p_bio,''))) > 300
    or cardinality(v_tags) > 8
    or exists(select 1 from unnest(v_tags) tag where char_length(tag) > 20)
    or v_business_number !~ '^[0-9]{10}$'
    or char_length(btrim(coalesce(p_representative_name,''))) not between 1 and 80
    or p_default_courier not in ('CJ대한통운','우체국택배','로젠택배','한진택배','롯데택배')
    or p_regular_shipping_fee < 0 or p_remote_area_shipping_fee < 0
  then raise exception using errcode='22023', message='매장 설정 입력값을 확인해 주세요.'; end if;

  update public.stores set
    name=btrim(p_name), description=coalesce(nullif(btrim(p_bio),''),''), mall_info=nullif(btrim(p_bio),''),
    logo_url=nullif(btrim(p_logo_url),''), banner_url=nullif(btrim(p_banner_url),''),
    mall_image=nullif(btrim(p_banner_url),''), concept_tags=v_tags,
    default_courier=p_default_courier, regular_shipping_fee=p_regular_shipping_fee,
    remote_area_shipping_fee=p_remote_area_shipping_fee, updated_at=clock_timestamp()
  where id=p_store_id and is_active;
  if not found then raise exception using errcode='P0002', message='설정할 센터를 찾지 못했습니다.'; end if;

  insert into public.store_enterprise_profiles(
    store_id,representative_name,business_registration_number,commission_rate,small_storage_days,large_storage_days,
    created_by,mail_order_registration_number,business_postal_code,business_address,business_address_detail
  ) values (
    p_store_id,btrim(p_representative_name),v_business_number,0.05,14,7,v_actor,
    nullif(btrim(p_mail_order_registration_number),''),nullif(btrim(p_business_postal_code),''),
    nullif(btrim(p_business_address),''),nullif(btrim(p_business_address_detail),'')
  ) on conflict(store_id) do update set
    representative_name=excluded.representative_name,
    business_registration_number=excluded.business_registration_number,
    mail_order_registration_number=excluded.mail_order_registration_number,
    business_postal_code=excluded.business_postal_code,
    business_address=excluded.business_address,
    business_address_detail=excluded.business_address_detail,
    updated_at=clock_timestamp();

  if nullif(btrim(coalesce(p_account_number_ciphertext,'')),'') is not null then
    if nullif(btrim(coalesce(p_bank_name,'')),'') is null
      or nullif(btrim(coalesce(p_account_holder,'')),'') is null
      or char_length(p_account_number_ciphertext) < 16
    then raise exception using errcode='22023', message='정산계좌 입력값을 확인해 주세요.'; end if;
    insert into public.store_payout_accounts(store_id,bank_name,account_holder,account_number_ciphertext,account_number_masked,status,submitted_by)
    values(p_store_id,btrim(p_bank_name),btrim(p_account_holder),p_account_number_ciphertext,p_account_number_masked,'pending',v_actor)
    on conflict(store_id) do update set bank_name=excluded.bank_name,account_holder=excluded.account_holder,
      account_number_ciphertext=excluded.account_number_ciphertext,account_number_masked=excluded.account_number_masked,
      status='pending',submitted_by=v_actor,approved_by=null,approved_at=null,
      version=public.store_payout_accounts.version+1,updated_at=clock_timestamp();
  end if;

  return jsonb_build_object('storeId',p_store_id,'updatedAt',clock_timestamp());
end $$;

revoke all on function public.save_operator_store_settings(uuid,text,text,text,text,text[],text,text,text,text,text,text,text,bigint,bigint,text,text,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.save_operator_store_settings(uuid,text,text,text,text,text[],text,text,text,text,text,text,text,bigint,bigint,text,text,text,text)
to authenticated;

commit;
