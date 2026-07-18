-- Keep a compact, separately cached image variant for list/card UIs. Existing
-- products retain their current public URL as a safe fallback; newly uploaded
-- products receive true 640x360 derivatives from the browser upload pipeline.
alter table public.products
  add column if not exists thumbnail_urls text[] not null default '{}'::text[];

update public.products
set thumbnail_urls = image_urls
where cardinality(thumbnail_urls) = 0;

comment on column public.products.thumbnail_urls is
  'Ordered max-640x360 preview URLs corresponding to image_urls; legacy rows fall back to image_urls.';

-- Return both image families so a product deletion also removes every Storage
-- derivative. The public return type remains text[] for client compatibility.
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
  v_product public.products%rowtype;
  v_storage_urls text[];
begin
  if not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = '상품 수정 버전이 필요합니다.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '삭제할 상품을 찾을 수 없습니다.';
  end if;
  if v_product.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = '다른 운영자가 먼저 수정했습니다. 목록을 새로고침해 주세요.';
  end if;

  if exists (
    select 1 from public.auction_bids as bids where bids.product_id = p_product_id
  ) then
    raise exception using errcode = 'P0001', message = '입찰 기록이 있는 상품은 삭제할 수 없습니다. 마감 상태로 변경해 주세요.';
  end if;

  select coalesce(array_agg(distinct storage_url), '{}'::text[])
  into v_storage_urls
  from unnest(v_product.image_urls || v_product.thumbnail_urls) as storage_url
  where nullif(btrim(storage_url), '') is not null;

  delete from public.products where id = p_product_id;
  return v_storage_urls;
end;
$$;

revoke all on function public.delete_managed_product(uuid, timestamptz) from public;
grant execute on function public.delete_managed_product(uuid, timestamptz) to authenticated;

-- PostgreSQL cannot replace a function while changing its OUT row type.
drop function if exists public.get_public_sold_auctions(integer, timestamptz);

create function public.get_public_sold_auctions(
  p_limit integer default 30,
  p_before timestamptz default null
)
returns table (
  product_id uuid,
  title text,
  description text,
  image_urls text[],
  thumbnail_urls text[],
  sold_at timestamptz,
  winning_amount bigint,
  winner_display_name text,
  participant_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = '판매 완료 조회 개수는 1~100개여야 합니다.';
  end if;

  return query
  select
    products.id,
    products.title,
    products.description,
    products.image_urls,
    products.thumbnail_urls,
    products.closes_at,
    products.final_bid_amount,
    case
      when public.is_owner_hidden_test_member(winner.bidder_id) then '***'
      else public.mask_public_auction_name(winner.bidder_display_name)
    end,
    products.participant_count
  from public.products as products
  join public.auction_bids as winner
    on winner.id = products.final_bid_id
   and winner.product_id = products.id
  where products.status = 'closed'
    and products.final_bid_id is not null
    and products.final_bid_amount is not null
    and (p_before is null or products.closes_at < p_before)
  order by products.closes_at desc, products.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_public_sold_auctions(integer, timestamptz) from public;
grant execute on function public.get_public_sold_auctions(integer, timestamptz) to anon, authenticated;
