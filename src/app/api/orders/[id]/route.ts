import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data, error } = await auth.user
    .from("commerce_orders")
    .select("*, commerce_order_items(*, products(*), stores(*))")
    .eq("id", id)
    .eq("member_id", auth.userId)
    .maybeSingle();
  if (error) return commerceJson({ error: "order_unavailable" }, 503);
  if (!data) return commerceJson({ error: "order_not_found" }, 404);
  return commerceJson({ order: data, storagePolicy: { smallDays: 14, largeDays: 7 } });
}
