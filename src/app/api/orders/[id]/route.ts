import {
  authenticateMemberRlsRequest,
  commerceJson,
} from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateMemberRlsRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return commerceJson({ error: "invalid_order_id" }, 400);
  }

  // The buyer-scoped RLS session reads only its own order. The companion
  // migration grants that buyer access to product snapshots after inventory is
  // closed, so recovery does not require a privileged service client.
  const { data: order, error: orderError } = await auth.user
    .from("commerce_orders")
    .select(
      "id, member_id, status, total",
    )
    .eq("id", id)
    .eq("member_id", auth.userId)
    .maybeSingle();
  if (orderError) return commerceJson({ error: "order_unavailable" }, 503);
  if (!order) return commerceJson({ error: "order_not_found" }, 404);

  return commerceJson({
    order: { id: order.id, status: order.status, total: order.total },
    recovery: null,
    storagePolicy: { smallDays: 14, largeDays: 7 },
  });
}
