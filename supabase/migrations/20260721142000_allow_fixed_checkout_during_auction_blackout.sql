-- Fixed-price checkout closes inventory through the authenticated member RPC.
-- The auction blackout guard predates sale_type and otherwise treats that
-- exact inventory transition as an auction mutation between 21:00 and 22:00.
-- Permit only the fixed active -> closed transition where status/updated_at
-- are the sole changed columns. Auction state and mixed product edits remain
-- protected by the existing authoritative-bid exception.
create or replace function public.guard_product_auction_blackout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authoritative_bid_product_id text := current_setting(
    'app.authoritative_bid_product_id',
    true
  );
  v_exact_fixed_inventory_close boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_exact_fixed_inventory_close :=
      old.sale_type = 'fixed'
      and new.sale_type = 'fixed'
      and old.status = 'active'
      and new.status = 'closed'
      and (
        to_jsonb(new) - 'status' - 'updated_at'
      ) is not distinct from (
        to_jsonb(old) - 'status' - 'updated_at'
      );
  end if;

  if auth.uid() is not null
    and not public.is_owner()
    and public.is_auction_blackout(clock_timestamp())
  then
    if tg_op = 'INSERT' and new.status = 'active' then
      raise exception using
        errcode = 'P0001',
        message = '오후 9시부터 10시까지는 경매 정산 시간입니다.';
    elsif tg_op = 'UPDATE'
      and coalesce(v_authoritative_bid_product_id, '') <> new.id::text
      and not v_exact_fixed_inventory_close
    then
      if new.status is distinct from old.status
        or new.publish_at is distinct from old.publish_at
        or new.closes_at is distinct from old.closes_at
        or new.starting_price is distinct from old.starting_price
        or new.current_price is distinct from old.current_price
        or new.bid_increment is distinct from old.bid_increment
        or new.participant_count is distinct from old.participant_count
        or new.bid_history is distinct from old.bid_history
        or new.bid_locked_at is distinct from old.bid_locked_at
        or new.final_bid_id is distinct from old.final_bid_id
        or new.final_bid_amount is distinct from old.final_bid_amount
        or new.anti_sniping_base_closes_at is distinct from old.anti_sniping_base_closes_at
        or new.anti_sniping_extended_at is distinct from old.anti_sniping_extended_at
        or new.anti_sniping_extension_count is distinct from old.anti_sniping_extension_count
      then
        raise exception using
          errcode = 'P0001',
          message = '오후 9시부터 10시까지는 경매 정산 시간입니다.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_product_auction_blackout()
from public, anon, authenticated, service_role;
