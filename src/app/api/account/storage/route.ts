import { DEMO_PRODUCTS } from "@/lib/catalog";

export async function GET() {
  return Response.json({ items: DEMO_PRODUCTS.slice(0, 2).map((product, index) => ({ ...product, storageExpiresAt: new Date(Date.now() + (index ? 4 : 9) * 86400000).toISOString(), shippingEligible: true })), mode: "demo" }, { headers: { "Cache-Control": "no-store" } });
}

