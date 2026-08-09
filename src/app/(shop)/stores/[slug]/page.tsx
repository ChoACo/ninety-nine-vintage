import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductRail } from "@/components/features/catalog/ProductRail";
import { fetchStoreBySlug, fetchStoreProducts } from "@/services/stores";
import { fetchStoreSoldFeedProducts } from "@/services/products";

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
  const [fixed, auctions, soldFixed, soldAuctions] = await Promise.all([
    fetchStoreProducts(store.id, "fixed"), fetchStoreProducts(store.id, "auction"),
    fetchStoreSoldFeedProducts({ storeId: store.id, saleType: "fixed" }),
    fetchStoreSoldFeedProducts({ storeId: store.id, saleType: "auction" }),
  ]);
  return <div><div className="flex min-h-[360px] flex-col justify-between bg-[var(--store-card-1)] p-8"><div><p className="eyebrow">엄선된 숍 · 숍 소개 · 센터몰</p><h1 className="mt-20 text-6xl font-black tracking-[-.1em]">{store.name}</h1></div><div className="flex items-end justify-between gap-6"><div><p className="max-w-md text-sm leading-6">{store.description}</p><p className="mt-3 text-xs text-muted">판매·배송·상품 문의는 이 센터가 직접 담당합니다.</p></div><div className="flex gap-4"><Link className="text-xs font-bold underline" href={`/chat?store=${store.id}`}>센터 문의</Link><Link className="text-xs font-bold underline" href="/shop">전체 상품</Link></div></div></div><ProductRail eyebrow="센터몰 · 판매 중" title="즉시구매 상품" products={fixed} href="/shop" surface="desktop" /><ProductRail eyebrow="센터몰 · 경매" title="진행 중 경매" products={auctions} href="/feed" surface="desktop" /><ProductRail eyebrow="센터몰 · 판매완료" title="판매완료 상품" products={[...soldFixed, ...soldAuctions]} href="/sold" surface="desktop" /></div>;
}
