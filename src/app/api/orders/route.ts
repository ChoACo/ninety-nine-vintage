import { authenticateCommerceRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";

export async function GET(request: Request) {
  const auth = await authenticateCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const { data: orders, error } = await auth.admin
    .from("commerce_orders")
    .select("id, status, subtotal, shipping_fee, total, created_at, updated_at, commerce_order_items(id, product_id, unit_price, payment_status, paid_at, storage_expires_at, products(id, title, image_urls))")
    .eq("member_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return commerceJson({ error: "orders_unavailable" }, 503);
  const orderIds = (orders ?? []).map((order) => order.id);
  const { data: transfers, error: transferError } = orderIds.length === 0
    ? { data: [], error: null }
    : await auth.admin.from("commerce_order_transfers").select("*").in("order_id", orderIds);
  if (transferError) return commerceJson({ error: "orders_unavailable" }, 503);
  const transferByOrder = new Map((transfers ?? []).map((transfer) => [transfer.order_id, transfer]));
  return commerceJson({ orders: (orders ?? []).map((order) => ({
    ...order,
    transfer: transferByOrder.get(order.id) ?? null,
    commerce_order_items: order.commerce_order_items?.map((item) => item.products ? {
      ...item,
      products: { ...item.products, image_urls: item.products.image_urls.map((image) => getCatalogImageUrl(image, 320)) },
    } : item),
  })) });
}
