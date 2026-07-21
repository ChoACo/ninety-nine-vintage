-- Return one authoritative, latest active bid per product for the signed-in
-- member. This removes the client/API-wide 100-bid truncation that could hide
-- participation in older products when one member placed many repeat bids.
create index if not exists auction_bids_bidder_product_time_idx
  on public.auction_bids (bidder_id, product_id, created_at desc, id desc);

create or replace function public.list_account_auction_bid_states()
returns table (
  bid_id uuid,
  product_id uuid,
  amount bigint,
  bid_created_at timestamptz,
  is_final boolean,
  title text,
  image_urls text[],
  thumbnail_urls text[],
  current_price bigint,
  starting_price bigint,
  bid_increment integer,
  closes_at timestamptz,
  product_status text,
  sale_type text,
  final_bid_id uuid,
  final_bid_amount bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_member() then
    raise exception using
      errcode = '42501',
      message = '카카오 회원 계정으로 이용해 주세요.';
  end if;

  return query
  select
    latest.bid_id,
    latest.product_id,
    latest.amount,
    latest.bid_created_at,
    latest.is_final,
    products.title,
    products.image_urls,
    products.thumbnail_urls,
    products.current_price,
    products.starting_price,
    products.bid_increment,
    products.closes_at,
    products.status::text,
    products.sale_type::text,
    products.final_bid_id,
    products.final_bid_amount
  from (
    select distinct on (bids.product_id)
      bids.id as bid_id,
      bids.product_id,
      bids.amount,
      bids.created_at as bid_created_at,
      bids.is_final
    from public.auction_bids as bids
    where bids.bidder_id = v_user_id
    order by bids.product_id, bids.created_at desc, bids.id desc
  ) as latest
  join public.products as products on products.id = latest.product_id
  order by latest.bid_created_at desc, latest.product_id;
end;
$$;

revoke all on function public.list_account_auction_bid_states() from public, anon, authenticated;
grant execute on function public.list_account_auction_bid_states() to authenticated;
