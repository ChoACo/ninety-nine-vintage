-- The live auction feed listens for new bids so current prices and bid counts
-- update without a full page refresh.
do $$
begin
  alter publication supabase_realtime add table public.auction_bids;
exception
  when duplicate_object then null;
end;
$$;
