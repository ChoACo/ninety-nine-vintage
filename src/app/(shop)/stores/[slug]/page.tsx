import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductRail } from "@/components/features/catalog/ProductRail";
import { StoreMallDateNav } from "@/components/features/catalog/StoreMallDateNav";
import { normalizeCatalogDate } from "@/lib/catalogDate";
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

export default async function StorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const selectedDate = normalizeCatalogDate(query.date);
  const store = await fetchStoreBySlug(slug);
  if (!store) notFound();
  const [fixed, auctions, soldFixed, soldAuctions] = await Promise.all([
    fetchStoreProducts(store.id, "fixed", selectedDate), fetchStoreProducts(store.id, "auction", selectedDate),
    fetchStoreSoldFeedProducts({ storeId: store.id, saleType: "fixed" }),
    fetchStoreSoldFeedProducts({ storeId: store.id, saleType: "auction" }),
  ]);
  return <div>
    <nav className="sticky top-0 z-20 -mx-4 flex gap-6 overflow-x-auto border-b border-line bg-paper/95 px-4 py-4 text-xs font-bold backdrop-blur" aria-label="센터몰 메뉴">
      <a href="#store-info">센터 정보</a><a href="#store-auctions">경매</a><a href="#store-fixed">즉시구매</a><Link href={`/chat?storeId=${store.id}`}>문의하기</Link>
    </nav>
    <section className="flex min-h-[360px] flex-col justify-between bg-[var(--store-card-1)] p-8" id="store-info"><div><p className="eyebrow">판매 센터몰 · 센터 소개</p><h1 className="mt-20 text-6xl font-black tracking-[-.1em]">{store.name}</h1></div><div className="flex items-end justify-between gap-6"><div><p className="max-w-md text-sm leading-6">{store.description}</p><p className="mt-3 text-xs text-muted">판매·배송·상품 문의는 이 센터가 직접 담당합니다.</p></div><div className="flex gap-4"><Link className="text-xs font-bold underline" href={`/chat?storeId=${store.id}`}>센터 문의</Link><Link className="text-xs font-bold underline" href="/shop">전체 상품</Link></div></div></section>
    <section className="mt-10 border-y border-line py-6"><p className="eyebrow">등록 날짜별 보기 · 기본값 오늘</p><StoreMallDateNav selectedDate={selectedDate} slug={slug} /></section>
    <div id="store-auctions"><ProductRail eyebrow={`${selectedDate} · 센터 경매`} title="진행 중 경매" products={auctions} href={`/feed?date=${selectedDate}`} surface="desktop" /></div>
    <div id="store-fixed"><ProductRail eyebrow={`${selectedDate} · 센터 즉시구매`} title="즉시구매 상품" products={fixed} href={`/shop?date=${selectedDate}`} surface="desktop" /></div>
    <ProductRail eyebrow="센터몰 · 판매완료" title="판매완료 상품" products={[...soldFixed, ...soldAuctions]} href="/sold" surface="desktop" />
  </div>;
}
