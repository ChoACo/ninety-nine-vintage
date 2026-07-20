import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
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
    products: item.products ? {
      ...item.products,
      image_urls: item.products.image_urls.map((image) => getCatalogImageUrl(image, 320)),
      thumbnail_urls: item.products.thumbnail_urls.map((image) => getCatalogImageUrl(image, 320)),
    } : item.products,
    shippingEligible: Boolean(item.storage_expires_at && new Date(item.storage_expires_at).getTime() > now),
    storageStatus: item.storage_expires_at && new Date(item.storage_expires_at).getTime() > now ? "eligible" : "expired",
  }));
  const { data: auctionWins } = await auth.user.rpc("get_my_won_products");
  return commerceJson({ items: storageItems, auctionWins: auctionWins ?? [] });
}
