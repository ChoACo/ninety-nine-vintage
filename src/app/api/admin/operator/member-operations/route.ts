import { authenticateOperatorStoreRequest, commerceJson } from "@/lib/commerce/server";

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function filterStoreScopedPayload(value: unknown, storeId: string, view: "storage" | "winners") {
  if (!isRecord(value)) return value;
  const collectionKey = view === "storage" ? "items" : "members";
  const collection = value[collectionKey];
  if (!Array.isArray(collection)) return value;
  if (view === "storage") {
    return {
      ...value,
      items: collection.filter((item) => isRecord(item) && item.originStoreId === storeId),
    };
  }
  return {
    ...value,
    members: collection
      .map((member) => {
        if (!isRecord(member) || !Array.isArray(member.items)) return null;
        const items = member.items.filter((item) => isRecord(item) && item.originStoreId === storeId);
        return items.length > 0 ? { ...member, items } : null;
      })
      .filter((member) => member !== null),
  };
}

export async function GET(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "member_operations_forbidden" }, 403);
  }

  const params = new URL(request.url).searchParams;
  const view = params.get("view");
  const limit = Number(params.get("limit") ?? (view === "storage" ? "100" : "50"));
  const offset = Number(params.get("offset") ?? "0");
  if (
    (view !== "storage" && view !== "winners") ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return commerceJson({ error: "invalid_member_operations_query" }, 422);
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    view === "storage"
      ? "get_operator_member_storage"
      : "get_operator_winning_members",
    { p_limit: limit, p_offset: offset },
  );
  if (error) {
    const status = error.code === "42501" ? 403 : 503;
    return commerceJson(
      { error: "member_operations_unavailable", message: error.message },
      status,
    );
  }
  if (
    !isRecord(data) ||
    typeof data.hasMore !== "boolean" ||
    (view === "storage" && !Array.isArray(data.items)) ||
    (view === "winners" && !Array.isArray(data.members))
  ) {
    return commerceJson({ error: "member_operations_unavailable" }, 503);
  }
  const scopedData = filterStoreScopedPayload(data, auth.selectedStoreId, view);
  const { data: chatStores } = auth.roleCode === "operator"
    ? await auth.admin
        .from("stores")
        .select("id, name")
        .eq("operator_id", auth.userId)
        .eq("is_active", true)
    : { data: [] };
  return commerceJson({ ...(scopedData as Record<string, unknown>), chatStores: chatStores ?? [] });
}
