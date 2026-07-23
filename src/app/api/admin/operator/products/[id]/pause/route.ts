import {
  authenticateStaffRequest,
  commerceJson,
} from "@/lib/commerce/server";

interface RpcClient {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "operator_products_forbidden" }, 403);
  }
  const body = await request.json().catch(() => null) as Record<
    string,
    unknown
  > | null;
  if (!validTimestamp(body?.expectedUpdatedAt)) {
    return commerceJson({ error: "expected_updated_at_required" }, 400);
  }
  const { id } = await params;
  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "pause_managed_product",
    {
      p_product_id: id,
      p_expected_updated_at: body.expectedUpdatedAt,
    },
  );
  if (error) {
    const status =
      error.code === "42501"
        ? 403
        : error.code === "P0002"
          ? 404
          : error.code === "PT409"
            ? 409
            : 422;
    return commerceJson(
      { error: error.message ?? "상품을 일시중지하지 못했습니다." },
      status,
    );
  }
  const product = Array.isArray(data) ? data[0] : data;
  if (!product) {
    return commerceJson({ error: "paused_product_unavailable" }, 503);
  }
  return commerceJson({ product });
}
