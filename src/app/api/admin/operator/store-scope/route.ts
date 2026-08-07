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

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (!["owner", "operator"].includes(auth.roleCode)) {
    return commerceJson({ error: "forbidden" }, 403);
  }
  const rpc = auth.user as unknown as RpcClient;
  const { data: scope, error } = await rpc.rpc("get_operator_store_scope");
  if (error) {
    return commerceJson(
      { error: error.message ?? "store_scope_unavailable" },
      error.code === "42501" ? 403 : 503,
    );
  }

  let stores: Array<{ id: string; name: string; slug: string }> = [];
  if (auth.roleCode === "owner") {
    const { data: rows, error: storeError } = await auth.user
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
    const { data: memberships, error: membershipError } = await auth.user
      .from("store_memberships")
      .select("store_id")
      .eq("user_id", auth.userId)
      .eq("status", "active")
      .eq("membership_role", "operator");
    if (membershipError) {
      return commerceJson({ error: "store_scope_unavailable" }, 503);
    }
    const storeIds = (memberships ?? []).map(
      (membership) => membership.store_id,
    );
    if (storeIds.length > 0) {
      const { data: rows, error: storeError } = await auth.user
        .from("stores")
        .select("id, name, slug")
        .eq("is_active", true)
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
  }
  return commerceJson({ scope, stores });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (!["owner", "operator"].includes(auth.roleCode)) {
    return commerceJson({ error: "forbidden" }, 403);
  }
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const scope =
    typeof body?.scope === "string" && body.scope !== "all"
      ? "store"
      : "all";
  const storeId =
    scope === "store" && typeof body?.storeId === "string"
      ? body.storeId
      : null;
  const rpc = auth.user as unknown as RpcClient;
  const { data, error } = await rpc.rpc("set_operator_store_scope", {
    p_scope: scope,
    p_store_id: storeId,
  });
  if (error) {
    return commerceJson(
      { error: error.message ?? "store_scope_update_failed" },
      error.code === "42501"
        ? 403
        : error.code === "P0002"
          ? 404
          : error.code === "22023"
            ? 422
            : 503,
    );
  }
  return commerceJson({ scope: data });
}
