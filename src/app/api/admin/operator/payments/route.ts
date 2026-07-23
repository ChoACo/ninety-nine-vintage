import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_KINDS = new Set(["commerce", "auction", "shipping_fee"]);

interface RpcError {
  code?: string;
}

interface RpcClient {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

interface QueuePayment {
  paymentKind: "commerce" | "auction" | "shipping_fee";
  paymentId: string;
  businessId: string;
  memberId: string;
  reference: string;
  expectedAmount: number;
  receivedAmount: number;
  remainingAmount: number;
  ledgerEntryCount: number;
  version: number;
  status: string;
  bankNameSnapshot: string | null;
  accountNumberSnapshot: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  lastDepositorName: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parsePage(request: Request) {
  const params = new URL(request.url).searchParams;
  const allowed = ["includeHistory", "limit", "offset"];
  if (
    [...params.keys()].some((key) => !allowed.includes(key)) ||
    allowed.some((key) => params.getAll(key).length > 1)
  ) {
    return null;
  }
  const includeHistory = params.get("includeHistory") ?? "false";
  const limit = params.has("limit") ? Number(params.get("limit")) : 50;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  if (
    !["true", "false"].includes(includeHistory) ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000
  ) {
    return null;
  }
  return { includeHistory: includeHistory === "true", limit, offset };
}

function isQueuePayment(value: unknown): value is QueuePayment {
  if (!isRecord(value)) return false;
  const fields = [
    "paymentKind",
    "paymentId",
    "businessId",
    "memberId",
    "reference",
    "expectedAmount",
    "receivedAmount",
    "remainingAmount",
    "ledgerEntryCount",
    "version",
    "status",
    "bankNameSnapshot",
    "accountNumberSnapshot",
    "requestedAt",
    "confirmedAt",
    "confirmedBy",
    "lastDepositorName",
  ];
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field)) &&
    typeof value.paymentKind === "string" && PAYMENT_KINDS.has(value.paymentKind) &&
    isUuid(value.paymentId) &&
    isUuid(value.businessId) &&
    isUuid(value.memberId) &&
    typeof value.reference === "string" &&
    isNonNegativeInteger(value.expectedAmount) &&
    isSafeInteger(value.receivedAmount) &&
    isSafeInteger(value.remainingAmount) &&
    isNonNegativeInteger(value.ledgerEntryCount) &&
    isNonNegativeInteger(value.version) &&
    typeof value.status === "string" &&
    isNullableText(value.bankNameSnapshot) &&
    isNullableText(value.accountNumberSnapshot) &&
    typeof value.requestedAt === "string" &&
    isNullableText(value.confirmedAt) &&
    isNullableText(value.confirmedBy) &&
    isNullableText(value.lastDepositorName);
}

