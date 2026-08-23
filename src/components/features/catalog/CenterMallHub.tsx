"use client";

import { Heart, Search, ShieldCheck, Store, UsersRound } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import {
  CategoryTabBar,
  type CategoryTabItem,
} from "@/components/common/CategoryTabBar";
import { CatalogImage } from "@/components/ui/CatalogImage";
import type { StoreMallCard } from "@/services/stores";

const filters = [
  "전체",
  "실시간 경매 진행중",
  "아메카지/워크웨어",
  "하이엔드/디자이너",
  "올드스쿨/스포츠",
  "밀리터리/유러피안",
] as const;

type CenterMallFilter = (typeof filters)[number];

const filterItems: readonly CategoryTabItem<CenterMallFilter>[] = filters.map(
  (value) => ({
    label: value === "실시간 경매 진행중" ? `🔥 ${value}` : value,
    value,
  }),
);

export function CenterMallHub({
  cards,
  routeBase = "/centers",
}: {
  cards: StoreMallCard[];
  routeBase?: "/centers" | "/stores" | "/m/centers" | "/m/stores";
}) {
  const isMobileRoute = routeBase.startsWith("/m/");
  const storeGridClass = isMobileRoute
    ? "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 lg:gap-5"
    : "grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(
    query.trim().toLocaleLowerCase("ko-KR"),
  );
  const [filter, setFilter] = useState<CenterMallFilter>("전체");
  const [sort, setSort] = useState("popular");
  const visible = useMemo(
    () =>
      cards
        .filter((card) => {
          const text =
            `${card.name} ${card.description} ${card.mallInfo ?? ""}`.toLocaleLowerCase(
              "ko-KR",
            );
          if (deferredQuery && !text.includes(deferredQuery)) return false;
          if (filter === "실시간 경매 진행중") return card.liveAuctionCount > 0;
          if (filter !== "전체") return text.includes(filter.split("/")[0]);
          return true;
        })
        .toSorted((a, b) =>
          sort === "latest"
            ? b.recentCount - a.recentCount
            : sort === "products"
              ? b.totalCount - a.totalCount
              : b.liveAuctionCount - a.liveAuctionCount ||
                b.totalCount - a.totalCount,
        ),
    [cards, deferredQuery, filter, sort],
  );
  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 focus-within:border-amber-500">
            <Search size={18} />
            <input
              aria-label="센터명, 무드, 콘셉트 검색"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="센터명·무드·콘셉트 검색"
              value={query}
            />
          </label>
          <select
            aria-label="센터 정렬"
            className="min-h-12 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 text-xs font-bold"
            onChange={(event) => setSort(event.target.value)}
            value={sort}
          >
            <option value="popular">인기순</option>
            <option value="latest">최신순</option>
            <option value="products">등록 상품 많은 순</option>
            <option value="rating">평점 높은 순</option>
          </select>
        </div>
        <CategoryTabBar
          ariaLabel="센터몰 카테고리"
          className="mt-4"
          items={filterItems}
          onValueChange={setFilter}
          value={filter}
        />
      </section>
      {visible.length ? (
        <section
          aria-label="판매 센터 목록"
          className={storeGridClass}
        >
          {visible.map((card) => (
            <CenterCard card={card} key={card.id} routeBase={routeBase} />
          ))}
        </section>
      ) : (
        <div className="rounded-3xl border border-dashed border-zinc-700 py-20 text-center text-sm text-muted">
          조건에 맞는 센터가 없습니다.
        </div>
      )}
    </div>
  );
}

function CenterCard({
  card,
  routeBase,
}: {
  card: StoreMallCard;
  routeBase: string;
}) {
  const [followed, setFollowed] = useState(false);
  const href = `${routeBase}/${encodeURIComponent(card.slug)}`;
  return (
    <article className="group relative flex h-full cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900 text-zinc-100 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-500/50 hover:shadow-xl hover:shadow-black/20">
      <Link
        aria-label={`${card.name} 센터 방문하기`}
        className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-inset"
        href={href}
        prefetch={false}
      />
      <div className="relative aspect-[16/10] bg-zinc-800">
        {card.mallImage ? (
          <CatalogImage
            alt={`${card.name} 센터 커버`}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw"
            src={card.mallImage}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-black/20" />
        <span
          className={`absolute right-3 top-3 max-w-[calc(100%-1.5rem)] truncate rounded-full border px-2.5 py-1.5 text-[9px] font-black ${card.liveAuctionCount ? "border-rose-500/40 bg-rose-500/15 text-rose-300" : "border-zinc-600 bg-zinc-950/70 text-zinc-400"}`}
          title={card.liveAuctionCount ? "LIVE 경매 진행중" : "경매 준비중"}
        >
          <span
            className={`mr-1.5 inline-block size-2 rounded-full ${card.liveAuctionCount ? "animate-pulse bg-rose-500" : "bg-zinc-500"}`}
          />
          {card.liveAuctionCount ? "LIVE 경매 진행중" : "경매 준비중"}
        </span>
        <span className="absolute -bottom-5 left-4 grid size-11 place-items-center rounded-full border-[3px] border-zinc-900 bg-amber-500 text-base font-black text-zinc-950">
          {card.name.slice(0, 1)}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5 pt-8">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex min-h-8 min-w-0 items-start gap-1.5 text-xs font-black leading-4 sm:text-sm">
              <span className="line-clamp-2 min-w-0" title={card.name}>
                {card.name}
              </span>
              <ShieldCheck className="shrink-0 text-sky-400" size={15} />
            </h2>
            <p className="mt-2 line-clamp-2 min-h-10 text-[10px] leading-5 text-zinc-400 sm:text-[11px]">
              {card.mallInfo ?? card.description}
            </p>
          </div>
          <button
            aria-pressed={followed}
            aria-label={`${card.name} 단골 ${followed ? "해제" : "등록"}`}
            className={`relative z-20 grid size-11 shrink-0 place-items-center rounded-full border transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-amber-400 ${followed ? "border-rose-500 text-rose-400" : "border-zinc-700"}`}
            onClick={() => setFollowed((value) => !value)}
            type="button"
          >
            <Heart fill={followed ? "currentColor" : "none"} size={17} />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-1 font-mono text-[9px] text-zinc-400">
          <span>
            <Store className="mb-1" size={13} />
            상품 {card.totalCount}
          </span>
          <span>
            <UsersRound className="mb-1" size={13} />
            신규 {card.recentCount}
          </span>
          <span>
            ★ —<br />
            후기 준비중
          </span>
        </div>
        <div className="mt-4 flex gap-1.5">
          {card.previewImages.map((src, index) => (
            <CatalogImage
              alt={`${card.name} 상품 미리보기 ${index + 1}`}
              className="aspect-square w-11 rounded-lg object-cover"
              key={`${src}-${index}`}
              sizes="44px"
              src={src}
            />
          ))}
        </div>
        <span className="mt-auto flex min-h-11 items-center justify-center rounded-xl bg-zinc-100 text-xs font-black text-zinc-950 transition-colors duration-300 group-hover:bg-amber-400">
          센터 방문하기
        </span>
      </div>
    </article>
  );
}
