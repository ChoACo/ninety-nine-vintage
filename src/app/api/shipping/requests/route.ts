export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { productIds?: string[]; addressId?: string; useCredit?: boolean } | null;
  if (!body?.productIds?.length || !body.addressId) return Response.json({ error: "배송 상품과 배송지를 선택해 주세요." }, { status: 400 });
  return Response.json({ request: { id: `demo-shipping-${Date.now()}`, status: "requested", productIds: body.productIds, addressId: body.addressId, useCredit: Boolean(body.useCredit) } }, { status: 201 });
}

