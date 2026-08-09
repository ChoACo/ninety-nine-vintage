import {
  authenticateMemberCommerceRequest,
  commerceJson,
} from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { idempotencyKey?: unknown }
    | null;
  const idempotencyKey =
    typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(idempotencyKey)) {
    return commerceJson({ error: "invalid_confirmation_request" }, 400);
  }

  const { data, error } = await auth.user.rpc(
    "request_commerce_payment_confirmation",
    { p_order_id: id, p_idempotency_key: idempotencyKey },
  );
  if (error) {
    const status = error.code === "42501" ? 403
      : ["22023", "P0002"].includes(error.code ?? "") ? 400
      : error.code === "55000" ? 409
      : 503;
    return commerceJson(
      { error: error.message || "payment_confirmation_request_failed" },
      status,
    );
  }
  if (!data || typeof data !== "object") {
    return commerceJson({ error: "payment_confirmation_request_unavailable" }, 503);
  }
  return commerceJson({ request: data }, 201);
}
