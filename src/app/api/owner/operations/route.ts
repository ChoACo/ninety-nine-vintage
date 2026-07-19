import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request); if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const [{ data: shipping }, { data: transfers }, { data: orders }, { data: attempts }, { data: feePayments }] = await Promise.all([
    auth.admin.from("shipping_requests").select("*").order("requested_at", { ascending: false }).limit(200),
    auth.admin.from("commerce_order_transfers").select("*").order("requested_at", { ascending: false }).limit(200),
    auth.admin.from("commerce_orders").select("*").order("created_at", { ascending: false }).limit(200),
    auth.admin.from("payment_attempts").select("*").order("created_at", { ascending: false }).limit(200),
    auth.admin.from("shipping_fee_payments").select("*").order("requested_at", { ascending: false }).limit(200),
  ]);
  return commerceJson({ shipping: shipping ?? [], transfers: transfers ?? [], orders: orders ?? [], attempts: attempts ?? [], feePayments: feePayments ?? [] });
}
