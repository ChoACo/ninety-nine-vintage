"use client";

import Link from "next/link";
import AuctionClock from "@/src/components/common/AuctionClock";
import DeferredProductImage from "@/src/components/common/DeferredProductImage";
import { SoldAuctionFeed } from "@/src/components/feed/SoldAuctionFeed";
import { useAuctionPolicyMinuteClock } from "@/src/hooks/useAuctionPolicyClock";
import type { PublicSoldAuction } from "@/src/lib/supabase/auctionLifecycle";
import type { AuctionPost } from "@/src/types/auction";
import { getCatalogThumbnailUrl } from "@/src/utils/catalogImages";
import { formatKRW, getCountdown } from "@/src/utils/formatters";

export interface HomeLandingProps {
  posts: readonly AuctionPost[];
  isLoading: boolean;
  error: string;
  onRetry: () => void | Promise<void>;
  soldAuctions: readonly PublicSoldAuction[];
  soldAuctionsLoading: boolean;
  soldAuctionsError: string;
  onRetrySoldAuctions: () => void | Promise<void>;
}

interface ShowcaseCardProps {
  post: AuctionPost;
  now: Date;
  priority?: boolean;
}

function formatCompactRemaining(totalSeconds: number): string {
  const totalMinutes = Math.max(Math.ceil(totalSeconds / 60), 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}H ${String(minutes).padStart(2, "0")}M`;
}

function ShowcaseCard({ post, now, priority = false }: ShowcaseCardProps) {
  const countdown = getCountdown(post.closesAt, now);
  const thumbnail = getCatalogThumbnailUrl(
    post.thumbnailUrls[0],
    post.imageUrls[0],
  );

  return (
    <Link
      href={`/feed?focus=${encodeURIComponent(post.id)}`}
      prefetch={false}
      className="group min-w-0 overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)] transition-all duration-200 ease-out hover:-translate-y-1 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[var(--surface-muted)]">
        <DeferredProductImage
          key={thumbnail}
          src={thumbnail}
          alt={`${post.title} 상품 미리보기`}
          sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw"
          wrapperClassName="h-full w-full"
          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
        <span className="absolute left-2 top-2 border border-white/15 bg-black/70 px-2 py-1 font-mono text-[9px] font-black tabular-nums tracking-tight text-white backdrop-blur-md sm:left-3 sm:top-3 sm:text-[10px]">
          LOT {post.id.slice(0, 4).toUpperCase()}
        </span>
        <span
          className={`absolute bottom-2 right-2 border px-2 py-1 font-mono text-[9px] font-black tabular-nums tracking-tight text-white backdrop-blur-md sm:bottom-3 sm:right-3 sm:text-[10px] ${
            countdown.totalSeconds <= 600
              ? "anti-sniping-pulse border-red-300/50 bg-red-600/90"
              : countdown.totalSeconds <= 3600
                ? "border-orange-300/40 bg-orange-600/85"
                : "border-white/15 bg-black/70"
          }`}
        >
          {countdown.isExpired
            ? "마감"
            : formatCompactRemaining(countdown.totalSeconds)}
        </span>
      </div>
      <div className="p-3 sm:p-4">
        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)] sm:text-[10px]">
          {priority ? "Closing soon" : "Today’s edit"}
        </p>
        <h3 className="mt-1.5 line-clamp-2 text-sm font-black leading-5 tracking-[-0.025em] text-[var(--text-strong)] sm:text-base sm:leading-6">
          {post.title}
        </h3>
        <p className="mt-3 font-mono text-sm font-black tabular-nums tracking-tight text-[var(--accent-text)] sm:text-base">
          {formatKRW(post.currentPrice)}
        </p>
      </div>
    </Link>
  );
}

function ShowcaseSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <article key={index} aria-hidden="true" className="border border-[var(--border)] bg-[var(--surface-raised)]">
          <div className="commerce-skeleton aspect-[4/3] rounded-none" />
          <div className="space-y-2 p-3 sm:p-4">
            <div className="commerce-skeleton h-2.5 w-20 rounded-sm" />
            <div className="commerce-skeleton h-4 w-4/5 rounded-sm" />
            <div className="commerce-skeleton h-4 w-2/5 rounded-sm" />
          </div>
        </article>
      ))}
    </div>
  );
}

export default function HomeLanding({
  posts,
  isLoading,
  error,
  onRetry,
  soldAuctions,
  soldAuctionsLoading,
  soldAuctionsError,
  onRetrySoldAuctions,
}: HomeLandingProps) {
  const now = useAuctionPolicyMinuteClock();
  const publishedPosts = posts.filter((post) => {
    const publishAt = Date.parse(post.publish_at ?? post.createdAt);
    return post.status === "active" && Number.isFinite(publishAt) && publishAt <= now.getTime();
  });
  const closingOrder = [...publishedPosts].sort(
    (left, right) => Date.parse(left.closesAt) - Date.parse(right.closesAt),
  );
  const closingWithinHour = closingOrder.filter((post) => {
    const remaining = Date.parse(post.closesAt) - now.getTime();
    return remaining > 0 && remaining <= 60 * 60 * 1000;
  });
  const urgentPosts = [
    ...closingWithinHour,
    ...closingOrder.filter((post) => !closingWithinHour.includes(post)),
  ].slice(0, 4);
  const urgentIds = new Set(urgentPosts.map((post) => post.id));
  const recommendedPosts = publishedPosts
    .filter((post) => !urgentIds.has(post.id))
    .slice(0, 6);

  return (
    <main className="mx-auto w-full max-w-[1680px] px-3 pb-28 pt-4 sm:px-5 sm:pt-6 lg:px-6 lg:pb-14">
      <AuctionClock
        antiSnipingDeadlines={publishedPosts
          .filter((post) => (post.antiSnipingExtensionCount ?? 0) > 0)
          .map((post) => post.closesAt)}
      />

      <section className="group relative mt-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-black text-white shadow-[0_24px_72px_rgba(0,0,0,0.24)] sm:mt-5 sm:rounded-[1.5rem]">
        <picture className="absolute inset-0 block h-full w-full">
          <source
            media="(min-width: 1440px)"
            srcSet="/ninety-nine-vintage-banner.png"
          />
          <source
            media="(min-width: 768px)"
            srcSet="/ninety-nine-vintage-profile-hd.jpg"
          />
          <img
            src="/ninety-nine-vintage-brand.jpg"
            alt="나인티 나인 빈티지 오늘의 라이브 드롭"
            width={1024}
            height={1024}
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover object-center opacity-45 transition-transform duration-700 ease-out group-hover:scale-[1.015]"
          />
        </picture>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.92)_0%,rgba(0,0,0,0.72)_48%,rgba(0,0,0,0.18)_100%)]" aria-hidden="true" />
        <div className="relative z-10 flex min-h-[21rem] max-w-3xl flex-col justify-end px-5 py-8 sm:min-h-[27rem] sm:px-9 sm:py-11 lg:px-12 lg:py-14">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-300 sm:text-xs">
            NINETY-NINE LIVE DROP · DAILY 10:00
          </p>
          <h1 className="mt-3 max-w-2xl text-[2rem] font-black leading-[1.02] tracking-[-0.055em] sm:text-[3.4rem] lg:text-[4.25rem]">
            오늘 단 한 번,
            <span className="block text-zinc-300">다시 없는 빈티지.</span>
          </h1>
          <p className="mt-4 max-w-xl break-keep text-sm font-medium leading-6 text-zinc-300 sm:text-base sm:leading-7">
            모든 입찰 기록과 낙찰 결과를 공개하는 투명한 라이브 경매에서 오늘의 셀렉션을 만나보세요.
          </p>
          <Link
            href="/feed"
            className="mt-6 inline-flex min-h-12 w-fit items-center gap-3 rounded-lg bg-white px-5 text-sm font-black text-black transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-zinc-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            전체 경매 피드 보기 <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="urgent-showcase-title">
        <div className="mb-5 flex items-end justify-between gap-4 border-b border-[var(--border)] pb-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-500">Live urgency</p>
            <h2 id="urgent-showcase-title" className="mt-1.5 text-2xl font-black tracking-[-0.04em] text-[var(--text-strong)] sm:text-3xl">
              🔥 마감 임박 Top 4
            </h2>
          </div>
          <Link href="/feed?sort=closing" prefetch={false} className="shrink-0 text-xs font-black text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[var(--text-strong)] hover:underline sm:text-sm">
            임박순 전체보기
          </Link>
        </div>
        {isLoading && urgentPosts.length === 0 ? (
          <ShowcaseSkeleton count={4} />
        ) : urgentPosts.length > 0 ? (
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
            {urgentPosts.map((post) => <ShowcaseCard key={post.id} post={post} now={now} priority />)}
          </div>
        ) : (
          <div className="border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-5 py-12 text-center text-sm font-bold text-[var(--text-muted)]">
            {error ? (
              <><p>{error}</p><button type="button" onClick={() => void onRetry()} className="mt-4 min-h-10 rounded-lg border border-[var(--border-strong)] px-4 text-[var(--text-strong)]">다시 불러오기</button></>
            ) : "현재 공개 중인 경매가 없습니다. 다음 라이브 드롭을 준비하고 있어요."}
          </div>
        )}
      </section>

      {recommendedPosts.length > 0 ? (
        <section className="mt-12" aria-labelledby="recommend-showcase-title">
          <div className="mb-5 border-b border-[var(--border)] pb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--accent-text)]">Curated vintage</p>
            <h2 id="recommend-showcase-title" className="mt-1.5 text-2xl font-black tracking-[-0.04em] text-[var(--text-strong)] sm:text-3xl">✨ 오늘의 추천 빈티지</h2>
            <p className="mt-2 text-sm font-medium text-[var(--text-muted)]">오늘 공개된 셀렉션에서 먼저 살펴볼 에디터 픽입니다.</p>
          </div>
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
            {recommendedPosts.map((post) => <ShowcaseCard key={post.id} post={post} now={now} />)}
          </div>
        </section>
      ) : null}

      <SoldAuctionFeed
        auctions={soldAuctions}
        isLoading={soldAuctionsLoading}
        error={soldAuctionsError}
        onRetry={onRetrySoldAuctions}
      />

      <section className="mt-12 grid overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)] md:grid-cols-3" aria-labelledby="brand-story-title">
        <div className="border-b border-[var(--border)] p-6 md:col-span-2 md:border-b-0 md:border-r md:p-9">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--accent-text)]">Our standard</p>
          <h2 id="brand-story-title" className="mt-2 text-2xl font-black tracking-[-0.04em] text-[var(--text-strong)]">다시 입는 가치까지 투명하게.</h2>
          <p className="mt-4 max-w-2xl break-keep text-sm font-medium leading-7 text-[var(--text-muted)]">
            나인티 나인 빈티지는 한 벌씩 선별한 빈티지 의류의 상태와 실측을 정직하게 기록하고, 공개 입찰 기록을 통해 누구나 결과를 확인할 수 있는 경매 문화를 만듭니다.
          </p>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-[var(--border)] md:grid-cols-1 md:divide-x-0 md:divide-y">
          {[['10:00', '매일 상품 공개'], ['20:56', '신규 참여 제한'], ['21:00', '경매 정산']].map(([time, label]) => (
            <div key={time} className="p-4 text-center md:px-6 md:py-5 md:text-left">
              <dt className="font-mono text-base font-black tabular-nums tracking-tight text-[var(--text-strong)]">{time}</dt>
              <dd className="mt-1 text-[10px] font-bold text-[var(--text-muted)] sm:text-xs">{label}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
