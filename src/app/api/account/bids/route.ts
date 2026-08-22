import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";
import type { Database } from "@/lib/supabase/database.types";

type AccountBidStateRow = Database["public"]["Functions"]["list_account_auction_bid_states"]["Returns"][number];
type WonProductRow = Database["public"]["Functions"]["get_my_won_products"]["Returns"][number];

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const [{ data: bids, error: bidError }, { data: wins, error: winError }] = await Promise.all([
    auth.user.rpc("list_account_auction_bid_states"),
    auth.user.rpc("get_my_won_products"),
  ]);
  if (bidError) return commerceJson({ error: "bids_unavailable" }, 503);

  const bidRows = (bids ?? []) as AccountBidStateRow[];
  const wonRows = winError ? [] : (wins ?? []) as WonProductRow[];
  const wonByProduct = new Map(wonRows.map((win) => [win.product_id, win]));
  const items = bidRows.map((bid) => {
    const isFinal = bid.final_bid_id === bid.bid_id || bid.is_final;
    const isLeading = bid.product_status === "active" && bid.current_price === bid.amount;
    const won = isFinal ? wonByProduct.get(bid.product_id) : undefined;
    const state = won?.is_payment_settled ? "settled" : won ? "final" : isLeading ? "leading" : bid.product_status === "closed" ? "closed" : "outbid";
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
      paymentDueAt: won?.payment_due_at ?? null,
      paymentSettled: won?.is_payment_settled ?? false,
    };
  });

  return commerceJson({
    bidCapability: "eligible_member",
    items,
    summary: {
      total: items.length,
      leading: items.filter((item) => item.state === "leading").length,
      final: items.filter((item) => item.state === "final").length,
      settled: items.filter((item) => item.state === "settled").length,
      outbid: items.filter((item) => item.state === "outbid" || item.state === "closed").length,
    },
  });
}
