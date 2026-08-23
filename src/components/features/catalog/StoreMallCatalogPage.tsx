import { CalendarDays } from "lucide-react";

import { AuctionCard } from "@/components/features/auction/AuctionCard";
import { StoreMallDateNav } from "@/components/features/catalog/StoreMallDateNav";
import { StoreMallTabs } from "@/components/features/catalog/StoreMallTabs";
import { getCatalogImageUrl } from "@/lib/images";
import type { PublishedProduct } from "@/services/products";
import type { PublicStore } from "@/services/stores";

function toItem(product: PublishedProduct) {
  const status =
    product.status === "pending" || product.status === "closed"
      ? product.status
      : "active";
  const saleType = product.saleType === "fixed" ? "fixed" : "auction";
  return {
    id: product.id,
    auctionId: product.id,
    name: product.title,
    brand: product.brand,
    category: product.category,
    description: product.description,
    gender: product.gender,
    conditionGrade: product.conditionGrade,
    imageUrl: getCatalogImageUrl(
      product.thumbnailUrls[0] ?? product.imageUrls[0] ?? "",
    ),
    thumbnailUrl: getCatalogImageUrl(
      product.thumbnailUrls[0] ?? product.imageUrls[0] ?? "",
    ),
    startingPrice: product.startingPrice,
    currentBid: product.currentPrice,
    fixedPrice:
      saleType === "fixed"
        ? (product.fixedPrice ?? product.currentPrice)
        : null,
    bidCount: product.participantCount,
    status,
    saleType,
    closesAt: product.closesAt,
    publishAt: product.publishAt,
    bidIncrement: product.bidIncrement,
    timeLeft: saleType === "fixed" ? "재고 있음" : "진행 중",
  } as const;
}

const TAB_CONFIG: Record<
  "new" | "auction" | "buy",
  {
    eyebrow: string;
    subPath: "" | "/new" | "/auction" | "/buy";
    title: string;
    description: string;
  }
> = {
  new: {
    eyebrow: "NEW ARRIVALS",
    subPath: "/new",
    title: "신상품",
    description:
      "등록 상품이 없는 날짜는 자동으로 숨깁니다. 선택한 날의 신규 상품만 모아볼 수 있습니다.",
  },
  auction: {
    eyebrow: "LIVE AUCTION",
    subPath: "/auction",
    title: "경매",
    description: "선택한 날 등록된 실시간 경매 상품만 모아볼 수 있습니다.",
  },
  buy: {
    eyebrow: "BUY NOW",
    subPath: "/buy",
    title: "즉시구매",
    description: "선택한 날 등록된 즉시구매 상품만 모아볼 수 있습니다.",
  },
};

export function StoreMallCatalogPage({
  basePath = "",
  dates,
  products,
  selectedDate,
  slug,
  store,
  surface,
  tab,
}: {
  basePath?: "" | "/m";
  dates: string[];
  products: PublishedProduct[];
  selectedDate: string;
  slug: string;
  store: PublicStore;
  surface: "desktop" | "mobile";
  tab: "new" | "auction" | "buy";
}) {
  const isDesktop = surface === "desktop";
  const chatHref = `${basePath}/chat?storeId=${store.id}`;
  const config = TAB_CONFIG[tab];
  return (
    <div className={isDesktop ? "pb-24" : "pb-8"}>
      <StoreMallTabs
        active={tab}
        basePath={basePath}
        chatHref={chatHref}
        slug={slug}
        storeName={store.name}
        surface={surface}
      />
      {store.announcementEnabled && store.announcementText ? <div className="w-full max-w-full overflow-hidden break-keep border-b border-emerald-600 bg-emerald-500 px-4 py-3 text-center text-xs font-black text-zinc-950" role="status">{store.announcementText}</div> : null}
      <div className="mt-10">
        <p className="eyebrow text-muted">{store.name} 센터몰</p>
        <h1
          className={`${isDesktop ? "text-4xl" : "text-3xl"} mt-3 font-black tracking-[-.08em]`}
        >
          {config.title}
        </h1>
      </div>
      <section
        className={`mt-8 border border-line bg-surface ${isDesktop ? "p-8" : "p-5"}`}
      >
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow text-muted">{config.eyebrow}</p>
            <h2
              className={`${isDesktop ? "text-2xl" : "text-xl"} mt-2 font-black tracking-[-.06em]`}
            >
              상품이 있는 날만 골라보기
            </h2>
          </div>
          <CalendarDays className="shrink-0" />
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">
          {config.description}
        </p>
        <StoreMallDateNav
          basePath={basePath}
          dates={dates}
          selectedDate={selectedDate}
          slug={slug}
          subPath={config.subPath}
        />
      </section>
      <section
        className={`${isDesktop ? "mt-10" : "mt-8"} grid grid-cols-2 gap-x-3 gap-y-9 md:grid-cols-3 md:gap-x-4 lg:grid-cols-4 lg:gap-x-5 xl:grid-cols-5`}
        aria-label={`${config.title} 상품 목록`}
      >
        {products.map((product) => (
          <AuctionCard
            basePath={basePath}
            item={toItem(product)}
            key={product.id}
            surface={surface}
          />
        ))}
      </section>
      {products.length === 0 && (
        <div className="mt-8 border border-dashed border-line py-16 text-center text-sm text-muted">
          현재 공개된 상품이 없습니다.
        </div>
      )}
    </div>
  );
}
