-- Include the exact 03:00 boundary in the database-authoritative soft close.
-- The function body mirrors the final place_bid definition from
-- 20260718102000_live_auction_revenue_defense.sql; only the remaining-time
-- comparison changes from `<` to `<=`. The latest execute grants are restated.

create or replace function public.place_bid(
  p_product_id uuid,
  p_amount bigint
)
returns table (
  bid_id uuid,
  product_id uuid,
  bidder_id uuid,
  bidder_display_name text,
  amount bigint,
  created_at timestamptz,
  is_final boolean,
  current_price bigint,
  participant_count integer,
  bid_locked_at timestamptz,
  final_bid_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_kst_time time;
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_product public.products%rowtype;
  v_bid_id uuid := gen_random_uuid();
  v_has_any_bid boolean;
  v_user_has_bid boolean;
  v_is_final boolean := false;
  v_is_overtime boolean := false;
  v_should_extend boolean := false;
  v_next_closes_at timestamptz;
  v_minimum_amount bigint;
  v_participant_count integer;
  v_maximum_amount constant bigint := 1000000000;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인 후 입찰할 수 있습니다.';
  end if;

  select profiles.display_name into v_display_name
  from public.profiles as profiles where profiles.id = v_user_id;
  if v_display_name is null then
    raise exception using errcode = '23503', message = '회원 프로필을 찾을 수 없습니다. 다시 로그인해 주세요.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '입찰 상품을 찾을 수 없습니다.';
  end if;

  v_now := clock_timestamp();
  v_kst_time := (v_now at time zone 'Asia/Seoul')::time;
  v_is_overtime := v_product.anti_sniping_extension_count > 0
    and v_product.anti_sniping_base_closes_at is not null
    and v_now >= v_product.anti_sniping_base_closes_at
    and v_now < v_product.closes_at;

  if v_product.status <> 'active' or v_product.publish_at > v_now then
    raise exception using errcode = 'P0001', message = '현재 공개 중인 상품만 입찰할 수 있습니다.';
  end if;
  if v_product.bid_locked_at is not null then
    raise exception using errcode = 'P0001', message = '확정 입찰이 완료된 상품입니다.';
  end if;
  if v_now >= v_product.closes_at then
    raise exception using errcode = 'P0001', message = '이 상품의 경매가 마감되었습니다.';
  end if;

  select exists (
    select 1 from public.auction_bids as bids
    where bids.product_id = p_product_id
  ) into v_has_any_bid;
  select exists (
    select 1 from public.auction_bids as bids
    where bids.product_id = p_product_id and bids.bidder_id = v_user_id
  ) into v_user_has_bid;

  if public.is_auction_blackout(v_now)
    and not (v_is_overtime and v_user_has_bid)
  then
    raise exception using errcode = 'P0001', message = '오후 9시부터 10시까지는 경매 정산 시간입니다.';
  end if;

  -- Overtime never re-opens to a new participant, including after 22:00.
  if v_is_overtime and not v_user_has_bid then
    raise exception using errcode = 'P0001', message = '마감 연장 시간에는 기존 참여자만 입찰할 수 있습니다.';
  end if;

  if v_kst_time >= time '20:56:00' and v_kst_time < time '21:00:00' then
    if not v_has_any_bid then
      v_is_final := true;
    elsif not v_user_has_bid then
      raise exception using errcode = 'P0001', message = '오후 8시 56분부터는 기존 참여자만 입찰할 수 있습니다.';
    end if;
  end if;

  if p_amount is null or p_amount > v_maximum_amount then
    raise exception using errcode = '22003', message = '입찰 금액은 10억원 이하여야 합니다.';
  end if;
  if v_has_any_bid and v_product.current_price > v_maximum_amount - v_product.bid_increment then
    raise exception using errcode = '22003', message = '이 상품은 최대 입찰 금액에 도달했습니다.';
  end if;

  v_minimum_amount := case
    when v_has_any_bid then v_product.current_price + v_product.bid_increment
    else v_product.starting_price
  end;
  if p_amount < v_minimum_amount then
    raise exception using errcode = '22003', message = format('현재 최소 입찰가는 %s원입니다.', v_minimum_amount);
  end if;

  insert into public.auction_bids (
    id, product_id, bidder_id, bidder_display_name, amount, is_final, created_at
  ) values (
    v_bid_id, p_product_id, v_user_id, v_display_name, p_amount, v_is_final, v_now
  );

  v_should_extend := not v_is_final
    and v_product.closes_at > v_now
    and v_product.closes_at - v_now <= interval '3 minutes';
  v_next_closes_at := case
    when v_should_extend then v_now + interval '3 minutes'
    else v_product.closes_at
  end;
  v_participant_count := v_product.participant_count
    + case when v_user_has_bid then 0 else 1 end;

  perform set_config('app.authoritative_bid_product_id', p_product_id::text, true);
  update public.products
  set
    current_price = p_amount,
    participant_count = v_participant_count,
    bid_history = jsonb_build_array(jsonb_build_object(
      'id', v_bid_id::text,
      'bidAt', v_now,
      'bidderName', v_display_name,
      'amount', p_amount
    )) || coalesce(v_product.bid_history, '[]'::jsonb),
    closes_at = v_next_closes_at,
    anti_sniping_base_closes_at = case
      when v_should_extend then coalesce(
        v_product.anti_sniping_base_closes_at,
        v_product.closes_at
      )
      else v_product.anti_sniping_base_closes_at
    end,
    anti_sniping_extended_at = case
      when v_should_extend then v_now
      else v_product.anti_sniping_extended_at
    end,
    anti_sniping_extension_count = v_product.anti_sniping_extension_count
      + case when v_should_extend then 1 else 0 end,
    bid_locked_at = case when v_is_final then v_now else null end,
    final_bid_id = case when v_is_final then v_bid_id else null end,
    final_bid_amount = case when v_is_final then p_amount else null end
  where id = p_product_id;

  return query select
    v_bid_id, p_product_id, v_user_id, v_display_name, p_amount, v_now,
    v_is_final, p_amount, v_participant_count,
    case when v_is_final then v_now else null end,
    case when v_is_final then v_bid_id else null end;
end;
$$;

revoke all on function public.place_bid(uuid, bigint)
from public, anon, authenticated;

grant execute on function public.place_bid(uuid, bigint)
to authenticated;
