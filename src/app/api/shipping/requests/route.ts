import { authenticateCommerceRequest, commerceJson, normalizeIds } from "@/lib/commerce/server";

export async function POST(request: Request) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { productIds?: unknown; addressId?: string } | null;
  const productIds = normalizeIds(body?.productIds);
  if (productIds.length === 0 || !body?.addressId) {
    return commerceJson({ error: "배송 상품과 배송지를 선택해 주세요." }, 400);
  }
  const { data, error } = await auth.user.rpc("request_product_shipping", {
    p_address_id: body.addressId,
    p_product_ids: productIds,
  });
  if (error) return commerceJson({ error: error.message || "배송 요청을 만들지 못했습니다." }, 409);
  return commerceJson({ request: { id: data } }, 201);
}
