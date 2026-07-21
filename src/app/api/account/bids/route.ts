import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";
import type { Database } from "@/lib/supabase/database.types";

type AccountBidStateRow = Database["public"]["Functions"]["list_account_auction_bid_states"]["Returns"][number];

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const { data: bids, error: bidError } = await auth.user.rpc(
    "list_account_auction_bid_states",
  );
  if (bidError) return commerceJson({ error: "bids_unavailable" }, 503);

  const bidRows = (bids ?? []) as AccountBidStateRow[];
  const items = bidRows.map((bid) => {
    const isFinal = bid.final_bid_id === bid.bid_id || bid.is_final;
    const isLeading = bid.product_status === "active" && bid.current_price === bid.amount;
    const state = isFinal ? "final" : isLeading ? "leading" : bid.product_status === "closed" ? "closed" : "outbid";
    return {
      id: bid.bid_id,
      productId: bid.product_id,
      title: bid.title,
      imageUrl: getCatalogImageUrl(bid.thumbnail_urls?.[0] ?? bid.image_urls?.[0] ?? "", 480),
      amount: bid.amount,
      currentPrice: bid.current_price,
      startingPrice: bid.starting_price,
      bidIncrement: bid.bid_increment,
      closesAt: bid.closes_at,
      productStatus: bid.product_status,
      saleType: bid.sale_type,
      state,
      createdAt: bid.bid_created_at,
      finalAmount: bid.final_bid_amount,
    };
  });

  return commerceJson({
    bidCapability: "eligible_member",
    items,
    summary: {
      total: items.length,
      leading: items.filter((item) => item.state === "leading").length,
      final: items.filter((item) => item.state === "final").length,
      outbid: items.filter((item) => item.state === "outbid" || item.state === "closed").length,
    },
  });
}
