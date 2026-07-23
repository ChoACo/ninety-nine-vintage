import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductRail } from "@/components/features/catalog/ProductRail";
import { fetchStoreBySlug, fetchStoreProducts } from "@/services/stores";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const store = await fetchStoreBySlug(slug).catch(() => null);
  if (!store) return {};
  const title = `${store.name} | NINETY-NINE VINTAGE`;
  const description = store.description.slice(0, 160);
  const url = `/stores/${encodeURIComponent(slug)}`;
  return { title, description, alternates: { canonical: url, media: { "only screen and (max-width: 1279px)": `/m${url}` } }, openGraph: { title, description, url, type: "website" } };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await fetchStoreBySlug(slug);
  if (!store) notFound();
  const products = await fetchStoreProducts(store.id, "fixed");
  return <div><div className="flex min-h-[360px] flex-col justify-between bg-[var(--store-card-1)] p-8"><div><p className="eyebrow">엄선된 숍 · 숍 소개</p><h1 className="mt-20 text-6xl font-black tracking-[-.1em]">{store.name}</h1></div><div className="flex items-end justify-between gap-6"><p className="max-w-md text-sm leading-6">{store.description}</p><Link className="text-xs font-bold underline" href="/shop">전체 상품 보기</Link></div></div><ProductRail eyebrow="숍 · 즉시 구매" title={`${store.name}의 선택`} products={products} href="/shop" surface="desktop" /></div>;
}
