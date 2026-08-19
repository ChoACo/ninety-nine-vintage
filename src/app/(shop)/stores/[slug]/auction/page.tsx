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
  const title = `${store.name} 경매 | NINETY-NINE VINTAGE`;
  const url = `/stores/${encodeURIComponent(slug)}/auction`;
  return { title, alternates: { canonical: url, media: { "only screen and (max-width: 1279px)": `/m${url}` } } };
}

export default async function StoreAuctionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const store = await fetchStoreBySlug(slug);
  if (!store) notFound();
  const dates = await fetchStoreProductDates(store.id);
  const selectedDate = resolveStoreCatalogDate(query.date, dates);
  const auctions = await fetchStoreProducts(store.id, "auction", selectedDate);
  return <StoreMallCatalogPage basePath="" dates={dates} products={auctions} selectedDate={selectedDate} slug={slug} store={store} surface="desktop" tab="auction" />;
}