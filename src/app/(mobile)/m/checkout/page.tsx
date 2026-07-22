import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CartView } from "@/components/features/commerce/CartView";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const metadata: Metadata = { title: "바로 결제", robots: { follow: false, index: false } };

export default async function MobileCheckoutPage({ searchParams }: { searchParams: Promise<{ productId?: string | string[] }> }) {
  const value = (await searchParams).productId;
  const productId = typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
  if (!productId) notFound();
  return <CartView basePath="/m" selectedProductId={productId} surface="mobile" />;
}
