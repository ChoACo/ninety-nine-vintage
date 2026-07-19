import { DEMO_PRODUCTS } from "@/lib/catalog";

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

export async function GET() {
  return json({ items: DEMO_PRODUCTS.filter((product) => product.saleType === "fixed").slice(0, 2), mode: "demo" });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { productId?: string } | null;
  const product = DEMO_PRODUCTS.find((value) => value.id === body?.productId && value.saleType === "fixed");
  if (!product) return json({ error: "상품을 찾을 수 없습니다." }, 404);
  return json({ item: product, mode: "demo" }, 201);
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null) as { productId?: string } | null;
  return json({ removedProductId: body?.productId ?? null, mode: "demo" });
}

