import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface RpcClient {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAddress(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = ["label", "recipientName", "phone", "postalCode", "address"];
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)) &&
    typeof value.label === "string" && typeof value.recipientName === "string" &&
    typeof value.phone === "string" &&
    (value.postalCode === null || typeof value.postalCode === "string") &&
    typeof value.address === "string";
}

function isReveal(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = ["shipmentId", "accessEventId", "address", "expiresAt", "idempotentReplay"];
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)) &&
    typeof value.shipmentId === "string" && UUID_PATTERN.test(value.shipmentId) &&
    typeof value.accessEventId === "string" && UUID_PATTERN.test(value.accessEventId) &&
    isAddress(value.address) && typeof value.expiresAt === "string" &&
    Number.isFinite(Date.parse(value.expiresAt)) && typeof value.idempotentReplay === "boolean";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as unknown;
  if (!UUID_PATTERN.test(id) || !isRecord(body) ||
    Object.keys(body).some((key) => !["reason", "idempotencyKey"].includes(key)) ||
    typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 500 ||
    typeof body.idempotencyKey !== "string" || !UUID_PATTERN.test(body.idempotencyKey)) {
    return commerceJson({
      error: "invalid_address_reveal_request",
      message: "배송정보 열람 사유를 3자 이상 입력해 주세요.",
    }, 422);
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "reveal_inventory_shipment_address",
    {
      p_shipment_id: id,
      p_reason: body.reason.trim(),
      p_idempotency_key: body.idempotencyKey,
    },
  );
  if (error) {
    const status = error.code === "42501" ? 403
      : error.code === "P0002" ? 404
        : ["22023", "23505", "55000"].includes(error.code ?? "") ? 422
          : 503;
    return commerceJson({
      error: status === 403 ? "shipment_address_forbidden" : "shipment_address_unavailable",
      message: error.message ?? "배송정보를 열람하지 못했습니다.",
    }, status);
  }
  if (!isReveal(data) || data.shipmentId !== id) {
    return commerceJson({ error: "shipment_address_unavailable" }, 503);
  }
  return commerceJson({ reveal: data });
}
