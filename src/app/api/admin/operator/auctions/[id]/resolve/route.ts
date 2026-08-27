import {
  authenticateOperatorStoreRequest,
  commerceJson,
  verifyOperatorProductScope,
} from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveErrorStatus(code?: string) {
  if (code === "22023") return 400;
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (["P0001", "55000", "23505"].includes(code ?? "")) return 409;
  return 503;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "forbidden" }, 403);
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return commerceJson({ error: "invalid_product_id" }, 400);
  }
  const body = (await request.json().catch(() => null)) as {
    action?: string;
  } | null;
  const action =
    body?.action === "relist"
      ? "relist"
      : body?.action === "archive"
        ? "archive"
        : body?.action === "delete"
          ? "delete"
        : "";
  if (!action) {
    return commerceJson({ error: "invalid_action" }, 400);
  }

  const scopeError = await verifyOperatorProductScope(auth.user, auth.selectedStoreId, id);
  if (scopeError) return scopeError;

  const { data, error } = await auth.user
    .rpc("operator_resolve_expired_auction", {
      p_product_id: id,
      p_action: action,
    })
    .single();
  if (error) {
    return commerceJson(
      { error: error.message || "auction_resolution_failed" },
      resolveErrorStatus(error.code),
    );
  }
  if (!data || data.product_id !== id || data.action !== action) {
    return commerceJson({ error: "auction_resolution_result_unavailable" }, 503);
  }

  return commerceJson({
    result: {
      action: data.action,
      product_id: data.product_id,
      new_product_id: data.new_product_id,
      fixed_price: data.fixed_price,
      current_price: data.current_price,
      publish_at: data.publish_at,
      closes_at: data.closes_at,
    },
  });
}
