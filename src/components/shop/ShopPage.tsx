"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import CommerceScheduleBanner from "@/src/components/commerce/CommerceScheduleBanner";
import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import PhotoGallery from "@/src/components/feed/PhotoGallery";
import { useAuctionPolicyMinuteClock } from "@/src/hooks/useAuctionPolicyClock";
import type { AuctionPost } from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";
import { getProductFeedDetails } from "@/src/utils/productFeedDetails";
import { toCommerceProductView } from "@/src/features/commerce/productViewModel";
import {
  getCatalogBrand,
  getCatalogSizeTokens,
  matchesCatalogCategory,
  matchesCatalogGender,
  type CatalogCategory,
  type CatalogGender,
} from "@/src/utils/catalogFilters";
import FixedProductDetailModal from "./FixedProductDetailModal";

type ShopSort = "latest" | "price-asc" | "price-desc";
const SHOP_PAGE_SIZE = 20;
const SHOP_CATEGORIES: readonly CatalogCategory[] = ["all", "아우터", "셔츠", "티셔츠", "니트", "팬츠", "데님", "스커트", "원피스", "기타"];
const SHOP_GENDERS: readonly CatalogGender[] = ["all", "남성", "여성", "공용"];

export interface ShopPageProps {
  posts: readonly AuctionPost[];
  isLoading: boolean;
  error: string;
  onRetry: () => void | Promise<void>;
  onBuyNow: (post: AuctionPost) => void | Promise<void>;
  hasMoreProducts?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void | Promise<void>;
}

function fixedPriceOf(post: AuctionPost): number | null {
  return Number.isSafeInteger(post.fixedPrice) && Number(post.fixedPrice) > 0
    ? Number(post.fixedPrice)
    : null;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
}

function ShopSkeleton() {
  return (
    <article aria-hidden="true" className="overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)]">
      <div className="commerce-skeleton aspect-[4/3] rounded-none" />
      <div className="space-y-3 p-3 sm:p-4">
        <div className="commerce-skeleton h-3 w-20 rounded-sm" />
        <div className="commerce-skeleton h-5 w-4/5 rounded-sm" />
        <div className="commerce-skeleton h-5 w-2/5 rounded-sm" />
        <div className="commerce-skeleton h-12 rounded-lg" />
      </div>
    </article>
  );
}

function FixedProductCard({
  post,
  isBuying,
  onBuyNow,
  onOpenDetails,
}: {
  post: AuctionPost;
  isBuying: boolean;
  onBuyNow: (post: AuctionPost) => void | Promise<void>;
  onOpenDetails: (post: AuctionPost) => void;
}) {
  const fixedPrice = fixedPriceOf(post);
  const productView = toCommerceProductView(post);
  const productLabel = productView.name;

  return (
    <article
      data-shop-product-id={post.id}
      className="render-lazy group/card flex min-w-0 flex-col overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-hover)]"
    >
      <div className="relative overflow-hidden">
        <PhotoGallery
          images={post.imageUrls}
          thumbnailImages={post.thumbnailUrls}
          title={productLabel}
          lotLabel={`SHOP ${post.id.slice(0, 6).toUpperCase()}`}
          compact
        />
        <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-black/75 px-2 py-1 text-[9px] font-black tracking-[0.1em] text-white shadow-sm backdrop-blur-md sm:left-3 sm:top-3 sm:text-[10px]">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
          BUY NOW · 상시 구매
        </span>
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)] sm:text-[10px]">
          Fixed price vintage
        </p>
        <h2 className="mt-1.5 min-h-10">
          <button
            type="button"
            onClick={() => onOpenDetails(post)}
            className="line-clamp-2 w-full text-left text-sm font-black leading-5 tracking-[-0.025em] text-[var(--text-strong)] underline-offset-4 transition-colors hover:text-[var(--accent-text)] hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:text-base sm:leading-6"
          >
            {productLabel}
          </button>
        </h2>
        <button type="button" onClick={() => onOpenDetails(post)} className="mt-2 w-fit text-[10px] font-black tracking-[0.12em] text-[var(--accent-text)] underline-offset-4 transition-colors hover:text-[var(--text-strong)] hover:underline">상세 보기 →</button>

        {productView.size !== "표기 없음" ? (
          <p className="mt-1.5 line-clamp-1 text-[11px] font-bold text-[var(--text-muted)] sm:text-xs">
            SIZE · {productView.size}
          </p>
        ) : null}

        <div className="mt-4 border-y border-[var(--border)] py-3">
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)]">
            정가
          </p>
          <p className="mt-1 font-mono text-lg font-black tabular-nums tracking-tight text-[var(--accent-text)] sm:text-xl">
            {fixedPrice ? formatKRW(fixedPrice) : "가격 확인 중"}
          </p>
        </div>

        <button
          type="button"
          disabled={!fixedPrice || isBuying}
          onClick={() => void onBuyNow(post)}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[var(--text-strong)] px-3 text-xs font-black text-[var(--surface)] shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100 sm:text-sm"
        >
          {isBuying ? (
            <>
              <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
              구매 절차 확인 중…
            </>
          ) : (
            <>BUY NOW · 결제하기</>
          )}
        </button>
        <p className="mt-2 break-keep text-center text-[10px] font-medium leading-4 text-[var(--text-muted)]">
          구매 확정 후 결제 대기 상품은 내 정보에서 확인합니다.
        </p>
      </div>
    </article>
  );
}

