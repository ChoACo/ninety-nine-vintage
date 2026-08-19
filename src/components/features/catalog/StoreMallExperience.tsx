import { ArrowRight, CalendarDays, MessageCircle, PackageCheck, Store } from "lucide-react";
import Link from "next/link";

import { StoreMallSplitSales } from "@/components/features/catalog/StoreMallSplitSales";
import { StoreMallTabs } from "@/components/features/catalog/StoreMallTabs";
import { StoreMallDateNav } from "@/components/features/catalog/StoreMallDateNav";
import { CatalogImage } from "@/components/ui/CatalogImage";
import type { PublishedProduct, SoldFeedProduct } from "@/services/products";
import type { PublicStore } from "@/services/stores";

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
}

function priceOf(product: PublishedProduct) {
  return product.saleType === "fixed" ? product.fixedPrice ?? product.currentPrice : product.currentPrice;
}

export function StoreMallExperience({ auctions, basePath = "", dates, fixed, selectedDate, slug, sold, store, surface }: StoreMallExperienceProps) {
  const products = [...auctions, ...fixed];
  const secondary = products.slice(1, 3);
  const isDesktop = surface === "desktop";
  const chatHref = `${basePath}/chat?storeId=${store.id}`;
  return <div className={isDesktop ? "pb-24" : "pb-8"}>
    <StoreMallTabs active="main" basePath={basePath} chatHref={chatHref} slug={slug} surface={surface} />

    <section className={`relative overflow-hidden border-b border-line bg-surface text-ink ${isDesktop ? "grid min-h-[520px] grid-cols-[1.05fr_.95fr]" : "-mx-4"}`}>
      <div className={`relative z-10 flex flex-col justify-between ${isDesktop ? "p-12" : "min-h-[430px] p-6"}`}>
        <div><p className="text-[10px] font-bold tracking-[.24em] text-muted">NINETY-NINE SELLER STORE</p><div className="mt-6 inline-flex items-center gap-2 rounded-full border border-line px-3 py-2 text-[10px]"><Store size={13} /> 공식 판매 센터몰</div></div>
        <div><h1 className={`${isDesktop ? "text-7xl" : "text-5xl"} font-black leading-[.9] tracking-[-.09em]`}>{store.name}</h1><p className="mt-6 max-w-lg text-sm leading-7 text-muted">{store.description || "매일 새롭게 선보이는 상품을 경매와 즉시구매로 만나보세요."}</p><div className="mt-7 flex flex-wrap gap-3"><a className="inline-flex min-h-12 items-center gap-2 bg-ink px-5 text-xs font-black text-paper" href="#sales-catalog">오늘의 상품 <ArrowRight size={15} /></a><Link className="inline-flex min-h-12 items-center gap-2 border border-line px-5 text-xs font-black" href={chatHref}><MessageCircle size={15} /> 센터 문의</Link></div></div>
      </div>
      <div className={`relative border-l border-line bg-surface ${isDesktop ? "min-h-[520px]" : "h-[360px]"}`}>
        {store.mallImage ? <><CatalogImage alt={`${store.name} 센터 배너`} className="size-full object-cover" maxDimension={1280} sizes={isDesktop ? "560px" : "100vw"} src={store.mallImage} /><div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" /></> : <div className="relative grid size-full place-items-center text-center" style={{ background: "var(--store-card-1)" }}><div className="absolute inset-0 bg-black/30" /><div className="relative px-6 text-sm text-white/90"><PackageCheck className="mx-auto mb-3" /><p>센터 배너 이미지를 등록하면 이곳에 표시됩니다.</p></div></div>}
      </div>
    </section>

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