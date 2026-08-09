import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.user
    .from("commerce_cancellation_requests")
    .select("id,product_id,order_id,sale_type,requested_by,status,reason_code,reason_detail,response_due_at,responded_at,refund_amount,version,created_at")
    .eq("buyer_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return commerceJson({ error: "cancellations_unavailable" }, 503);
  return commerceJson({ cancellations: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.productId !== "string" || !UUID_PATTERN.test(body.productId)
    || typeof body.idempotencyKey !== "string" || !UUID_PATTERN.test(body.idempotencyKey)
    || typeof body.reasonCode !== "string" || typeof body.reasonDetail !== "string") {
    return commerceJson({ error: "invalid_cancellation_request" }, 400);
  }
  const { data, error } = await auth.user.rpc("request_commerce_cancellation", {
    p_product_id: body.productId,
    p_requested_by: "buyer",
    p_reason_code: body.reasonCode,
    p_reason_detail: body.reasonDetail,
    p_idempotency_key: body.idempotencyKey,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404
      : ["23505", "55000", "PT409"].includes(error.code ?? "") ? 409 : 422;
    return commerceJson({ error: error.message || "cancellation_request_failed" }, status);
  }
  return commerceJson({ cancellation: data }, 201);
}
