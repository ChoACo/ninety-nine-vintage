begin;

create table public.operator_product_publication_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  publication_mode text not null default 'scheduled' check (publication_mode in ('now','scheduled')),
  scheduled_hour_kst smallint not null default 10 check (scheduled_hour_kst between 0 and 23),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id,store_id)
);

alter table public.operator_product_publication_preferences enable row level security;
alter table public.operator_product_publication_preferences force row level security;
revoke all on table public.operator_product_publication_preferences from public,anon,authenticated,service_role;
grant select on table public.operator_product_publication_preferences to authenticated,service_role;
create policy "Operators read own publication preference"
on public.operator_product_publication_preferences for select to authenticated
using (user_id=auth.uid() and public.has_store_permission(store_id,'manage_products'));
create policy "Service reads publication preferences"
on public.operator_product_publication_preferences for select to service_role using (true);

create or replace function public.set_operator_product_publication_preference(
  p_store_id uuid,p_publication_mode text,p_scheduled_hour_kst integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_row public.operator_product_publication_preferences%rowtype;
begin
  if v_actor is null or p_publication_mode not in ('now','scheduled') or p_scheduled_hour_kst not between 0 and 23
    or not public.has_store_permission(p_store_id,'manage_products')
  then raise exception using errcode='42501',message='상품 공개 설정 권한 또는 입력값을 확인해 주세요.'; end if;
  insert into public.operator_product_publication_preferences(user_id,store_id,publication_mode,scheduled_hour_kst)
  values(v_actor,p_store_id,p_publication_mode,p_scheduled_hour_kst)
  on conflict(user_id,store_id) do update set publication_mode=excluded.publication_mode,
    scheduled_hour_kst=excluded.scheduled_hour_kst,updated_at=clock_timestamp()
  returning * into v_row;
  return jsonb_build_object('storeId',v_row.store_id,'publicationMode',v_row.publication_mode,
    'scheduledHourKst',v_row.scheduled_hour_kst,'updatedAt',v_row.updated_at);
end; $$;
revoke all on function public.set_operator_product_publication_preference(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.set_operator_product_publication_preference(uuid,text,integer) to authenticated;

create or replace function public.get_public_store_sold_feed_products(
  p_store_id uuid,p_sale_type text,p_limit integer default 24
)
returns table (
  id uuid,title text,description text,category text,brand text,brand_slug text,
  publish_at timestamptz,closes_at timestamptz,status text,sale_type text,
  starting_price integer,current_price integer,fixed_price integer,bid_increment integer,
  participant_count integer,bid_history jsonb,anti_sniping_base_closes_at timestamptz,
  anti_sniping_extended_at timestamptz,anti_sniping_extension_count integer,
  bid_locked_at timestamptz,final_bid_amount integer,image_urls text[],thumbnail_urls text[],
  size_label text,sold_at timestamptz,sold_price integer
)
language sql stable security definer set search_path='' as $$
  select products.id,products.title,products.description,products.category,products.brand,products.brand_slug,
    products.publish_at,products.closes_at,products.status,products.sale_type,products.starting_price,
    products.current_price,products.fixed_price,products.bid_increment,products.participant_count,'[]'::jsonb,
    products.anti_sniping_base_closes_at,products.anti_sniping_extended_at,products.anti_sniping_extension_count,
    products.bid_locked_at,products.final_bid_amount,products.image_urls,products.thumbnail_urls,
    coalesce(nullif(btrim(products.size_label),''),''),products.sale_completed_at,
    case when products.sale_type='auction' then products.final_bid_amount else products.fixed_price end
  from public.products products
  where products.store_id=p_store_id and products.status='closed' and products.sale_type=p_sale_type
    and products.sale_completed_at is not null
    and ((products.sale_type='auction' and products.final_bid_id is not null and products.final_bid_amount is not null)
      or (products.sale_type='fixed' and exists(select 1 from public.customer_inventory_items inventory
        where inventory.product_id=products.id and inventory.ownership_status='active')))
  order by products.sale_completed_at desc,products.id desc
  limit least(greatest(coalesce(p_limit,24),1),100);
$$;
revoke all on function public.get_public_store_sold_feed_products(uuid,text,integer) from public,authenticated,service_role;
grant execute on function public.get_public_store_sold_feed_products(uuid,text,integer) to anon,authenticated;

create or replace function public.get_public_premium_store_ids()
returns table(store_id uuid)
language sql stable security definer set search_path='' as $$
  select subscriptions.store_id from public.store_service_subscriptions subscriptions
  join public.stores stores on stores.id=subscriptions.store_id
  where subscriptions.plan_code='pro' and subscriptions.status='active' and stores.is_active;
$$;
revoke all on function public.get_public_premium_store_ids() from public,service_role;
grant execute on function public.get_public_premium_store_ids() to anon,authenticated;

commit;
