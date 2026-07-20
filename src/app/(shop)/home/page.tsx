import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Clock3 } from "lucide-react";
import { ProductRail } from "@/components/features/catalog/ProductRail";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { fetchPublishedProducts } from "@/services/products";
import { fetchActiveStores } from "@/services/stores";
import { ReadOnlyHomeNotice } from "@/components/layout/ReadOnlyHomeNotice";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

export const dynamic = "force-dynamic";

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

export default async function HomePage() {
  const {
    auctions,
    fixed,
    stores,
    catalogUnavailable,
    storesUnavailable,
  } = await loadHomeData();
  const feature = fixed[0] ?? auctions[0] ?? null;

  return (
    <div className="space-y-12">
      <ReadOnlyHomeNotice />
      {(catalogUnavailable || storesUnavailable) && <StatusNotice className="px-5 py-4 leading-5" variant="warning">{catalogUnavailable ? "상품 정보를 일시적으로 불러오지 못했습니다. 잠시 후 새로고침해 주세요." : "숍 정보를 일시적으로 불러오지 못했습니다. 바로 구매 상품은 계속 확인할 수 있습니다."}</StatusNotice>}
      <section className="grid min-h-[560px] overflow-hidden bg-ink text-paper grid-cols-[1.2fr_.8fr]">
        <div className="flex flex-col justify-between p-6   p-16">
          <div>
            <p className="eyebrow text-zinc-400">NINETY-NINE VINTAGE / BUY NOW</p>
            <h1 className="mt-16 max-w-3xl text-[clamp(3.5rem,16vw,7.4rem)] font-black leading-[.95] tracking-[-.1em]">시간을<br />다시 입는<br /><span className="text-zinc-500">선택.</span></h1>
          </div>
          <div className="mt-16 flex max-w-lg flex-col items-start justify-between gap-5   ">
            <p className="text-sm leading-6 text-zinc-400">선별된 빈티지 한 점을<br />기다림 없이 바로 만나보세요.</p>
            <Link className="flex items-center gap-2 border-b border-paper pb-2 text-xs font-bold" href="/shop">BUY NOW <ArrowUpRight size={14} /></Link>
          </div>
        </div>
        <div className="relative min-h-[360px] bg-[#c7b9a5] min-h-0">
          {feature?.imageUrls[0] ? <CatalogImage alt={feature.title} className="h-full w-full object-cover mix-blend-multiply" decoding="async" fetchPriority="high" loading="eager" sizes="(max-width: 1023px) 100vw, 40vw" src={feature.imageUrls[0]} /> : <div className="grid h-full place-items-center text-ink/60"><span className="eyebrow">NEW DROP SOON</span></div>}
          <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4 text-ink">
            <div className="min-w-0"><p className="eyebrow">{feature ? "BUY NOW / CATALOG" : "CATALOG / PREPARING"}</p><p className="mt-2 truncate text-sm font-bold">{feature?.title ?? "새로운 상품을 준비 중입니다"}</p></div>
            <span className="grid size-12 shrink-0 place-items-center rounded-full border border-ink"><ArrowDownRight size={18} /></span>
          </div>
        </div>
      </section>

      <section className="grid gap-5 border-y border-line py-5 ">
        <div className="flex items-center gap-3"><Clock3 size={16} /><div><p className="eyebrow text-muted">BUY NOW</p><p className="mt-1 text-sm font-bold">상시 바로 구매</p></div></div>
        <div><p className="eyebrow text-muted">STORAGE / MERGE SHIPPING</p><p className="mt-1 text-sm font-bold">소형 14일 · 대형 7일</p></div>
        <div><p className="eyebrow text-muted">CURATED STORES</p><p className="mt-1 text-sm font-bold">{stores.length}개의 숍, 하나의 아카이브</p></div>
      </section>

      {LIVE_AUCTION_ENABLED && <ProductRail compact eyebrow="LIVE AUCTION / DB CATALOG" title="오늘 밤의 경매" products={auctions} />}

      <section className="mt-20">
        <SectionHeading action={<Link className="shrink-0 text-xs font-bold underline" href="/shop">SHOP ALL</Link>} className="mb-6 gap-4" eyebrow="STORES / EDITORIAL SELECTION" title="각자의 시선, 하나의 아카이브" titleClassName="mt-2 text-2xl font-black tracking-[-0.06em]" />
        <div className="grid gap-3 ">
          {stores.map((store, index) => <Link className="min-h-52 p-6 transition-transform hover:-translate-y-1" href={`/stores/${store.slug}`} key={store.id} style={{ backgroundColor: ["#c7b9a5", "#9fa9a2", "#b8a7a1"][index % 3] }}><p className="eyebrow">{`CURATED STORE / ${String(index + 1).padStart(2, "0")}`}</p><h3 className="mt-14 text-2xl font-black tracking-[-.06em]">{store.name}</h3><p className="mt-2 max-w-[18rem] text-xs leading-5">{store.description}</p></Link>)}
          {stores.length === 0 && <div className="col-span-full border border-dashed border-line py-12 text-center text-sm text-muted">공개된 숍이 없습니다.</div>}
        </div>
      </section>

      <ProductRail compact eyebrow="SHOP / BUY NOW" title="바로 구매 가능한 것들" products={fixed} href="/shop" />

      <section className="grid gap-4 border-t border-ink pt-12 ">
        <div className=""><p className="eyebrow text-muted">THE NINETY-NINE NOTE</p><h2 className="mt-4 max-w-2xl text-4xl font-black leading-none tracking-[-.08em]">좋은 빈티지는<br />보관하는 시간까지 포함합니다.</h2></div>
        <p className="self-end text-sm leading-6 text-muted">결제한 상품은 바로 보내지 않아도 됩니다. 다른 날의 낙찰품과 함께 배송을 요청하고, 하나의 박스로 시간을 묶어보세요.</p>
      </section>
    </div>
  );
}
