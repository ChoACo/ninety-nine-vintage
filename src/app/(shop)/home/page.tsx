import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDownRight, ArrowUpRight, Clock3 } from "lucide-react";
import { ProductRail } from "@/components/features/catalog/ProductRail";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { fetchPublishedProducts } from "@/services/products";
import { fetchActiveStores } from "@/services/stores";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "오늘의 빈티지 | NINETY-NINE VINTAGE",
  description: "오늘 공개된 빈티지 상품과 실시간 경매를 한눈에 확인하세요.",
  alternates: { canonical: "/home", media: { "only screen and (max-width: 1023px)": "/m/home" } },
};

async function loadHomeData() {
  const [auctionResult, fixedResult, storesResult] = await Promise.allSettled([
    LIVE_AUCTION_ENABLED
      ? fetchPublishedProducts({ limit: 6, saleType: "auction", sort: "ending" })
      : Promise.resolve([]),
    fetchPublishedProducts({ limit: 6, saleType: "fixed", sort: "latest" }),
    fetchActiveStores(),
  ]);
  return {
    auctions: auctionResult.status === "fulfilled" ? auctionResult.value : [],
    fixed: fixedResult.status === "fulfilled" ? fixedResult.value : [],
    stores: storesResult.status === "fulfilled" ? storesResult.value : [],
    catalogUnavailable: fixedResult.status === "rejected",
    storesUnavailable: storesResult.status === "rejected",
  };
}

type HomeProducts = Awaited<ReturnType<typeof fetchPublishedProducts>>;
type HomeStores = Awaited<ReturnType<typeof fetchActiveStores>>;

interface HomePresentationProps {
  auctions: HomeProducts;
  feature: HomeProducts[number] | null;
  fixed: HomeProducts;
  stores: HomeStores;
}

function DesktopHome({ auctions, feature, fixed, stores }: HomePresentationProps) {
  return (
    <div className="space-y-16" data-home-presentation="desktop">
      <section className="theme-invariant-dark grid min-h-[560px] grid-cols-[1.05fr_.95fr] overflow-hidden bg-ink text-paper">
        <div className="flex flex-col justify-between p-10 lg:p-16">
          <div>
            <p className="text-[10px] font-bold tracking-[0.16em] text-zinc-400">오늘의 업데이트</p>
            <h1 className="mt-16 max-w-3xl text-[clamp(4rem,8vw,7.4rem)] font-black leading-[.88] tracking-[-.1em]">시간을<br />다시 입는<br /><span className="text-zinc-500">선택.</span></h1>
          </div>
          <div className="mt-14 flex max-w-lg items-end justify-between gap-8">
            <p className="text-sm leading-6 text-zinc-400">선별된 빈티지 한 점을<br />기다림 없이 바로 만나보세요.</p>
            <Link className="flex items-center gap-2 border-b border-paper pb-2 text-xs font-bold" href="/shop">즉시 구매 <ArrowUpRight size={14} /></Link>
          </div>
        </div>
        <Link className="group relative min-h-[560px] overflow-hidden bg-black" href={feature ? `/auction/${feature.id}` : "/shop"}>
          <CatalogImage alt="나인티 나인 빈티지 배너" className="h-full w-full object-cover object-center transition-transform duration-700 group-hover:scale-[1.02]" loading="lazy" maxDimension={1600} sizes="48vw" src="/banners/brand-banner-wide.png" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-black/90 to-transparent p-8 pt-28">
            <div className="min-w-0"><p className="text-[10px] font-bold tracking-[0.14em] text-zinc-400">{feature ? "오늘의 대표 상품" : "새 상품 준비 중"}</p><p className="mt-2 truncate text-sm font-bold">{feature?.title ?? "새로운 상품을 준비 중입니다"}</p></div>
            <span className="grid size-12 shrink-0 place-items-center rounded-full border border-white"><ArrowDownRight size={18} /></span>
          </div>
        </Link>
      </section>

      <section className="grid grid-cols-3 gap-8 border-y border-line py-5">
        <div className="flex items-center gap-3"><Clock3 size={16} /><div><p className="text-[10px] font-bold tracking-[0.14em] text-muted">즉시 구매</p><p className="mt-1 text-sm font-bold">상시 바로 구매</p></div></div>
        <div><p className="text-[10px] font-bold tracking-[0.14em] text-muted">보관·묶음 배송</p><p className="mt-1 text-sm font-bold">소형 14일 · 대형 7일</p></div>
        <div><p className="text-[10px] font-bold tracking-[0.14em] text-muted">엄선된 숍</p><p className="mt-1 text-sm font-bold">{stores.length}개의 숍, 하나의 아카이브</p></div>
      </section>

      {LIVE_AUCTION_ENABLED && <ProductRail compact eyebrow="실시간 경매" title="오늘 밤의 경매" products={auctions} />}

      <section>
        <SectionHeading action={<Link className="shrink-0 text-xs font-bold underline" href="/shop">전체 숍 보기</Link>} className="mb-6 gap-4" eyebrow="엄선된 숍" title="각자의 시선, 하나의 아카이브" titleClassName="mt-2 text-2xl font-black tracking-[-0.06em]" />
        <div className="grid grid-cols-3 gap-3">
          {stores.map((store, index) => <Link className="min-h-52 p-6 transition-transform hover:-translate-y-1" href={`/stores/${store.slug}`} key={store.id} style={{ backgroundColor: `var(--store-card-${(index % 3) + 1})` }}><p className="text-[10px] font-bold tracking-[0.14em]">엄선된 숍 {String(index + 1).padStart(2, "0")}</p><h3 className="mt-14 text-2xl font-black tracking-[-.06em]">{store.name}</h3><p className="mt-2 max-w-[18rem] text-xs leading-5">{store.description}</p></Link>)}
          {stores.length === 0 && <div className="col-span-full border border-dashed border-line py-12 text-center text-sm text-muted">공개된 숍이 없습니다.</div>}
        </div>
      </section>

      <ProductRail compact eyebrow="즉시 구매" title="바로 구매 가능한 상품" products={fixed} href="/shop" />

      <section className="grid grid-cols-2 gap-10 border-t border-ink pt-12">
        <div><p className="text-[10px] font-bold tracking-[0.14em] text-muted">나인티 나인 안내</p><h2 className="mt-4 max-w-2xl text-4xl font-black leading-none tracking-[-.08em]">좋은 빈티지는<br />보관하는 시간까지 포함합니다.</h2></div>
        <p className="self-end text-sm leading-6 text-muted">결제한 상품은 바로 보내지 않아도 됩니다. 다른 날의 낙찰품과 함께 배송을 요청하고, 하나의 박스로 시간을 묶어보세요.</p>
      </section>
    </div>
  );
}

export default async function HomePage() {
  const { auctions, fixed, stores, catalogUnavailable, storesUnavailable } = await loadHomeData();
  const feature = fixed[0] ?? auctions[0] ?? null;

  return (
    <div>
      {(catalogUnavailable || storesUnavailable) && <StatusNotice className="mb-6 px-5 py-4 leading-5" variant="warning">{catalogUnavailable ? "상품 정보를 일시적으로 불러오지 못했습니다. 잠시 후 새로고침해 주세요." : "숍 정보를 일시적으로 불러오지 못했습니다. 즉시 구매 상품은 계속 확인할 수 있습니다."}</StatusNotice>}
      <DesktopHome auctions={auctions} feature={feature} fixed={fixed} stores={stores} />
    </div>
  );
}
