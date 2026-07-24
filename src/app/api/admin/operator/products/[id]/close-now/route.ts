import {
  authenticateStaffRequest,
  commerceJson,
} from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") {
    return commerceJson(
      {
        error: "owner_required",
        message: "운영 총책임자만 경매를 즉시 마감할 수 있습니다.",
      },
      403,
    );
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as {
    reason?: unknown;
  } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!UUID_PATTERN.test(id) || reason.length < 2 || reason.length > 500) {
    return commerceJson(
      {
        error: "invalid_request",
        message: "즉시 마감 사유를 2~500자로 입력해 주세요.",
      },
      400,
    );
  }

  const { data, error } = await auth.user
    .rpc("owner_close_auction_now", {
      p_product_id: id,
      p_reason: reason,
    })
    .single();
  if (error || !data) {
    const status = error?.code === "42501"
      ? 403
      : error?.code === "P0002"
        ? 404
        : error?.code === "P0001"
          ? 409
          : 400;
    return commerceJson(
      {
        error: error?.code ?? "auction_close_failed",
        message: error?.message ?? "경매를 즉시 마감하지 못했습니다.",
      },
      status,
    );
  }

  return commerceJson({ result: data });
}
