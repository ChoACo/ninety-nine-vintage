import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcClient {
  rpc(
    functionName: string,
    parameters?: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length <= maximum ? normalized || null : undefined;
}

function failure(error: { code?: string; message?: string }) {
  if (error.code === "42501") {
    return commerceJson({ error: "center_forbidden", message: error.message }, 403);
  }
  if (error.code === "P0002") {
    return commerceJson({ error: "center_not_found", message: error.message }, 404);
  }
  if (["PT409", "40001"].includes(error.code ?? "")) {
    return commerceJson({ error: "center_conflict", message: error.message }, 409);
  }
  if (error.code === "55000") {
    return commerceJson({ error: "center_in_use", message: error.message }, 422);
  }
  if (["22023", "23514", "23505"].includes(error.code ?? "")) {
    return commerceJson({ error: "invalid_center", message: error.message }, 422);
  }
  return commerceJson(
    { error: "center_unavailable", message: "센터 정보를 처리하지 못했습니다." },
    503,
  );
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_my_center_management",
  );
  if (error) return failure(error);
  if (!record(data) || !Array.isArray(data.centers) || !Array.isArray(data.stores)) {
    return commerceJson({ error: "center_unavailable" }, 503);
  }
  return commerceJson(data);
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "operator" && auth.roleCode !== "employee") {
    return commerceJson({ error: "center_forbidden" }, 403);
  }
  const body = await request.json().catch(() => null) as unknown;
  if (!record(body)) return commerceJson({ error: "invalid_center" }, 422);
  const action =
    body.action === "create" || body.action === "update" || body.action === "archive"
      ? body.action
      : "";
  const centerId =
    body.centerId === null || body.centerId === undefined
      ? null
      : typeof body.centerId === "string" && UUID.test(body.centerId)
        ? body.centerId
        : undefined;
  const code =
    typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const expectedVersion = Number(body.expectedVersion);
  const postalCode = optionalText(body.postalCode, 20);
  const addressLine1 = optionalText(body.addressLine1, 240);
  const addressLine2 = optionalText(body.addressLine2, 240);
  const contactName = optionalText(body.contactName, 80);
  const contactPhone = optionalText(body.contactPhone, 40);
  if (
    !action ||
    centerId === undefined ||
    (action !== "create" && centerId === null) ||
    !/^[a-z0-9-]{2,80}$/.test(code) ||
    name.length < 1 ||
    name.length > 120 ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    [postalCode, addressLine1, addressLine2, contactName, contactPhone].includes(
      undefined,
    )
  ) {
    return commerceJson({ error: "invalid_center" }, 422);
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "configure_assigned_fulfillment_center",
    {
      p_action: action,
      p_center_id: centerId,
      p_code: code,
      p_name: name,
      p_is_default: body.isDefault === true,
      p_postal_code: postalCode,
      p_address_line1: addressLine1,
      p_address_line2: addressLine2,
      p_contact_name: contactName,
      p_contact_phone: contactPhone,
      p_expected_version: expectedVersion,
    },
  );
  if (error) return failure(error);
  if (!record(data) || typeof data.id !== "string" || typeof data.version !== "number") {
    return commerceJson({ error: "center_unavailable" }, 503);
  }
  return commerceJson({ center: data });
}
