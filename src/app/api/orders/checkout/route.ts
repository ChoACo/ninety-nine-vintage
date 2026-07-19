import { authenticateCommerceRequest, commerceJson, normalizeIds } from "@/lib/commerce/server";

export async function POST(request: Request) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as {
    productIds?: unknown;
    applyShippingCredit?: boolean;
    idempotencyKey?: string;
  } | null;
  const productIds = normalizeIds(body?.productIds);
  const idempotencyKey = body?.idempotencyKey?.trim();
  if (productIds.length === 0 || !idempotencyKey) {
    return commerceJson({ error: "상품과 주문 요청 키가 필요합니다." }, 400);
  }

  const { data, error } = await auth.user.rpc("create_commerce_order", {
    p_product_ids: productIds,
    p_idempotency_key: idempotencyKey,
    p_apply_shipping_credit: Boolean(body?.applyShippingCredit),
  });
  if (error) {
    const status = ["23505", "P0001", "P0002", "22023"].includes(error.code ?? "") ? 409 : 503;
    return commerceJson({ error: error.message || "주문을 만들지 못했습니다." }, status);
  }
  return commerceJson({ order: data }, 201);
}
