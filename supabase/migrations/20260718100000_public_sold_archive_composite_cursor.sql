-- Cursor-safe public sold archive. Normal auction finalization gives every
-- product in a daily batch the same closes_at, so timestamp-only pagination can
-- skip products at the page boundary. The product UUID is the stable tie-breaker.

create index if not exists products_public_sold_archive_cursor_idx
  on public.products (closes_at desc, id desc)
  where status = 'closed'
    and final_bid_id is not null
    and final_bid_amount is not null;

drop function if exists public.get_public_sold_auctions(integer, timestamptz);

create function public.get_public_sold_auctions(
  p_limit integer default 30,
  p_before timestamptz default null,
  p_before_id uuid default null
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
    raise exception using
      errcode = '22023',
      message = '판매 완료 조회 개수는 1~100개여야 합니다.';
  end if;
  if p_before_id is not null and p_before is null then
    raise exception using
      errcode = '22023',
      message = '판매 완료 조회 기준 시각이 필요합니다.';
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
      else btrim(winner.bidder_display_name)
    end,
    products.participant_count
  from public.products as products
  join public.auction_bids as winner
    on winner.id = products.final_bid_id
   and winner.product_id = products.id
  where products.status = 'closed'
    and products.final_bid_id is not null
    and products.final_bid_amount is not null
    and (
      p_before is null
      or (p_before_id is null and products.closes_at < p_before)
      or (
        p_before_id is not null
        and (products.closes_at, products.id) < (p_before, p_before_id)
      )
    )
  order by products.closes_at desc, products.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_public_sold_auctions(
  integer, timestamptz, uuid
) from public;
grant execute on function public.get_public_sold_auctions(
  integer, timestamptz, uuid
) to anon, authenticated;
