import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
    const [{ data: stores, error: storeError }, { count: auditCount }] = await Promise.all([
      auth.admin.from("stores").select("id, name, slug, description, operator_id, is_active").order("name"),
      auth.admin.from("security_activity_logs").select("id", { count: "exact", head: true }),
    ]);
    if (storeError) return commerceJson({ error: "owner_overview_unavailable" }, 503);
    let paidTotal = 0;
    let offset = 0;
    const pageSize = 500;
    while (true) {
      const { data: orders, error: orderError } = await auth.admin
        .from("commerce_orders")
        .select("status, total")
        .in("status", ["paid", "shipped"])
        .range(offset, offset + pageSize - 1);
      if (orderError) return commerceJson({ error: "owner_overview_unavailable" }, 503);
      paidTotal += (orders ?? []).reduce((sum, order) => sum + Number(order.total), 0);
      if (!orders || orders.length < pageSize) break;
      offset += pageSize;
    }
    return commerceJson({ stores: stores ?? [], paidTotal, auditCount: auditCount ?? 0 });
}
