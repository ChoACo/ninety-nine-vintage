import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreMallCatalogPage } from "@/components/features/catalog/StoreMallCatalogPage";
import { resolveStoreCatalogDate } from "@/lib/catalogDate";
import { fetchStoreBySlug, fetchStoreProductDates, fetchStoreProducts } from "@/services/stores";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const store = await fetchStoreBySlug(slug).catch(() => null);
  if (!store) return {};
  const title = `${store.name} 신상품`;
  const url = `/stores/${encodeURIComponent(slug)}/new`;
  return { title, alternates: { canonical: url } };
}

export default async function MobileStoreNewArrivalsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const store = await fetchStoreBySlug(slug);
  if (!store) notFound();
  const dates = await fetchStoreProductDates(store.id);
  const selectedDate = resolveStoreCatalogDate(query.date, dates);
  const [auctions, fixed] = await Promise.all([
    fetchStoreProducts(store.id, "auction", selectedDate),
    fetchStoreProducts(store.id, "fixed", selectedDate),
  ]);
  return <StoreMallCatalogPage basePath="/m" dates={dates} products={[...auctions, ...fixed]} selectedDate={selectedDate} slug={slug} store={store} surface="mobile" tab="new" />;
}