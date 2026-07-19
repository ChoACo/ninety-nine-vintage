import { DEMO_PRODUCTS } from "@/lib/catalog";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({ order: { id, status: "awaiting_payment", items: DEMO_PRODUCTS.slice(3, 5), storagePolicy: { smallDays: 14, largeDays: 7 } } }, { headers: { "Cache-Control": "no-store" } });
}

