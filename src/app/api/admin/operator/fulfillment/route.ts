import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["store_paid_items", "store_requested_items"]);

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 100 &&
    value.every((item) => typeof item === "string" && UUID.test(item)) &&
    new Set(value).size === value.length;
}

function isVersions(value: unknown, count: number): value is number[] {
  return Array.isArray(value) && value.length === count &&
    value.every((item) => Number.isSafeInteger(item) && Number(item) >= 0);
}

function failure(error: { code?: string; message?: string }) {
  if (error.code === "42501") {
    return commerceJson({ error: "fulfillment_forbidden", message: error.message ?? "처리 권한이 없습니다." }, 403);
  }
  if (error.code === "P0002") {
    return commerceJson({ error: "fulfillment_not_found", message: error.message }, 404);
  }
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) {
    return commerceJson({ error: "fulfillment_conflict", message: error.message }, 409);
  }
  if (error.code === "55000") {
    return commerceJson({ error: "invalid_fulfillment_state", message: error.message }, 422);
  }
  if (["22000", "22023", "23514"].includes(error.code ?? "")) {
    return commerceJson({ error: "invalid_fulfillment_request", message: error.message }, 422);
  }
  return commerceJson({ error: "operator_fulfillment_unavailable", message: error.message }, 503);
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 24)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const date = url.searchParams.get("date");
  if (
    !Number.isSafeInteger(limit) || !Number.isSafeInteger(offset) ||
    (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date))
  ) {
    return commerceJson({ error: "invalid_fulfillment_query" }, 422);
  }
  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_direct_store_fulfillment_groups",
    { p_date: date, p_limit: limit, p_offset: offset },
  );
  if (error) return failure(error);
  if (
    !isRecord(data) || !Array.isArray(data.groups) ||
    typeof data.hasMore !== "boolean" ||
    !Number.isSafeInteger(data.limit) || !Number.isSafeInteger(data.offset)
  ) {
    return commerceJson({ error: "operator_fulfillment_unavailable" }, 503);
  }
  return commerceJson(data);
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  if (
    !isRecord(body) || typeof body.action !== "string" || !ACTIONS.has(body.action) ||
    !isIds(body.inventoryItemIds) || !UUID.test(String(body.idempotencyKey ?? "")) ||
    !isVersions(body.expectedVersions, body.inventoryItemIds.length)
  ) {
    return commerceJson({ error: "invalid_fulfillment_request" }, 422);
  }

  const ordered = body.inventoryItemIds.map((id, index) => ({
    id,
    version: (body.expectedVersions as number[])[index],
  })).sort((a, b) => a.id.localeCompare(b.id));
  const rpc = auth.user as unknown as RpcClient;
  const note = typeof body.note === "string" ? body.note : null;
  const result = body.action === "store_requested_items"
    ? (
      typeof body.workId === "string" && UUID.test(body.workId) &&
        Number.isSafeInteger(body.expectedWorkVersion)
        ? await rpc.rpc("release_buyer_inventory_shipment_items", {
          p_work_id: body.workId,
          p_inventory_item_ids: ordered.map((item) => item.id),
          p_expected_work_version: body.expectedWorkVersion,
          p_idempotency_key: body.idempotencyKey,
          p_note: note,
        })
        : null
    )
    : await rpc.rpc("release_buyer_paid_inventory_items", {
      p_inventory_item_ids: ordered.map((item) => item.id),
      p_expected_versions: ordered.map((item) => item.version),
      p_idempotency_key: body.idempotencyKey,
      p_note: note,
    });

  if (!result) return commerceJson({ error: "invalid_work" }, 422);
  if (result.error) return failure(result.error);
  return commerceJson({ result: result.data });
}
