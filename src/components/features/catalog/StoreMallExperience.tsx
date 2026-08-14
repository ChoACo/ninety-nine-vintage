import { ArrowRight, CalendarDays, Gavel, MessageCircle, PackageCheck, ShoppingBag, Store } from "lucide-react";
import Link from "next/link";

import { ProductRail } from "@/components/features/catalog/ProductRail";
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
  const featured = products[0];
  const secondary = products.slice(1, 3);
  const isDesktop = surface === "desktop";
  const storeHref = `${basePath}/stores/${encodeURIComponent(slug)}`;
  const chatHref = `${basePath}/chat?storeId=${store.id}`;
  return <div className={isDesktop ? "pb-24" : "pb-8"}>
    <nav aria-label="센터몰 메뉴" className={`sticky z-30 flex items-center gap-5 overflow-x-auto border-b border-line bg-paper/95 text-xs font-bold backdrop-blur [scrollbar-width:none] ${isDesktop ? "top-0 -mx-8 px-8 py-4" : "top-0 -mx-4 px-4 py-4"}`}>
      <a href="#new-arrivals">신상품</a><a href="#store-auctions">경매</a><a href="#store-fixed">즉시구매</a><a href="#store-story">센터 정보</a><Link className="ml-auto shrink-0 rounded-full bg-ink px-4 py-2 text-paper" href={chatHref}>문의하기</Link>
    </nav>

    <section className={`relative overflow-hidden bg-ink text-paper ${isDesktop ? "grid min-h-[520px] grid-cols-[1.05fr_.95fr]" : "-mx-4"}`}>
      <div className={`relative z-10 flex flex-col justify-between ${isDesktop ? "p-12" : "min-h-[430px] p-6"}`}>
        <div><p className="text-[10px] font-bold tracking-[.24em] text-zinc-400">NINETY-NINE SELLER STORE</p><div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-2 text-[10px]"><Store size={13} /> 공식 판매 센터몰</div></div>
        <div><h1 className={`${isDesktop ? "text-7xl" : "text-5xl"} font-black leading-[.9] tracking-[-.09em]`}>{store.name}</h1><p className="mt-6 max-w-lg text-sm leading-7 text-zinc-300">{store.description || "매일 새롭게 선보이는 상품을 경매와 즉시구매로 만나보세요."}</p><div className="mt-7 flex flex-wrap gap-3"><a className="inline-flex min-h-12 items-center gap-2 bg-paper px-5 text-xs font-black text-ink" href="#new-arrivals">오늘의 상품 <ArrowRight size={15} /></a><Link className="inline-flex min-h-12 items-center gap-2 border border-white/30 px-5 text-xs font-black" href={chatHref}><MessageCircle size={15} /> 센터 문의</Link></div></div>
      </div>
      <div className={`relative bg-zinc-900 ${isDesktop ? "min-h-[520px]" : "h-[360px]"}`}>
        {featured ? <><CatalogImage alt={featured.title} className="size-full object-cover opacity-90" maxDimension={1280} sizes={isDesktop ? "560px" : "100vw"} src={featured.imageUrls[0] ?? featured.thumbnailUrls[0] ?? ""} /><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-6"><p className="text-[10px] font-bold tracking-[.18em] text-zinc-300">FEATURED DROP</p><p className="mt-2 text-xl font-black">{featured.title}</p><p className="mt-2 font-mono text-sm">{priceOf(featured).toLocaleString("ko-KR")}원</p></div></> : <div className="grid size-full place-items-center text-center text-sm text-zinc-500"><div><PackageCheck className="mx-auto mb-3" /><p>다음 상품 공개를 준비하고 있습니다.</p></div></div>}
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

    <div id="store-auctions"><ProductRail basePath={basePath} eyebrow={`${selectedDate} · LIVE AUCTION`} href={`${basePath}/feed?date=${selectedDate}`} products={auctions} surface={surface} title="센터 경매관" /></div>
    <div id="store-fixed"><ProductRail basePath={basePath} eyebrow={`${selectedDate} · BUY NOW`} href={`${basePath}/shop?date=${selectedDate}`} products={fixed} surface={surface} title="센터 즉시구매관" /></div>
    <ProductRail basePath={basePath} eyebrow="SOLD ARCHIVE" href={`${basePath}/sold`} products={sold} surface={surface} title="이 센터에서 판매된 상품" />

    <section className={`mt-16 overflow-hidden border border-line ${isDesktop ? "grid grid-cols-2" : ""}`} id="store-story">
      <div className={`${isDesktop ? "p-10" : "p-6"} bg-[var(--store-card-1)]`}><p className="eyebrow">ABOUT THE CENTER</p><h2 className="mt-3 text-3xl font-black tracking-[-.07em]">{store.name}</h2><p className="mt-6 text-sm leading-7">{store.description}</p><p className="mt-5 text-xs leading-5 text-muted">상품 검수·판매·배송·문의는 이 판매 센터가 직접 담당합니다.</p></div>
      <div className={`${isDesktop ? "p-10" : "p-6"} bg-surface`}><p className="eyebrow text-muted">SHOPPING GUIDE</p><div className="mt-6 grid gap-4">{[{icon:Gavel,title:"경매",copy:"선택한 등록일의 진행 상품에 입찰합니다."},{icon:ShoppingBag,title:"즉시구매",copy:"판매 중인 상품을 바로 주문합니다."},{icon:MessageCircle,title:"센터 문의",copy:"상품·배송 질문을 판매 센터에 바로 남깁니다."}].map(({icon:Icon,title,copy}) => <div className="flex gap-4 border-b border-line pb-4" key={title}><Icon className="shrink-0" size={19} /><div><p className="text-sm font-black">{title}</p><p className="mt-1 text-xs text-muted">{copy}</p></div></div>)}</div><Link className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 bg-ink px-5 text-xs font-black text-paper" href={chatHref}>이 센터에 문의하기 <ArrowRight size={15} /></Link></div>
    </section>
    <div className="mt-8 text-center"><Link className="text-xs font-bold text-muted underline" href={storeHref}>센터몰 처음으로</Link></div>
  </div>;
}
