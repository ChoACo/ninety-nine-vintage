import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.accept !== "boolean" || !Number.isSafeInteger(body.expectedVersion)
    || typeof body.idempotencyKey !== "string") {
    return commerceJson({ error: "invalid_cancellation_response" }, 400);
  }
  const { data, error } = await auth.user.rpc("respond_commerce_cancellation", {
    p_request_id: id,
    p_accept: body.accept,
    p_expected_version: Number(body.expectedVersion),
    p_reason: typeof body.reason === "string" ? body.reason : "",
    p_idempotency_key: body.idempotencyKey,
  });
  if (error) return commerceJson({ error: error.message || "cancellation_response_failed" }, error.code === "PT409" ? 409 : 403);
  return commerceJson({ cancellation: data });
}
