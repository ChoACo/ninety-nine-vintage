import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function secondChanceErrorStatus(code?: string) {
  if (code === "22023") return 400;
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (["23505", "55000", "P0001"].includes(code ?? "")) return 409;
  return 503;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "forbidden" }, 403);
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return commerceJson({ error: "invalid_product_id" }, 400);
  }

  const { data: paymentMode, error: paymentModeError } = await auth.admin.rpc(
    "get_payment_runtime_mode_for_service",
  );
  if (paymentModeError) {
    return commerceJson({ error: "payment_mode_unavailable" }, 503);
  }
  if (paymentMode !== "manual_transfer") {
    return commerceJson(
      {
        code: "second_chance_manual_transfer_only",
        error:
          "차순위 낙찰 제안은 현재 계좌이체 운영 모드에서만 사용할 수 있습니다.",
      },
      409,
    );
  }

  const { data, error } = await auth.user
    .rpc("operator_process_second_chance", { p_product_id: id })
    .single();
  if (error) {
    return commerceJson(
      { error: error.message || "second_chance_failed" },
      secondChanceErrorStatus(error.code),
    );
  }
  if (!data || data.product_id !== id) {
    return commerceJson({ error: "second_chance_result_unavailable" }, 503);
  }

  return commerceJson({
    result: {
      bidderDisplayName: data.bidder_display_name,
      offerId: data.offer_id,
      offeredAmount: data.offered_amount,
      processedCount: data.processed_count,
      productId: data.product_id,
      responseDueAt: data.response_due_at,
      serverTime: data.server_time,
      status: data.offer_status,
    },
  });
}
