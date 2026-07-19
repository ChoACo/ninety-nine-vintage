import { authenticateCommerceRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const { data: orders, error: orderError } = await auth.admin
    .from("commerce_orders")
    .select("id")
    .eq("member_id", auth.userId)
    .in("status", ["paid", "partially_paid", "shipped"]);
  if (orderError) return commerceJson({ error: "storage_unavailable" }, 503);
  const orderIds = (orders ?? []).map((order) => order.id);
  const { data: items, error: itemError } = orderIds.length === 0
    ? { data: [], error: null }
    : await auth.admin
      .from("commerce_order_items")
      .select("*, products(*)")
      .in("order_id", orderIds)
      .eq("payment_status", "paid")
      .order("storage_expires_at", { ascending: true });
  if (itemError) return commerceJson({ error: "storage_unavailable" }, 503);
  const now = Date.now();
  const storageItems = (items ?? []).map((item) => ({
    ...item,
    shippingEligible: Boolean(item.storage_expires_at && new Date(item.storage_expires_at).getTime() > now),
    storageStatus: item.storage_expires_at && new Date(item.storage_expires_at).getTime() > now ? "eligible" : "expired",
  }));
  const { data: auctionWins } = await auth.user.rpc("get_my_won_products");
  return commerceJson({ items: storageItems, auctionWins: auctionWins ?? [] });
}
