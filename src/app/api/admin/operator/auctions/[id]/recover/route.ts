import { authenticateOperatorStoreRequest, commerceJson, verifyOperatorProductScope } from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function recoveryErrorStatus(code?: string) {
  if (code === "22023") return 400;
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (["55000", "P0001"].includes(code ?? "")) return 409;
  return 503;
}

interface RecoveryRow {
  closes_at: string | null;
  mode: string;
  price: number | null;
  product_id: string;
  publish_at: string | null;
  status: string;
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

  const body = (await request.json().catch(() => null)) as {
    mode?: unknown;
  } | null;
  const mode = body?.mode === "reauction" || body?.mode === "fixed"
    ? body.mode
    : null;
  if (!mode) {
    return commerceJson({ error: "invalid_recovery_mode" }, 400);
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return commerceJson({ error: "invalid_product_id" }, 400);
  }
  const scopeError = await verifyOperatorProductScope(auth.user, auth.selectedStoreId, id);
  if (scopeError) return scopeError;

  // The RPC ships with its migration; generated database types catch up on
  // the next `supabase gen types` run, so call it through the loose client.
  const { data, error } = await (auth.user as unknown as {
    rpc: (
      name: "operator_recover_unpaid_auction",
      args: { p_mode: string; p_product_id: string },
    ) => Promise<{ data: RecoveryRow[] | null; error: { code?: string; message: string } | null }>;
  }).rpc("operator_recover_unpaid_auction", { p_mode: mode, p_product_id: id });
  if (error) {
    return commerceJson(
      { error: error.message || "auction_recovery_failed" },
      recoveryErrorStatus(error.code),
    );
  }
  const result = data?.length === 1 ? data[0] : null;
  if (!result || result.product_id !== id) {
    return commerceJson({ error: "recovery_result_unavailable" }, 503);
  }

  return commerceJson({
    result: {
      closesAt: result.closes_at,
      mode: result.mode,
      price: result.price,
      productId: result.product_id,
      publishAt: result.publish_at,
      status: result.status,
    },
  });
}
