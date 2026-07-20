import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const [{ data: stores, error: storeError }, { data: products }, { data: orders }, { count: auditCount }] = await Promise.all([
    auth.admin.from("stores").select("id, name, slug, description, operator_id, is_active").order("name"),
    auth.admin.from("products").select("id, title, status, sale_type, fixed_price, current_price, store_id, created_at").order("created_at", { ascending: false }),
    auth.admin.from("commerce_orders").select("id, status, total, created_at").order("created_at", { ascending: false }).limit(100),
    auth.admin.from("security_activity_logs").select("id", { count: "exact", head: true }),
  ]);
  if (storeError) return commerceJson({ error: "owner_overview_unavailable" }, 503);
  return commerceJson({ stores: stores ?? [], products: products ?? [], orders: orders ?? [], auditCount: auditCount ?? 0 });
}
