import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreMallStoreInfo } from "@/components/features/catalog/StoreMallStoreInfo";
import { fetchStoreBySlug } from "@/services/stores";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const store = await fetchStoreBySlug(slug).catch(() => null);
  if (!store) return {};
  const title = `${store.name} 센터 정보 | NINETY-NINE VINTAGE`;
  const description = store.description.slice(0, 160);
  const url = `/stores/${encodeURIComponent(slug)}/about`;
  return { title, description, alternates: { canonical: url, media: { "only screen and (max-width: 1279px)": `/m${url}` } } };
}

export default async function StoreAboutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await fetchStoreBySlug(slug);
  if (!store) notFound();
  return <StoreMallStoreInfo basePath="" slug={slug} store={store} surface="desktop" />;
}