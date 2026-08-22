"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Gavel, Heart, Search, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { persistWishlist, reserveCartProduct } from "@/lib/commerce/client";
import { useCommerceStore } from "@/store/useCommerceStore";
import { useToastStore } from "@/store/useToastStore";
import {
  useWishlistStore,
  type WishlistFilter,
} from "@/store/useWishlistStore";

interface WishProduct {
  id: string;
  title: string;
  brand: string;
  conditionGrade?: string;
  currentPrice: number;
  fixedPrice: number | null;
  saleType: "auction" | "fixed";
  status: "pending" | "active" | "closed";
  imageUrls: string[];
  thumbnailUrls: string[];
  storeName?: string;
}
const FILTERS: [[WishlistFilter, string], ...[WishlistFilter, string][]] = [
  ["all", "전체"],
  ["available", "소장 가능"],
  ["sold", "판매 완료"],
  ["center", "센터별 모아보기"],
];
export function WishlistFeed({ basePath = "" }: { basePath?: "" | "/m" }) {
  const likedIds = useCommerceStore((s) => s.likedIds);
  const toggleLike = useCommerceStore((s) => s.toggleLike);
  const addToCart = useCommerceStore((s) => s.addToCart);
  const hydrate = useCommerceStore((s) => s.hydrate);
  const { filter, auctionAlerts, setFilter, setAuctionAlerts } =
    useWishlistStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const [products, setProducts] = useState<WishProduct[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(
      likedIds.map(async (id) => {
        const response = await fetch(
          `/api/products/${encodeURIComponent(id)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) return null;
        const payload = (await response.json()) as { product?: WishProduct };
        return payload.product ?? null;
      }),
    )
      .then((rows) =>
        setProducts(rows.filter((row): row is WishProduct => Boolean(row))),
      )
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [likedIds]);
  const visible = useMemo(
    () =>
      products
        .filter(
          (product) =>
            filter === "all" ||
            filter === "center" ||
            (filter === "sold"
              ? product.status === "closed"
              : product.status !== "closed"),
        )
        .toSorted((a, b) =>
          filter === "center"
            ? String(a.storeName).localeCompare(String(b.storeName), "ko-KR")
            : 0,
        ),
    [filter, products],
  );
  const remove = async (product: WishProduct) => {
    toggleLike(product.id);
    const session = (await getSupabaseBrowserClient().auth.getSession()).data
      .session;
    if (session) await persistWishlist(product.id, false, session.user.id);
    pushToast("success", "찜 목록에서 삭제했습니다.");
  };
  const move = async (product: WishProduct) => {
    const session = (await getSupabaseBrowserClient().auth.getSession()).data
      .session;
    if (!session) {
      pushToast("error", "로그인 후 장바구니를 이용해 주세요.");
      return;
    }
    await reserveCartProduct(product.id, session.user.id);
    addToCart(product.id);
    pushToast("success", "장바구니에 담았습니다.");
  };
  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100">
        <p className="text-[10px] font-black tracking-[.16em] text-rose-400">
          ARCHIVE WATCHLIST
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-[-.06em]">
              찜 · 아카이브 워치리스트
            </h1>
            <p className="mt-2 text-xs text-zinc-400">
              품절 후에도 기록을 보존하고 다음 한 점을 발견하세요.
            </p>
          </div>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-zinc-700 px-4 text-xs font-bold">
            <Bell size={15} />
            <span>라이브 옥션 등록 알림</span>
            <input
              checked={auctionAlerts}
              onChange={(e) => setAuctionAlerts(e.target.checked)}
              type="checkbox"
            />
          </label>
        </div>
      </header>
      <nav className="flex gap-2 overflow-x-auto">
        {FILTERS.map(([value, label]) => (
          <button
            className={`min-h-11 shrink-0 rounded-full border px-4 text-xs font-black ${filter === value ? "border-rose-500 bg-rose-500 text-white" : "border-line"}`}
            key={value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {label} {value === "all" ? products.length : ""}
          </button>
        ))}
      </nav>
      {loading ? (
        <p className="py-20 text-center text-sm text-muted">
          찜 목록을 불러오는 중입니다.
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line py-20 text-center">
          <Heart className="mx-auto text-muted" />
          <p className="mt-4 text-sm font-bold">
            조건에 맞는 찜 상품이 없습니다.
          </p>
          <Link
            className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-ink px-5 text-xs font-black text-paper"
            href={`${basePath}/shop`}
          >
            아카이브 숍 둘러보기
          </Link>
        </div>
      ) : (
        <motion.div
          layout
          className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 lg:gap-5"
        >
          <AnimatePresence>
            {visible.map((product) => {
              const sold = product.status === "closed";
              const price = product.fixedPrice ?? product.currentPrice;
              return (
                <motion.article
                  layout
                  exit={{ opacity: 0, scale: 0.92 }}
                  key={product.id}
                >
                  <div
                    className={`relative aspect-[3/4] overflow-hidden rounded-2xl border border-line ${sold ? "grayscale" : ""}`}
                  >
                    <CatalogImage
                      alt={product.title}
                      className="size-full object-cover"
                      sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw"
                      src={
                        product.imageUrls[0] ?? product.thumbnailUrls[0] ?? ""
                      }
                    />
                    <span className="absolute left-2 top-2 rounded-lg bg-zinc-950 px-2 py-1 font-mono text-[9px] font-black text-white">
                      GRADE {product.conditionGrade ?? "B"}
                    </span>
                    <button
                      aria-label="찜 삭제"
                      className="absolute right-2 top-2 grid size-10 place-items-center rounded-xl bg-white/90 text-rose-600"
                      onClick={() => void remove(product)}
                      type="button"
                    >
                      <Heart fill="currentColor" size={17} />
                    </button>
                    {product.saleType === "auction" &&
                    product.status === "pending" ? (
                      <span className="absolute inset-x-2 bottom-2 rounded-lg bg-amber-500 px-2 py-2 text-center text-[9px] font-black text-zinc-950">
                        <Gavel className="mr-1 inline" size={12} />
                        오늘 밤 옥션 출품 예정
                      </span>
                    ) : null}
                    {sold ? (
                      <div className="absolute inset-0 grid place-items-center bg-black/55 text-xs font-black text-white">
                        SOLD OUT · 판매 완료
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-3 truncate text-[10px] font-bold text-muted">
                    {product.brand}
                  </p>
                  <h2 className="mt-1 truncate text-sm font-black">
                    {product.title}
                  </h2>
                  <p className="mt-2 font-mono text-sm font-black">
                    {price.toLocaleString("ko-KR")}원
                  </p>
                  {sold ? (
                    <Link
                      className="mt-3 flex min-h-11 items-center justify-center gap-1 rounded-xl border border-line text-[10px] font-black"
                      href={`${basePath}/shop?q=${encodeURIComponent(product.brand)}`}
                    >
                      <Search size={13} />
                      유사한 빈티지 추천
                    </Link>
                  ) : (
                    <div className="mt-3 grid gap-2">
                      <button
                        className="min-h-11 rounded-xl border border-line text-[10px] font-black"
                        onClick={() => void move(product)}
                        type="button"
                      >
                        <ShoppingBag className="mr-1 inline" size={13} />
                        장바구니 담기
                      </button>
                      <Link
                        className="flex min-h-11 items-center justify-center rounded-xl bg-ink text-[10px] font-black text-paper"
                        href={`${basePath}/cart?productId=${product.id}`}
                      >
                        즉시 소장하기
                      </Link>
                    </div>
                  )}
                </motion.article>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}
    </section>
  );
}
