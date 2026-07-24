import {
  authenticateMemberCommerceRequest,
  commerceJson,
} from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface RpcError {
  code?: string;
  message?: string;
}

interface RpcClient {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return commerceJson({ error: "회원 로그인이 필요합니다." }, 403);
  }
  if (error.code === "P0002") {
    return commerceJson({ error: "배송 크레딧 결제 신청을 찾지 못했습니다." }, 404);
  }
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) {
    return commerceJson(
      { error: error.message ?? "결제 신청 상태가 변경되었습니다." },
      409,
    );
  }
  if (["22023", "22003", "23514", "55000"].includes(error.code ?? "")) {
    return commerceJson(
      { error: error.message ?? "배송 크레딧 신청 정보를 확인해 주세요." },
      422,
    );
  }
  return commerceJson({ error: "shipping_credit_unavailable" }, 503);
}

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const [
    { data: account, error: accountError },
    { data: ledger, error: ledgerError },
    { data: payments, error: paymentError },
  ] = await Promise.all([
    auth.admin
      .from("member_accounts")
      .select("shipping_credit_count, last_depositor_name")
      .eq("member_id", auth.userId)
      .maybeSingle(),
    auth.admin
      .from("shipping_credit_ledger")
      .select("*")
      .eq("member_id", auth.userId)
      .order("created_at", { ascending: false }),
    auth.admin
      .from("shipping_fee_payments")
      .select(
        "id, status, version, expected_amount, credit_quantity, bank_name_snapshot, account_number_snapshot, depositor_name, requested_at",
      )
      .eq("member_id", auth.userId)
      .eq("payment_context", "shipping_credit")
      .in("status", ["awaiting_transfer", "partially_paid"])
      .order("requested_at", { ascending: false }),
  ]);
  if (accountError || ledgerError || paymentError) {
    return commerceJson({ error: "shipping_credit_unavailable" }, 503);
  }
  return commerceJson({
    credits: account?.shipping_credit_count ?? 0,
    rememberedDepositorName: account?.last_depositor_name ?? null,
    ledger: ledger ?? [],
    payments: payments ?? [],
  });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as {
    depositorName?: string;
    idempotencyKey?: string;
    quantity?: number;
  } | null;
  const idempotencyKey = body?.idempotencyKey?.trim() ?? "";
  const depositorName = body?.depositorName?.trim() ?? "";
  const quantity = Number(body?.quantity);
  if (
    !UUID_PATTERN.test(idempotencyKey) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 20 ||
    depositorName.length < 1 ||
    depositorName.length > 80
  ) {
    return commerceJson(
      { error: "수량과 입금자명을 확인해 주세요." },
      422,
    );
  }
  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "request_my_shipping_credit_payment",
    {
      p_quantity: quantity,
      p_depositor_name: depositorName,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (error) return rpcFailure(error);
  return commerceJson({ payment: data }, 201);
}

export async function DELETE(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as {
    expectedVersion?: number;
    idempotencyKey?: string;
    paymentId?: string;
  } | null;
  const paymentId = body?.paymentId?.trim() ?? "";
  const idempotencyKey = body?.idempotencyKey?.trim() ?? "";
  const expectedVersion = Number(body?.expectedVersion);
  if (
    !UUID_PATTERN.test(paymentId) ||
    !UUID_PATTERN.test(idempotencyKey) ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    return commerceJson({ error: "취소할 결제 신청을 확인해 주세요." }, 422);
  }
  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "cancel_my_shipping_credit_payment",
    {
      p_payment_id: paymentId,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (error) return rpcFailure(error);
  return commerceJson({ payment: data });
}
