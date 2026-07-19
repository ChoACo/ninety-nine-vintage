import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: item } = await auth.admin.from("commerce_order_items").select("order_id, store_id").eq("order_id", id).limit(1).maybeSingle();
  if (!item) return commerceJson({ error: "order_not_found" }, 404);
  if (auth.roleCode !== "owner") {
    if (!item.store_id) return commerceJson({ error: "forbidden" }, 403);
    const { data: store } = await auth.admin.from("stores").select("operator_id").eq("id", item.store_id).maybeSingle();
    if (store?.operator_id !== auth.userId) return commerceJson({ error: "forbidden" }, 403);
  }
  const { data, error } = await auth.user.rpc("confirm_commerce_order_transfer", { p_order_id: id });
  if (error) return commerceJson({ error: error.message || "입금을 확인하지 못했습니다." }, 409);
  return commerceJson({ confirmed: Boolean(data) });
}
