import { authenticateOperatorStoreRequest, commerceJson } from "@/lib/commerce/server";

export async function POST(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.productId !== "string" || typeof body.reasonCode !== "string"
    || typeof body.reasonDetail !== "string" || typeof body.idempotencyKey !== "string") {
    return commerceJson({ error: "invalid_cancellation_request" }, 400);
  }
  const { data: scopedProduct, error: scopeError } = await auth.user.from("products").select("id")
    .eq("id", body.productId).eq("store_id", auth.selectedStoreId).maybeSingle();
  if (scopeError || !scopedProduct) return commerceJson({ error: "operator_store_scope_mismatch" }, 403);
  const { data, error } = await auth.user.rpc("request_commerce_cancellation", {
    p_product_id: body.productId, p_requested_by: "store", p_reason_code: body.reasonCode,
    p_reason_detail: body.reasonDetail, p_idempotency_key: body.idempotencyKey,
  });
  if (error) return commerceJson({ error: error.message || "cancellation_request_failed" }, error.code === "42501" ? 403 : 409);
  return commerceJson({ cancellation: data }, 201);
}

export async function GET(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.user.from("commerce_cancellation_requests")
    .select("id,product_id,order_id,buyer_id,sale_type,requested_by,status,reason_code,reason_detail,response_due_at,refund_amount,version,created_at")
    .eq("origin_store_id", auth.selectedStoreId).order("created_at", { ascending: false }).limit(100);
  if (error) return commerceJson({ error: "cancellations_unavailable" }, 503);
  return commerceJson({ cancellations: data ?? [] });
}

export async function PATCH(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.requestId !== "string" || typeof body.accept !== "boolean"
    || !Number.isSafeInteger(body.expectedVersion) || typeof body.idempotencyKey !== "string") {
    return commerceJson({ error: "invalid_cancellation_response" }, 400);
  }
  const { data: scoped, error: scopeError } = await auth.user.from("commerce_cancellation_requests")
    .select("id").eq("id", body.requestId).eq("origin_store_id", auth.selectedStoreId).maybeSingle();
  if (scopeError || !scoped) return commerceJson({ error: "operator_store_scope_mismatch" }, 403);
  const { data, error } = await auth.user.rpc("respond_commerce_cancellation", {
    p_request_id: body.requestId, p_accept: body.accept, p_expected_version: Number(body.expectedVersion),
    p_reason: typeof body.reason === "string" ? body.reason : "", p_idempotency_key: body.idempotencyKey,
  });
  if (error) return commerceJson({ error: error.message || "cancellation_response_failed" }, error.code === "PT409" ? 409 : 403);
  return commerceJson({ cancellation: data });
}
