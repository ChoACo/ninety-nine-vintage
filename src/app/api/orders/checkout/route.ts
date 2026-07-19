import { DEMO_PRODUCTS } from "@/lib/catalog";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { productIds?: string[]; applyShippingCredit?: boolean; idempotencyKey?: string } | null;
  const productIds = [...new Set(body?.productIds ?? [])];
  const products = DEMO_PRODUCTS.filter((product) => productIds.includes(product.id) && product.saleType === "fixed");
  if (products.length === 0) return Response.json({ error: "구매할 상품이 없습니다." }, { status: 400 });
  const subtotal = products.reduce((sum, product) => sum + product.price, 0);
  const shippingFee = body?.applyShippingCredit ? 0 : 3500;
  return Response.json({ order: { id: `demo-order-${Date.now()}`, status: "awaiting_payment", items: products, subtotal, shippingFee, total: subtotal + shippingFee, idempotencyKey: body?.idempotencyKey ?? null } }, { status: 201 });
}

