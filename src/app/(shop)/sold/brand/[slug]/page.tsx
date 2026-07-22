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
  const brand = (await fetchSoldBrands().catch(() => [])).find((item) => item.brand_slug === slug);
  const title = `${brand?.brand ?? slug} 빈티지 판매 기록 | NINETY-NINE VINTAGE`;
  const description = `${brand?.brand ?? slug} 빈티지 상품의 낙찰가와 판매 기록을 확인하세요.`;
  const url = `/sold/brand/${encodeURIComponent(slug)}`;
  return { title, description, alternates: { canonical: url, media: { "only screen and (max-width: 1023px)": `/m${url}` } }, openGraph: { title, description, url, type: "website" } };
}

export default async function SoldBrandPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ before?: string; beforeId?: string }> }) {
  const [{ slug: encodedSlug }, query] = await Promise.all([params, searchParams]);
  const slug = decodeBrandSlug(encodedSlug);
  const brands = await fetchSoldBrands().catch(() => []);
  if (!brands.some((brand) => brand.brand_slug === slug)) notFound();
  return <SoldArchiveView brandSlug={slug} before={query.before} beforeId={query.beforeId} />;
}
