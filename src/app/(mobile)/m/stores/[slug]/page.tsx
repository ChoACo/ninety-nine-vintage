import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreMallExperience } from "@/components/features/catalog/StoreMallExperience";
import { resolveStoreCatalogDate } from "@/lib/catalogDate";
import { fetchStoreBySlug, fetchStoreProductDates, fetchStoreProducts } from "@/services/stores";
import { fetchStoreSoldFeedProducts } from "@/services/products";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const { slug } = await params; const store = await fetchStoreBySlug(slug).catch(() => null); return store ? { title: `${store.name} 센터몰`, description: store.description.slice(0, 160), alternates: { canonical: `/stores/${encodeURIComponent(slug)}` } } : {}; }

export default async function MobileStorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const store = await fetchStoreBySlug(slug);
  if (!store) notFound();
  const dates = await fetchStoreProductDates(store.id);
  const selectedDate = resolveStoreCatalogDate(query.date, dates);
  const [fixed, auctions, soldFixed, soldAuctions] = await Promise.all([
    fetchStoreProducts(store.id, "fixed", selectedDate), fetchStoreProducts(store.id, "auction", selectedDate),
    fetchStoreSoldFeedProducts({ storeId: store.id, saleType: "fixed" }), fetchStoreSoldFeedProducts({ storeId: store.id, saleType: "auction" }),
  ]);
  return <StoreMallExperience auctions={auctions} basePath="/m" dates={dates} fixed={fixed} selectedDate={selectedDate} slug={slug} sold={[...soldFixed, ...soldAuctions]} store={store} surface="mobile" />;
}
