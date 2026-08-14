import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductRail } from "@/components/features/catalog/ProductRail";
import { StoreMallDateNav } from "@/components/features/catalog/StoreMallDateNav";
import { normalizeCatalogDate } from "@/lib/catalogDate";
import { fetchStoreBySlug, fetchStoreProducts } from "@/services/stores";
import { fetchStoreSoldFeedProducts } from "@/services/products";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const { slug } = await params; const store = await fetchStoreBySlug(slug).catch(() => null); return store ? { title: store.name, description: store.description.slice(0, 160), alternates: { canonical: `/stores/${encodeURIComponent(slug)}` } } : {}; }

export default async function MobileStorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const selectedDate = normalizeCatalogDate(query.date);
  const store = await fetchStoreBySlug(slug);
  if (!store) notFound();
  const [fixed, auctions, soldFixed, soldAuctions] = await Promise.all([fetchStoreProducts(store.id,"fixed",selectedDate),fetchStoreProducts(store.id,"auction",selectedDate),fetchStoreSoldFeedProducts({storeId:store.id,saleType:"fixed"}),fetchStoreSoldFeedProducts({storeId:store.id,saleType:"auction"})]);
  return <div>
    <nav className="sticky top-0 z-20 -mx-4 flex gap-5 overflow-x-auto border-b border-line bg-paper/95 px-4 py-4 text-xs font-bold backdrop-blur" aria-label="센터몰 메뉴"><a href="#store-info">센터 정보</a><a href="#store-auctions">경매</a><a href="#store-fixed">즉시구매</a><Link href={`/m/chat?storeId=${store.id}`}>문의하기</Link></nav>
    <section className="-mx-4 flex min-h-[300px] flex-col justify-between bg-[var(--store-card-1)] p-6" id="store-info"><div><p className="eyebrow">판매 센터몰 · 센터 소개</p><h1 className="mt-16 text-4xl font-black tracking-[-.08em]">{store.name}</h1></div><div><p className="max-w-md text-sm leading-6">{store.description}</p><p className="mt-3 text-xs text-muted">판매·배송·상품 문의는 이 센터가 직접 담당합니다.</p><div className="mt-5 flex gap-4"><Link className="text-xs font-bold underline" href={`/m/chat?storeId=${store.id}`}>센터 문의</Link><Link className="text-xs font-bold underline" href="/m/shop">전체 상품</Link></div></div></section>
    <section className="mt-8 border-y border-line py-5"><p className="eyebrow">등록 날짜별 보기 · 기본값 오늘</p><StoreMallDateNav basePath="/m" selectedDate={selectedDate} slug={slug} /></section>
    <div id="store-auctions"><ProductRail basePath="/m" eyebrow={`${selectedDate} · 센터 경매`} href={`/m/feed?date=${selectedDate}`} products={auctions} surface="mobile" title="진행 중 경매" /></div>
    <div id="store-fixed"><ProductRail basePath="/m" eyebrow={`${selectedDate} · 센터 즉시구매`} href={`/m/shop?date=${selectedDate}`} products={fixed} surface="mobile" title="즉시구매 상품" /></div>
    <ProductRail basePath="/m" eyebrow="센터몰 · 판매완료" href="/m/sold" products={[...soldFixed,...soldAuctions]} surface="mobile" title="판매완료 상품" />
  </div>;
}
