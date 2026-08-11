import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SoldArchiveView } from "@/components/features/sold/SoldArchiveView";
import { fetchSoldBrands } from "@/services/sold";

export const dynamic = "force-dynamic";

function decodeBrandSlug(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug: encodedSlug } = await params;
  const slug = decodeBrandSlug(encodedSlug);
  return { title: "브랜드 판매 기록", alternates: { canonical: `/sold/brand/${encodeURIComponent(slug)}` } };
}

export default async function MobileSoldBrandPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ before?: string; beforeId?: string }> }) {
  const [{ slug: encodedSlug }, query] = await Promise.all([params, searchParams]);
  const slug = decodeBrandSlug(encodedSlug);
  const brands = await fetchSoldBrands().catch(() => []);
  if (!brands.some((brand) => brand.brand_slug === slug)) notFound();
  return <SoldArchiveView before={query.before} beforeId={query.beforeId} brandSlug={slug} rootPath="/m" surface="mobile" />;
}
