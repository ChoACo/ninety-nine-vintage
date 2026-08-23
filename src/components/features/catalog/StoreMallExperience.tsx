import { ArrowRight, CalendarDays, ShieldCheck, Store } from "lucide-react";
import Link from "next/link";

import { StoreMallSplitSales } from "@/components/features/catalog/StoreMallSplitSales";
import { StoreMallTabs } from "@/components/features/catalog/StoreMallTabs";
import { StoreMallDateNav } from "@/components/features/catalog/StoreMallDateNav";
import { CatalogImage } from "@/components/ui/CatalogImage";
import type { PublishedProduct, SoldFeedProduct } from "@/services/products";
import type { PublicStore } from "@/services/stores";
import { CenterStorefrontActions } from "@/components/features/catalog/CenterStorefrontActions";
import { CenterRealtimeRefresh } from "@/components/features/catalog/CenterRealtimeRefresh";

interface StoreMallExperienceProps {
  auctions: PublishedProduct[];
  basePath?: "" | "/m";
  dates: string[];
  fixed: PublishedProduct[];
  selectedDate: string;
  slug: string;
  sold: SoldFeedProduct[];
  store: PublicStore;
  surface: "desktop" | "mobile";
  routeSegment?: "stores" | "centers";
}

function priceOf(product: PublishedProduct) {
  return product.saleType === "fixed" ? product.fixedPrice ?? product.currentPrice : product.currentPrice;
}