export default function ShopPage({
  posts,
  isLoading,
  error,
  onRetry,
  onBuyNow,
}: ShopPageProps) {
  const now = useAuctionPolicyMinuteClock();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ShopSort>("latest");
  const [selectedBrand, setSelectedBrand] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState<CatalogCategory>("all");
  const [selectedGender, setSelectedGender] = useState<CatalogGender>("all");
  const [selectedSize, setSelectedSize] = useState("all");
  const [page, setPage] = useState(1);
  const [buyingProductId, setBuyingProductId] = useState<string | null>(null);
  const [pendingPurchase, setPendingPurchase] = useState<AuctionPost | null>(
    null,
  );
  const [detailProduct, setDetailProduct] = useState<AuctionPost | null>(null);
  const [actionError, setActionError] = useState("");

  const fixedProducts = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);
    const visible = posts.filter((post) => {
      const publishAt = Date.parse(post.publish_at ?? post.createdAt);
      if (
        post.saleType !== "fixed" ||
        post.status !== "active" ||
        !Number.isFinite(publishAt) ||
        publishAt > now.getTime()
      ) {
        return false;
      }
      const details = getProductFeedDetails(post);
      const matchesQuery = !normalizedQuery || normalizeSearch(
        [post.title, post.description, post.category, details.name, details.size ?? ""].join("\n"),
      ).includes(normalizedQuery);
      return matchesQuery &&
        (selectedBrand === "all" || getCatalogBrand(post) === selectedBrand) &&
        matchesCatalogCategory(post, selectedCategory) &&
        matchesCatalogGender(post, selectedGender) &&
        (selectedSize === "all" || getCatalogSizeTokens(post).has(selectedSize));
    });

    return visible
      .map((post, originalIndex) => ({ post, originalIndex }))
      .sort((left, right) => {
        let difference = 0;
        if (sort === "latest") {
          difference =
            Date.parse(right.post.publish_at ?? right.post.createdAt) -
            Date.parse(left.post.publish_at ?? left.post.createdAt);
        } else {
          const leftPrice = fixedPriceOf(left.post);
          const rightPrice = fixedPriceOf(right.post);
          if (leftPrice === null || rightPrice === null) {
            if (leftPrice === rightPrice) {
              return left.originalIndex - right.originalIndex;
            }
            return leftPrice === null ? 1 : -1;
          }
          difference =
            sort === "price-asc" ? leftPrice - rightPrice : rightPrice - leftPrice;
        }
        return difference || left.originalIndex - right.originalIndex;
      })
      .map(({ post }) => post);
  }, [now, posts, query, selectedBrand, selectedCategory, selectedGender, selectedSize, sort]);

  const brandOptions = useMemo(
    () => ["all", ...Array.from(new Set(posts.filter((post) => post.saleType === "fixed").map((post) => getCatalogBrand(post)))).sort((a, b) => a.localeCompare(b, "ko-KR"))],
    [posts],
  );
  const pageCount = Math.max(1, Math.ceil(fixedProducts.length / SHOP_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleProducts = fixedProducts.slice((safePage - 1) * SHOP_PAGE_SIZE, safePage * SHOP_PAGE_SIZE);

  const handleBuyNow = async (post: AuctionPost) => {
    if (buyingProductId) return;
    setBuyingProductId(post.id);
    setActionError("");
    try {
      await onBuyNow(post);
    } catch (buyError) {
      setActionError(
        buyError instanceof Error
          ? buyError.message
          : "구매 절차를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setBuyingProductId(null);
      setPendingPurchase(null);
    }
  };

  const resetShopFilters = () => {
    setQuery("");
    setSort("latest");
    setSelectedBrand("all");
    setSelectedCategory("all");
    setSelectedGender("all");
    setSelectedSize("all");
    setPage(1);
  };

  return (
    <main className="mx-auto w-full max-w-[1920px] px-8 pb-20 pt-8">
      <header className="grid min-h-[300px] grid-cols-[minmax(0,1fr)_360px] border-b-2 border-[var(--text-strong)]">
        <div className="flex flex-col justify-between border-r border-[var(--border)] py-10 pr-12">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--accent-text)]">NINETY-NINE · BUY NOW</p>
            <h1 className="mt-5 text-[3.8rem] font-black leading-[0.98] tracking-[-0.07em] text-[var(--text-strong)]">기다림 없이<br />만나는 빈티지.</h1>
            <p className="mt-5 max-w-2xl break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">검수된 빈티지 의류를 표시된 정가로 바로 구매하세요. 구매 확정 후 서버가 재고를 다시 확인하고 결제 대기 상품으로 안전하게 연결합니다.</p>
          </div>
          <div className="mt-8 flex items-center gap-6 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]"><span>READY TO SHIP</span><span>·</span><span>ONE-OF-ONE VINTAGE</span></div>
        </div>
        <div className="flex flex-col justify-between bg-[var(--surface-muted)] p-8">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-4"><span className="text-[10px] font-black tracking-[0.18em]">SHOP INDEX</span><span className="font-mono text-xs font-black tabular-nums">01</span></div>
          <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">AVAILABLE NOW</p><p className="mt-3 font-mono text-5xl font-black tabular-nums tracking-[-0.07em]">{fixedProducts.length.toLocaleString("ko-KR")}</p><p className="mt-3 text-sm font-medium leading-6 text-[var(--text-muted)]">선착순 한정 상품<br />재고 소진 시 자동 종료</p></div>
          <Link href="/feed" className="text-xs font-black underline underline-offset-4 transition-colors hover:text-[var(--accent-text)]">라이브 경매도 둘러보기 →</Link>
        </div>
      </header>

      <CommerceScheduleBanner className="mt-4" compact />

      <section className="mt-10" aria-labelledby="fixed-price-products-title">
        <div className="mb-5 grid gap-4 border-b border-[var(--border)] pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="block min-w-0">
            <span id="fixed-price-products-title" className="text-xs font-black text-[var(--text-strong)]">
              상시 구매 상품 검색
            </span>
            <span className="mt-2 flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 focus-within:border-[var(--accent)]">
              <span aria-hidden="true" className="text-[var(--text-muted)]">⌕</span>
              <input
                type="search"
                value={query}
                maxLength={80}
                onChange={(event) => { setQuery(event.target.value.slice(0, 80)); setPage(1); }}
                placeholder="상품명·설명·사이즈 검색"
                className="min-w-0 flex-1 bg-transparent text-sm font-bold text-[var(--text-strong)] outline-none placeholder:text-[var(--text-muted)]"
              />
            </span>
          </label>

          <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="group" aria-label="상시 구매 상품 정렬">
            {(
              [
                ["latest", "최신순"],
                ["price-asc", "낮은 가격순"],
                ["price-desc", "높은 가격순"],
              ] as const satisfies readonly (readonly [ShopSort, string])[]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={sort === value}
                onClick={() => { setSort(value); setPage(1); }}
                className={`min-h-10 shrink-0 rounded-md border px-3 text-xs font-black transition-all duration-200 active:scale-[0.98] ${
                  sort === value
                    ? "border-[var(--text-strong)] bg-[var(--text-strong)] text-[var(--surface)]"
                    : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:border-[var(--text-strong)] hover:text-[var(--text-strong)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6 grid grid-cols-5 gap-3 border-b border-[var(--border)] pb-6" aria-label="상시 구매 필터">
          <label className="grid gap-1.5"><span className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">Brand</span><select value={selectedBrand} onChange={(event) => { setSelectedBrand(event.target.value); setPage(1); }} className="min-h-10 border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-xs font-bold outline-none focus:border-[var(--text-strong)]"><option value="all">모든 브랜드</option>{brandOptions.filter((brand) => brand !== "all").map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select></label>
          <label className="grid gap-1.5"><span className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">Category</span><select value={selectedCategory} onChange={(event) => { setSelectedCategory(event.target.value as CatalogCategory); setPage(1); }} className="min-h-10 border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-xs font-bold outline-none focus:border-[var(--text-strong)]">{SHOP_CATEGORIES.map((category) => <option key={category} value={category}>{category === "all" ? "모든 카테고리" : category}</option>)}</select></label>
          <label className="grid gap-1.5"><span className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">Gender</span><select value={selectedGender} onChange={(event) => { setSelectedGender(event.target.value as CatalogGender); setPage(1); }} className="min-h-10 border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-xs font-bold outline-none focus:border-[var(--text-strong)]">{SHOP_GENDERS.map((gender) => <option key={gender} value={gender}>{gender === "all" ? "모든 성별" : gender}</option>)}</select></label>
          <label className="grid gap-1.5"><span className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">Size</span><select value={selectedSize} onChange={(event) => { setSelectedSize(event.target.value); setPage(1); }} className="min-h-10 border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-xs font-bold outline-none focus:border-[var(--text-strong)]"><option value="all">모든 사이즈</option>{["S", "M", "L", "XL"].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          <button type="button" onClick={resetShopFilters} className="mt-auto min-h-10 border border-[var(--border-strong)] px-3 text-xs font-black text-[var(--text-muted)] transition-colors hover:border-[var(--text-strong)] hover:text-[var(--text-strong)]">필터 초기화</button>
        </div>

        {actionError ? (
          <p role="alert" className="mb-4 border-l-2 border-[var(--danger-text)] bg-[var(--danger-surface)] px-4 py-3 text-sm font-bold text-[var(--danger-text)]">
            {actionError}
          </p>
        ) : null}

        {isLoading && fixedProducts.length === 0 ? (
          <div role="status">
            <span className="sr-only">상시 구매 상품을 불러오는 중…</span>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 8 }, (_, index) => <ShopSkeleton key={index} />)}
            </div>
          </div>
        ) : error && fixedProducts.length === 0 ? (
          <div className="border border-[var(--danger-text)]/30 bg-[var(--danger-surface)] px-5 py-12 text-center">
            <p className="text-sm font-bold text-[var(--danger-text)]">{error}</p>
            <button type="button" onClick={() => void onRetry()} className="mt-4 min-h-11 rounded-lg border border-[var(--danger-text)]/40 px-4 text-sm font-black text-[var(--danger-text)]">
              다시 불러오기
            </button>
          </div>
        ) : fixedProducts.length > 0 ? (
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visibleProducts.map((post) => (
              <FixedProductCard
                key={post.id}
                post={post}
                isBuying={buyingProductId === post.id}
                onBuyNow={(item) => setPendingPurchase(item)}
                onOpenDetails={setDetailProduct}
              />
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-5 py-16 text-center">
            <span aria-hidden="true" className="mx-auto grid size-11 place-items-center rounded-full border border-[var(--border)] text-[var(--text-muted)]">99</span>
            <h2 className="mt-4 text-lg font-black text-[var(--text-strong)]">조건에 맞는 상시 구매 상품이 없습니다</h2>
            <p className="mt-1.5 text-sm font-medium text-[var(--text-muted)]">검색어를 바꾸거나 다음 상품 공개를 기다려 주세요.</p>
          </div>
        )}

        {fixedProducts.length > SHOP_PAGE_SIZE ? (
          <nav className="mt-10 flex items-center justify-center gap-1.5 border-t border-[var(--border)] pt-6" aria-label="상시 구매 상품 페이지 이동">
            <button
              type="button"
              aria-label="이전 페이지"
              disabled={safePage === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="min-h-10 rounded-md border border-[var(--border)] px-3 text-xs font-black text-[var(--text-muted)] transition-all duration-200 hover:border-[var(--text-strong)] hover:text-[var(--text-strong)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              ←
            </button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                aria-current={safePage === pageNumber ? "page" : undefined}
                onClick={() => setPage(pageNumber)}
                className={`min-h-10 min-w-10 rounded-md border px-3 text-xs font-mono font-black tabular-nums transition-all duration-200 active:scale-[0.98] ${
                  safePage === pageNumber
                    ? "border-[var(--text-strong)] bg-[var(--text-strong)] text-[var(--surface)]"
                    : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:border-[var(--text-strong)] hover:text-[var(--text-strong)]"
                }`}
              >
                {String(pageNumber).padStart(2, "0")}
              </button>
            ))}
            <button
              type="button"
              aria-label="다음 페이지"
              disabled={safePage === pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              className="min-h-10 rounded-md border border-[var(--border)] px-3 text-xs font-black text-[var(--text-muted)] transition-all duration-200 hover:border-[var(--text-strong)] hover:text-[var(--text-strong)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              →
            </button>
          </nav>
        ) : null}
      </section>

      <FixedProductDetailModal
        open={Boolean(detailProduct)}
        post={detailProduct}
        onClose={() => setDetailProduct(null)}
        onPurchase={setPendingPurchase}
      />

      <Modal
        open={Boolean(pendingPurchase)}
        onClose={() => {
          if (!buyingProductId) setPendingPurchase(null);
        }}
        title="상시 구매 확정"
        description="구매를 확정하면 이 상품은 다른 회원이 구매할 수 없으며 내 정보의 결제 대기 목록으로 이동합니다."
        size="sm"
        closeOnBackdrop={!buyingProductId}
      >
        {pendingPurchase ? (
          <div className="p-5 sm:p-6">
            <p className="line-clamp-2 text-lg font-black tracking-[-0.03em] text-[var(--text-strong)]">
              {toCommerceProductView(pendingPurchase).name}
            </p>
            <div className="mt-4 border-y border-[var(--border)] py-4">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
                최종 구매 금액
              </p>
              <p className="mt-1 font-mono text-2xl font-black tabular-nums tracking-tight text-[var(--accent-text)]">
                {formatKRW(fixedPriceOf(pendingPurchase) ?? 0)}
              </p>
            </div>
            <p className="mt-4 break-keep text-xs font-medium leading-5 text-[var(--text-muted)]">
              결제 방식은 기존 낙찰 상품과 동일하며, 계좌이체 또는 현재 활성화된 결제 모드로 진행합니다.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="lg"
                disabled={Boolean(buyingProductId)}
                onClick={() => setPendingPurchase(null)}
              >
                다시 확인
              </Button>
              <Button
                size="lg"
                isLoading={buyingProductId === pendingPurchase.id}
                onClick={() => void handleBuyNow(pendingPurchase)}
              >
                구매 확정하기
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </main>
  );
}