function isQueueResponse(value: unknown): value is {
  payments: QueuePayment[];
  serverTime: string;
} {
  if (!isRecord(value) || Object.keys(value).length !== 2) return false;
  return Array.isArray(value.payments) && value.payments.every(isQueuePayment) &&
    typeof value.serverTime === "string";
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return commerceJson({ error: "payment_forbidden", message: "입금 확인 권한이 없습니다." }, 403);
  }
  if (error.code === "P0002") {
    return commerceJson({ error: "payment_not_found", message: "입금 요청을 찾을 수 없습니다." }, 404);
  }
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) {
    return commerceJson({ error: "payment_conflict", message: "입금 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요." }, 409);
  }
  if (error.code === "55000") {
    return commerceJson({ error: "payment_not_ready", message: "현재 입금 상태에서는 이 작업을 진행할 수 없습니다." }, 422);
  }
  if (["22023", "22003", "23514"].includes(error.code ?? "")) {
    return commerceJson({ error: "invalid_payment_request", message: "입금 확인 내용을 확인해 주세요." }, 422);
  }
  return commerceJson({ error: "payment_queue_unavailable", message: "입금 대기열을 처리하지 못했습니다." }, 503);
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "payment_forbidden" }, 403);
  }

  const page = parsePage(request);
  if (!page) {
    return commerceJson({ error: "invalid_payment_query", message: "조회 범위를 확인해 주세요." }, 422);
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_unified_manual_payment_queue",
    {
      p_include_history: page.includeHistory,
      p_limit: page.limit,
      p_offset: page.offset,
    },
  );
  if (error) return rpcFailure(error);
  if (!isQueueResponse(data)) {
    return commerceJson({ error: "payment_queue_unavailable", message: "입금 대기열을 확인하지 못했습니다." }, 503);
  }

  const memberIds = [...new Set(data.payments.map((payment) => payment.memberId))];
  const auctionIds = data.payments
    .filter((payment) => payment.paymentKind === "auction")
    .map((payment) => payment.paymentId);
  const commerceIds = data.payments
    .filter((payment) => payment.paymentKind === "commerce")
    .map((payment) => payment.paymentId);
  const [profileResult, auctionResult, commerceTransferResult] =
    await Promise.all([
      memberIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : auth.admin
            .from("profiles")
            .select("id, display_name")
            .in("id", memberIds),
      auctionIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : auth.admin
            .from("manual_transfer_orders")
            .select("id, product_id")
            .in("id", auctionIds),
      commerceIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : auth.admin
            .from("commerce_order_transfers")
            .select("id, order_id")
            .in("id", commerceIds),
    ]);
  if (
    profileResult.error ||
    auctionResult.error ||
    commerceTransferResult.error
  ) {
    return commerceJson(
      { error: "payment_queue_unavailable", message: "구매자와 상품 정보를 불러오지 못했습니다." },
      503,
    );
  }

  const commerceOrderIds = (commerceTransferResult.data ?? []).map(
    (transfer) => transfer.order_id,
  );
  const commerceItemResult =
    commerceOrderIds.length === 0
      ? { data: [], error: null }
      : await auth.admin
          .from("commerce_order_items")
          .select("order_id, product_id")
          .in("order_id", commerceOrderIds);
  if (commerceItemResult.error) {
    return commerceJson(
      { error: "payment_queue_unavailable", message: "주문 상품을 불러오지 못했습니다." },
      503,
    );
  }

  const productIds = [
    ...(auctionResult.data ?? []).map((order) => order.product_id),
    ...(commerceItemResult.data ?? []).map((item) => item.product_id),
  ];
  const uniqueProductIds = [...new Set(productIds)];
  const productResult =
    uniqueProductIds.length === 0
      ? { data: [], error: null }
      : await auth.admin
          .from("products")
          .select("id, title, image_urls, thumbnail_urls")
          .in("id", uniqueProductIds);
  if (productResult.error) {
    return commerceJson(
      { error: "payment_queue_unavailable", message: "상품 정보를 불러오지 못했습니다." },
      503,
    );
  }

  const buyerNames = new Map(
    (profileResult.data ?? []).map((profile) => [
      profile.id,
      profile.display_name,
    ]),
  );
  const productById = new Map(
    (productResult.data ?? []).map((product) => [
      product.id,
      {
        id: product.id,
        title: product.title,
        imageUrl:
          product.thumbnail_urls[0] ?? product.image_urls[0] ?? null,
      },
    ]),
  );
  const auctionProduct = new Map(
    (auctionResult.data ?? []).map((order) => [order.id, order.product_id]),
  );
  const orderByCommercePayment = new Map(
    (commerceTransferResult.data ?? []).map((transfer) => [
      transfer.id,
      transfer.order_id,
    ]),
  );
  const commerceProductIds = new Map<string, string[]>();
  for (const item of commerceItemResult.data ?? []) {
    commerceProductIds.set(item.order_id, [
      ...(commerceProductIds.get(item.order_id) ?? []),
      item.product_id,
    ]);
  }

  return commerceJson({
    serverTime: data.serverTime,
    payments: data.payments.map((payment) => {
      const linkedProductIds =
        payment.paymentKind === "auction"
          ? [auctionProduct.get(payment.paymentId)].filter(
              (id): id is string => Boolean(id),
            )
          : payment.paymentKind === "commerce"
            ? commerceProductIds.get(
                orderByCommercePayment.get(payment.paymentId) ?? "",
              ) ?? []
            : [];
      return {
        ...payment,
        buyerName: buyerNames.get(payment.memberId) ?? "이름 미확인 구매자",
        products: linkedProductIds.flatMap((id) => {
          const product = productById.get(id);
          return product ? [product] : [];
        }),
      };
    }),
  });
}