export function StoreMallExperience({ auctions, basePath = "", dates, fixed, routeSegment = "stores", selectedDate, slug, sold, store, surface }: StoreMallExperienceProps) {
  const products = [...auctions, ...fixed];
  const secondary = products.slice(1, 3);
  const isDesktop = surface === "desktop";
  const chatHref = `${basePath}/chat?storeId=${store.id}`;
  const heroImage = store.bannerUrl?.trim() || store.mallImage?.trim() || null;
  return <div className={isDesktop ? "pb-24" : "pb-8"}>
    <CenterRealtimeRefresh storeId={store.id} /><StoreMallTabs active="main" basePath={basePath} chatHref={chatHref} routeSegment={routeSegment} slug={slug} storeName={store.name} surface={surface} />
    {store.announcementEnabled && store.announcementText ? <div className="w-full max-w-full overflow-hidden break-keep border-b border-emerald-600 bg-emerald-500 px-4 py-3 text-center text-xs font-black text-zinc-950" role="status">{store.announcementText}</div> : null}

    <section className={`relative overflow-hidden border-b border-line bg-surface text-ink ${isDesktop ? "grid min-h-[520px] grid-cols-[1.05fr_.95fr]" : "-mx-4"}`}>
      <div className={`relative z-10 flex flex-col justify-between ${isDesktop ? "p-12" : "min-h-[430px] p-6"}`}>
        <div><p className="text-[10px] font-bold tracking-[.24em] text-muted">NINETY-NINE SELLER STORE</p><div className="mt-6 inline-flex items-center gap-2 rounded-full border border-line px-3 py-2 text-[10px]"><Store size={13} /> 공식 판매 센터몰</div></div>
        <div><h1 className={`${isDesktop ? "text-7xl" : "break-words text-3xl sm:text-5xl"} flex min-w-0 items-center gap-3 font-black leading-[.9] tracking-[-.09em]`}>{store.name}<ShieldCheck className="shrink-0 text-sky-500" size={isDesktop ? 28 : 22} /></h1><p className="mt-6 max-w-lg text-sm leading-7 text-muted">{store.description || "매일 새롭게 선보이는 상품을 경매와 즉시구매로 만나보세요."}</p><a className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-500 px-5 text-xs font-black text-zinc-950" href="#sales-catalog">오늘의 상품 <ArrowRight size={15} /></a><CenterStorefrontActions chatHref={chatHref} name={store.name} storeId={store.id} /></div>
      </div>
      <div className={`relative overflow-hidden bg-surface ${isDesktop ? "min-h-[520px] border-l border-line" : "h-32 w-full rounded-xl sm:h-48"}`}>
        {heroImage ? <><CatalogImage alt={`${store.name} 센터 배너`} className="size-full object-cover" maxDimension={1280} sizes={isDesktop ? "560px" : "100vw"} src={heroImage} /><div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" /></> : <div aria-label={`${store.name} 기본 배너`} className="relative grid size-full overflow-hidden place-items-center bg-gradient-to-br from-amber-950 via-stone-800 to-zinc-950 text-center"><div className="absolute -left-16 top-8 size-56 rounded-full bg-amber-400/20 blur-3xl" /><div className="absolute -bottom-20 right-0 size-72 rounded-full bg-rose-900/30 blur-3xl" /><div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_20%,rgba(255,255,255,.06)_20%,rgba(255,255,255,.06)_21%,transparent_21%,transparent_48%,rgba(255,255,255,.04)_48%,rgba(255,255,255,.04)_49%,transparent_49%)]" /><div className="relative max-w-xs border-y border-white/25 px-8 py-7 text-white"><p className="text-[10px] font-bold tracking-[.28em] text-amber-200">NINETY-NINE VINTAGE STORE</p><p className="mt-4 break-keep text-3xl font-black tracking-[-.06em]">{store.name}</p><p className="mt-3 text-[11px] tracking-[.14em] text-white/60">CURATED ARCHIVE · ONE OF ONE</p></div><div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-white/5" /></div>}
      </div>
    </section>

    <section className="mt-8 overflow-hidden rounded-3xl border border-emerald-500/30 bg-emerald-950 p-6 text-emerald-50 dark:text-emerald-100"><p className="text-[10px] font-black tracking-[.16em] text-emerald-400">CENTER VAULT & COMBINED SHIPPING</p><h2 className="mt-3 text-lg font-black">이 센터의 모든 상품은 최대 14일간 무료 보관됩니다.</h2><p className="mt-2 max-w-3xl text-xs leading-5 text-emerald-100/70">원하는 시점에 같은 센터 상품을 선택해 하나의 박스로 묶음 배송받을 수 있습니다.</p><span className="mt-4 inline-flex rounded-full bg-emerald-400 px-4 py-2 text-[10px] font-black text-emerald-950">같은 센터 상품 함께 담고 배송비 0원 만들기</span></section>

    <section className={`grid border-x border-b border-line bg-paper ${isDesktop ? "grid-cols-4" : "grid-cols-2"}`} aria-label="센터몰 현황">
      {[{label:"선택일 상품",value:`${products.length}개`},{label:"진행 경매",value:`${auctions.length}개`},{label:"즉시구매",value:`${fixed.length}개`},{label:"판매완료",value:`${sold.length}개`}].map((metric) => <div className="border-r border-line p-5 last:border-r-0" key={metric.label}><p className="text-[10px] text-muted">{metric.label}</p><p className="mt-2 font-mono text-xl font-black">{metric.value}</p></div>)}
    </section>

    <section className={`mt-10 border border-line bg-surface ${isDesktop ? "p-8" : "p-5"}`} id="new-arrivals">
      <div className="flex items-end justify-between gap-4"><div><p className="eyebrow text-muted">NEW ARRIVALS BY DATE</p><h2 className={`${isDesktop ? "text-3xl" : "text-2xl"} mt-2 font-black tracking-[-.06em]`}>상품이 있는 날만 골라보기</h2></div><CalendarDays className="shrink-0" /></div>
      <p className="mt-3 text-xs leading-5 text-muted">등록 상품이 없는 날짜는 자동으로 숨깁니다. 선택한 날의 신규 상품만 모아볼 수 있습니다.</p>
      <StoreMallDateNav basePath={basePath} dates={dates} selectedDate={selectedDate} slug={slug} />
    </section>

    {secondary.length > 0 && <section className={`mt-8 grid gap-3 ${isDesktop ? "grid-cols-2" : "grid-cols-1"}`} aria-label="센터 추천 상품">{secondary.map((product) => <Link className="group grid grid-cols-[120px_1fr] overflow-hidden border border-line bg-paper" href={`${basePath}/auction/${product.id}`} key={product.id}><CatalogImage alt="" className="aspect-square size-full object-cover transition-transform group-hover:scale-105" maxDimension={480} sizes="120px" src={product.thumbnailUrls[0] ?? product.imageUrls[0] ?? ""} /><div className="flex min-w-0 flex-col justify-between p-4"><div><p className="text-[9px] font-bold tracking-[.16em] text-muted">STORE PICK</p><p className="mt-2 truncate text-sm font-black">{product.title}</p></div><p className="font-mono text-xs font-bold">{priceOf(product).toLocaleString("ko-KR")}원</p></div></Link>)}</section>}

    <div id="sales-catalog"><StoreMallSplitSales auctions={auctions} basePath={basePath} fixed={fixed} selectedDate={selectedDate} slug={slug} surface={surface} /></div>
  </div>;
}
