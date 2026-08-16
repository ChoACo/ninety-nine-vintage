import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isScope(value: unknown): value is {
  active: boolean;
  accessMode: "assigned" | "owner_support";
  storeId: string | null;
  expiresAt: string | null;
} {
  if (!isRecord(value) || Object.keys(value).length !== 4) return false;
  return typeof value.active === "boolean" &&
    (value.accessMode === "assigned" || value.accessMode === "owner_support") &&
    (value.storeId === null || (typeof value.storeId === "string" && UUID_PATTERN.test(value.storeId))) &&
    (value.expiresAt === null || (typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt))));
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (!["owner", "operator"].includes(auth.roleCode)) {
    return commerceJson({ error: "forbidden" }, 403);
  }
  const rpc = auth.user as unknown as RpcClient;
  let scope: {
    active: boolean;
    accessMode: "assigned" | "owner_support";
    storeId: string | null;
    expiresAt: string | null;
  };

  let stores: Array<{ id: string; name: string; slug: string }> = [];
  if (auth.roleCode === "owner") {
    const { data, error } = await rpc.rpc("get_operator_store_scope");
    if (error || !isScope(data)) {
      return commerceJson(
        { error: error?.message ?? "store_scope_unavailable" },
        error?.code === "42501" ? 403 : 503,
      );
    }
    scope = data;
    // Owner support scope is an explicit server-authorized view. The user
    // client is still subject to public RLS and can return an empty/error
    // result even after the scope RPC has accepted the owner role.
    const { data: rows, error: storeError } = await auth.admin
      .from("stores")
      .select("id, name, slug")
      .eq("is_active", true)
      .order("name");
    if (storeError) {
      return commerceJson({ error: "store_scope_unavailable" }, 503);
    }
    stores = (rows ?? []).map((store) => ({
      id: store.id,
      name: store.name,
      slug: store.slug,
    }));
  } else {
    const scopedOperatorId = auth.effectiveOperatorId ?? auth.userId;
    // This table is deliberately unavailable to the service-role Data API.
    // Its RLS policy resolves an Owner canary to the effective operator, so
    // keep the scoped membership read on the authenticated client.
    const { data: memberships, error: membershipError } = await auth.user
      .from("store_memberships")
      .select("store_id")
      .eq("user_id", scopedOperatorId)
      .eq("status", "active")
      .eq("membership_role", "operator");
    if (membershipError) {
      return commerceJson({ error: "store_scope_unavailable" }, 503);
    }
    const storeIds = (memberships ?? []).map(
      (membership) => membership.store_id,
    );
    if (new Set(storeIds).size !== 1) {
      return commerceJson({
        error: "operator_store_assignment_required",
        message: "배정된 매장을 확인해 주세요.",
      }, 409);
    }
    if (storeIds.length > 0) {
      const { data: rows, error: storeError } = await auth.user
        .from("stores")
        .select("id, name, slug")
        .in("id", storeIds)
        .order("name");
      if (storeError) {
        return commerceJson({ error: "store_scope_unavailable" }, 503);
      }
      stores = (rows ?? []).map((store) => ({
        id: store.id,
        name: store.name,
        slug: store.slug,
      }));
    }
    scope = {
      active: true,
      accessMode: "assigned",
      storeId: storeIds[0],
      expiresAt: null,
    };
  }
  const expectedMode = auth.roleCode === "owner" ? "owner_support" : "assigned";
  if (scope.accessMode !== expectedMode) {
    return commerceJson({ error: "store_scope_unavailable" }, 503);
  }
  return commerceJson({
    scope,
    stores,
    canSelectStores: auth.roleCode === "owner",
  });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") {
    return commerceJson({ error: "forbidden" }, 403);
  }
  const body = await request.json().catch(() => null) as unknown;
  const expectedMode = "owner_support";
  if (!isRecord(body) || Object.keys(body).some((key) => !["storeId", "accessMode"].includes(key)) ||
    typeof body.storeId !== "string" || !UUID_PATTERN.test(body.storeId) ||
    body.accessMode !== expectedMode) {
    return commerceJson({
      error: "invalid_operator_store_scope",
      message: "접근 방식과 센터를 다시 선택해 주세요.",
    }, 422);
  }
  const rpc = auth.user as unknown as RpcClient;
  const { data, error } = await rpc.rpc("set_active_operator_store_scope", {
    p_store_id: body.storeId,
    p_access_mode: body.accessMode,
  });
  if (error || !isScope(data) || data.active !== true || data.storeId !== body.storeId ||
    data.accessMode !== expectedMode) {
    return commerceJson(
      { error: error?.message ?? "store_scope_update_failed" },
      error?.code === "42501"
        ? 403
        : error?.code === "P0002"
          ? 404
          : error?.code === "22023"
            ? 422
            : 503,
    );
  }
  return commerceJson({ scope: data });
}
