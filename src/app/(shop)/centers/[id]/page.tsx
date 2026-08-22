import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreMallExperience } from "@/components/features/catalog/StoreMallExperience";
import { resolveStoreCatalogDate } from "@/lib/catalogDate";
import { fetchStoreSoldFeedProducts } from "@/services/products";
import { fetchStoreByIdentifier, fetchStoreProductDates, fetchStoreProducts } from "@/services/stores";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> { const { id } = await params; const store = await fetchStoreByIdentifier(id).catch(() => null); return store ? { title: `${store.name} 센터몰`, description: store.description.slice(0, 160), alternates: { canonical: `/centers/${encodeURIComponent(store.slug)}` } } : {}; }
export default async function CenterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string }> }) { const [{ id }, query] = await Promise.all([params, searchParams]); const store = await fetchStoreByIdentifier(id); if (!store) notFound(); const dates = await fetchStoreProductDates(store.id); const selectedDate = resolveStoreCatalogDate(query.date, dates); const [fixed, auctions, soldFixed, soldAuctions] = await Promise.all([fetchStoreProducts(store.id, "fixed", selectedDate), fetchStoreProducts(store.id, "auction", selectedDate), fetchStoreSoldFeedProducts({ storeId: store.id, saleType: "fixed" }), fetchStoreSoldFeedProducts({ storeId: store.id, saleType: "auction" })]); return <StoreMallExperience auctions={auctions} dates={dates} fixed={fixed} routeSegment="centers" selectedDate={selectedDate} slug={store.slug} sold={[...soldFixed, ...soldAuctions]} store={store} surface="desktop" />; }
