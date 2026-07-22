import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcError {
  code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function normalizedText(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= minimum && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isShipmentResult(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    isUuid(value.shipment_id) &&
    typeof value.status === "string" &&
    nonNegativeInteger(value.version) &&
    typeof value.idempotent_replay === "boolean";
}

function rpcFailure(error: RpcError) {
  if (error.code === "22023") {
    return commerceJson({ error: "invalid_tracking_correction", message: "운송장 정정 내용을 확인해 주세요." }, 400);
  }
  if (error.code === "42501") {
    return commerceJson({ error: "shipment_forbidden", message: "운송장 정정 권한이 없습니다." }, 403);
  }
  if (error.code === "P0002") {
    return commerceJson({ error: "shipment_not_found", message: "정식 배송을 찾지 못했습니다." }, 404);
  }
  if (error.code === "22000" || error.code === "23505" || error.code === "55000") {
    return commerceJson({ error: "shipment_conflict", message: "배송 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
  }
  return commerceJson({ error: "tracking_correction_unavailable" }, 503);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);

  const { id } = await params;
  const body = await request.json().catch(() => null) as unknown;
  if (!isUuid(id) || !isRecord(body) || !hasOnlyKeys(body, [
    "expectedVersion",
    "courier",
    "trackingNumber",
    "reason",
    "idempotencyKey",
  ])) {
    return commerceJson({ error: "invalid_tracking_correction", message: "운송장 정정 내용을 확인해 주세요." }, 400);
  }

  const courier = normalizedText(body.courier, 1, 80);
  const trackingNumber = normalizedText(body.trackingNumber, 1, 120);
  const reason = normalizedText(body.reason, 3, 500);
  if (
    !nonNegativeInteger(body.expectedVersion) ||
    !courier ||
    !trackingNumber ||
    !reason ||
    !isUuid(body.idempotencyKey)
  ) {
    return commerceJson({ error: "invalid_tracking_correction", message: "운송장 정정 내용과 사유를 확인해 주세요." }, 400);
  }

  const { data, error } = await auth.user.rpc(
    "correct_commerce_shipment_tracking",
    {
      p_shipment_id: id,
      p_expected_version: body.expectedVersion,
      p_courier: courier,
      p_tracking_number: trackingNumber,
      p_reason: reason,
      p_idempotency_key: body.idempotencyKey,
    },
  );
  if (error) return rpcFailure(error);
  if (!isShipmentResult(data)) {
    return commerceJson({ error: "tracking_correction_unavailable" }, 503);
  }
  return commerceJson({ shipment: data });
}
