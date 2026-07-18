-- Public auction transparency: member-selected public nicknames, bid times and
-- amounts are visible without nickname masking. The hidden service tester stays
-- non-identifiable and is never exposed through this RPC.

create or replace function public.get_public_sold_auctions(
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
    raise exception using
      errcode = '22023',
      message = '판매 완료 조회 개수는 1~100개여야 합니다.';
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
    and (p_before is null or products.closes_at < p_before)
  order by products.closes_at desc, products.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_public_sold_auctions(integer, timestamptz)
from public;
grant execute on function public.get_public_sold_auctions(integer, timestamptz)
to anon, authenticated;

drop function if exists public.mask_public_auction_name(text);
