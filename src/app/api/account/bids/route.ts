import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";

type BidRow = {
  id: string;
  product_id: string;
  amount: number;
  created_at: string;
  is_final: boolean;
};

type ProductRow = {
  id: string;
  title: string;
  image_urls: string[];
  thumbnail_urls: string[];
  current_price: number;
  starting_price: number;
  bid_increment: number;
  closes_at: string;
  status: string;
  sale_type: string;
  final_bid_id: string | null;
  final_bid_amount: number | null;
};

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const { data: bids, error: bidError } = await auth.admin
    .from("auction_bids")
    .select("id, product_id, amount, created_at, is_final")
    .eq("bidder_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (bidError) return commerceJson({ error: "bids_unavailable" }, 503);

  const bidRows = (bids ?? []) as BidRow[];
  const productIds = [...new Set(bidRows.map((bid) => bid.product_id))];
  if (productIds.length === 0) {
    return commerceJson({ items: [], summary: { total: 0, leading: 0, final: 0, outbid: 0 } });
  }

  const { data: products, error: productError } = await auth.admin
    .from("products")
    .select("id, title, image_urls, thumbnail_urls, current_price, starting_price, bid_increment, closes_at, status, sale_type, final_bid_id, final_bid_amount")
    .in("id", productIds);
  if (productError) return commerceJson({ error: "bids_unavailable" }, 503);

  const productMap = new Map(((products ?? []) as ProductRow[]).map((product) => [product.id, product]));
  const latestByProduct = new Map<string, BidRow>();
  for (const bid of bidRows) {
    if (!latestByProduct.has(bid.product_id)) latestByProduct.set(bid.product_id, bid);
  }

  const items = [...latestByProduct.values()].flatMap((bid) => {
    const product = productMap.get(bid.product_id);
    if (!product) return [];
    const isFinal = product.final_bid_id === bid.id || bid.is_final;
    const isLeading = product.status === "active" && product.current_price === bid.amount;
    const state = isFinal ? "final" : isLeading ? "leading" : product.status === "closed" ? "closed" : "outbid";
    return [{
      id: bid.id,
      productId: product.id,
      title: product.title,
      imageUrl: getCatalogImageUrl(product.thumbnail_urls?.[0] ?? product.image_urls?.[0] ?? "", 480),
      amount: bid.amount,
      currentPrice: product.current_price,
      startingPrice: product.starting_price,
      bidIncrement: product.bid_increment,
      closesAt: product.closes_at,
      productStatus: product.status,
      saleType: product.sale_type,
      state,
      createdAt: bid.created_at,
      finalAmount: product.final_bid_amount,
    }];
  });

  return commerceJson({
    items,
    summary: {
      total: items.length,
      leading: items.filter((item) => item.state === "leading").length,
      final: items.filter((item) => item.state === "final").length,
      outbid: items.filter((item) => item.state === "outbid" || item.state === "closed").length,
    },
  });
}
