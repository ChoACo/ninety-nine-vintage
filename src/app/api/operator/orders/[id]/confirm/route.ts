import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: items, error: itemError } = await auth.admin
    .from("commerce_order_items")
    .select("order_id, store_id")
    .eq("order_id", id);
  if (itemError) return commerceJson({ error: "order_unavailable" }, 503);
  if (!items || items.length === 0) return commerceJson({ error: "order_not_found" }, 404);
  if (auth.roleCode !== "owner") {
    const storeIds = [...new Set(items.map((item) => item.store_id).filter((storeId): storeId is string => Boolean(storeId)))];
    if (storeIds.length !== items.length) return commerceJson({ error: "forbidden" }, 403);
    const { data: stores } = await auth.admin.from("stores").select("id, operator_id").in("id", storeIds);
    if (!stores || stores.length !== storeIds.length || stores.some((store) => store.operator_id !== auth.userId)) {
      return commerceJson({ error: "forbidden" }, 403);
    }
  }
  const { data, error } = await auth.user.rpc("confirm_commerce_order_transfer", { p_order_id: id });
  if (error) return commerceJson({ error: error.message || "입금을 확인하지 못했습니다." }, 409);
  return commerceJson({ confirmed: Boolean(data) });
}
