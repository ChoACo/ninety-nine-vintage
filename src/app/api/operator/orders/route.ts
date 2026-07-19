import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const { data: stores, error: storeError } = auth.roleCode === "owner"
    ? await auth.admin.from("stores").select("id, name, slug, operator_id")
    : await auth.admin.from("stores").select("id, name, slug, operator_id").eq("operator_id", auth.userId);
  if (storeError) return commerceJson({ error: "operator_orders_unavailable" }, 503);
  const storeIds = (stores ?? []).map((store) => store.id);
  if (storeIds.length === 0) return commerceJson({ orders: [], stores: [] });
  const { data: items, error } = await auth.admin
    .from("commerce_order_items")
    .select("*, products(id, title, image_urls, store_id), commerce_orders(id, member_id, status, subtotal, total, created_at)")
    .in("store_id", storeIds)
    .order("created_at", { ascending: false });
  if (error) return commerceJson({ error: "operator_orders_unavailable" }, 503);
  const orderIds = [...new Set((items ?? []).map((item) => item.order_id))];
  const { data: transfers } = orderIds.length === 0
    ? { data: [] }
    : await auth.admin.from("commerce_order_transfers").select("*").in("order_id", orderIds).order("requested_at", { ascending: false });
  return commerceJson({ stores: stores ?? [], items: items ?? [], transfers: transfers ?? [] });
}
