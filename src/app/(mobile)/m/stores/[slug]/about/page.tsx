import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreMallStoreInfo } from "@/components/features/catalog/StoreMallStoreInfo";
import { fetchStoreBySlug } from "@/services/stores";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const store = await fetchStoreBySlug(slug).catch(() => null);
  if (!store) return {};
  const title = `${store.name} 센터 정보`;
  const url = `/stores/${encodeURIComponent(slug)}/about`;
  return { title, alternates: { canonical: url } };
}

export default async function MobileStoreAboutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await fetchStoreBySlug(slug);
  if (!store) notFound();
  return <StoreMallStoreInfo basePath="/m" slug={slug} store={store} surface="mobile" />;
}