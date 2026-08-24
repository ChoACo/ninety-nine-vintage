import { Bell, Gavel, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { PublishedProduct } from "@/services/products";
type ProductPayload = PublishedProduct;
export function LiveAuctionIntro({
  products,
  basePath = "",
}: {
  products: ProductPayload[];
  basePath?: "" | "/m";
}) {
  const active = products.filter((p) => p.status === "active");
  const headliner = [...active].sort(
    (a, b) =>
      b.participantCount - a.participantCount ||
      b.currentPrice - a.currentPrice,
  )[0];
  const upcoming = products.filter((p) => p.status === "pending").slice(0, 6);
  return (
    <>
      <header className="overflow-hidden rounded-3xl border border-zinc-800 bg-[radial-gradient(circle_at_85%_20%,rgba(245,158,11,.18),transparent_35%),linear-gradient(135deg,#18181b,#09090b)] px-6 py-10 text-zinc-100 sm:px-10 sm:py-14">
        <span className="inline-flex items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-[10px] font-black text-rose-400">
          <span className="size-2 animate-pulse rounded-full bg-rose-500" />{" "}
          LIVE AUCTION
        </span>
        <h1 className="mt-5 text-balance text-[clamp(2.35rem,6vw,4.8rem)] font-black leading-[.92] tracking-[-.075em]">
          라이브 옥션
        </h1>
        <p className="mt-5 max-w-2xl text-balance text-sm leading-6 text-zinc-400 sm:text-base">
          매일 밤 10시, 시간을 다시 입는 단 한 점의 아카이브 빈티지 옥션
        </p>
      </header>
      {headliner ? (
        <section className="mt-8 grid overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 text-zinc-100 md:grid-cols-[1.15fr_.85fr]">
          <div className="relative min-h-72 bg-zinc-950">
            <Image
              alt={`${headliner.title} 라이브 옥션 대표 이미지`}
              className="object-cover opacity-80"
              fill
              sizes="(min-width: 768px) 58vw, 100vw"
              src={
                headliner.imageUrls[0] ??
                headliner.thumbnailUrls[0] ??
                "/ninety-nine-vintage-brand.jpg"
              }
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
            <span className="absolute left-5 top-5 rounded-full bg-rose-600 px-3 py-1 text-[10px] font-black text-white dark:text-zinc-950">
              HEADLINER · LIVE
            </span>
          </div>
          <div className="flex flex-col justify-center p-7 sm:p-9">
            <p className="text-xs font-bold text-zinc-500">
              {headliner.storeName ?? "NINETY-NINE VINTAGE"}
            </p>
            <h2 className="mt-3 text-2xl font-black leading-tight tracking-[-.04em]">
              {headliner.title}
            </h2>
            <p className="mt-7 text-xs text-zinc-400">현재 최고 입찰가</p>
            <p className="mt-2 font-mono text-3xl font-black text-amber-400">
              {headliner.currentPrice.toLocaleString("ko-KR")}원
            </p>
            <p className="mt-2 font-mono text-xs text-zinc-400">
              참여 {headliner.participantCount.toLocaleString("ko-KR")}명
            </p>
            <Link
              className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 text-sm font-black text-zinc-950 transition hover:-translate-y-0.5 hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-300 active:scale-[.98]"
              href={`${basePath}/live/${headliner.id}`}
            >
              <Gavel size={16} /> 지금 입찰하기
            </Link>
          </div>
        </section>
      ) : (
        <section className="mt-8 rounded-3xl border border-dashed border-zinc-700 bg-zinc-900/60 p-10 text-center text-zinc-100">
          <Sparkles className="mx-auto text-amber-400" />
          <h2 className="mt-4 text-xl font-black">
            오늘의 헤드라이너를 준비하고 있습니다
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            공개 시 실시간 가격과 참여 현황이 이곳에 표시됩니다.
          </p>
        </section>
      )}
      <section className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black tracking-[.16em] text-amber-500">
              NEXT DROP
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-[-.04em]">
              내일의 옥션 미리보기
            </h2>
          </div>
          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4 text-xs font-black transition hover:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500"
            href={`${basePath}/my?tab=settings`}
          >
            <Bell size={15} /> 경매 오픈 알림 설정
          </Link>
        </div>
        {upcoming.length > 0 ? (
          <div className="mt-5 flex snap-x gap-3 overflow-x-auto pb-3">
            {upcoming.map((product) => (
              <Link
                className="min-w-48 snap-start overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
                href={`${basePath}/live/${product.id}`}
                key={product.id}
              >
                <div className="relative aspect-[3/4] bg-zinc-950">
                  <Image
                    alt={product.title}
                    className="object-cover"
                    fill
                    sizes="192px"
                    src={
                      product.imageUrls[0] ??
                      product.thumbnailUrls[0] ??
                      "/ninety-nine-vintage-brand.jpg"
                    }
                  />
                </div>
                <div className="p-4">
                  <p className="truncate text-xs font-bold">{product.title}</p>
                  <p className="mt-2 font-mono text-[10px] text-zinc-500">
                    {new Date(product.publishAt).toLocaleString("ko-KR")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-400">
            다음 공개 상품은 준비되는 즉시 표시됩니다.
          </p>
        )}
      </section>
    </>
  );
}
