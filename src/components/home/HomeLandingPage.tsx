"use client";

import Link from "next/link";
import { useMemo } from "react";

import Button from "@/src/components/common/Button";
import { useAuctionClock } from "@/src/hooks/useAuctionClock";
import type { AuctionPost } from "@/src/types/auction";
import { getDailyAuctionPhase } from "@/src/utils/auctionBidPolicy";
import { formatCountdown, formatKRW } from "@/src/utils/formatters";
import { toCommerceProductView } from "@/src/features/commerce/productViewModel";

interface HomeLandingPageProps {
  posts: readonly AuctionPost[];
  isLoading: boolean;
  onSignIn: () => void;
  isAuthenticated: boolean;
}

function HomeProductCard({ post }: { post: AuctionPost }) {
  const productView = toCommerceProductView(post);
  const imageUrl = post.thumbnailUrls[0] || post.imageUrls[0];
  const price = post.saleType === "fixed" ? post.fixedPrice : post.currentPrice || post.startingPrice;

  return (
    <Link
      href={`/auction/${encodeURIComponent(post.id)}`}
      className="group block border-b border-[var(--border)] pb-4 transition-colors hover:border-[var(--text-strong)]"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-[var(--surface-muted)]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={productView.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid size-full place-items-center text-xs font-black tracking-[0.15em] text-[var(--text-muted)]">
            NINETY-NINE
          </div>
        )}
      </div>
      <div className="pt-3">
        <p className="line-clamp-1 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {productView.size !== "표기 없음" ? `SIZE · ${productView.size}` : "VINTAGE ARCHIVE"}
        </p>
        <h3 className="mt-1 line-clamp-2 min-h-10 text-sm font-black leading-5 tracking-[-0.02em] text-[var(--text-strong)]">
          {productView.name}
        </h3>
        <p className="mt-3 font-mono text-sm font-black tabular-nums tracking-tight text-[var(--accent-text)]">
          {price ? formatKRW(price) : "가격 확인 중"}
        </p>
      </div>
    </Link>
  );
}

function HomeLoadingGrid() {
  return (
    <div className="grid grid-cols-4 gap-5" aria-busy="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="overflow-hidden border-b border-[var(--border)] pb-4">
          <div className="commerce-skeleton aspect-[4/5]" />
          <div className="space-y-2 pt-3">
            <div className="commerce-skeleton h-3 w-20" />
            <div className="commerce-skeleton h-4 w-4/5" />
            <div className="commerce-skeleton h-4 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function HomeLandingPage({
  posts,
  isLoading,
  onSignIn,
  isAuthenticated,
}: HomeLandingPageProps) {
  const { currentTime, countdown } = useAuctionClock({ rollover: true });
  const phase = getDailyAuctionPhase(currentTime);
  const visiblePosts = useMemo(() => {
    const now = currentTime.getTime();
    return posts
      .filter((post) => {
        const publishAt = Date.parse(post.publish_at ?? post.createdAt);
        return post.status === "active" && Number.isFinite(publishAt) && publishAt <= now;
      })
      .slice(0, 4);
  }, [currentTime, posts]);

  return (
    <main className="mx-auto w-full max-w-[1680px] px-10 pb-20">
      <section className="grid min-h-[430px] grid-cols-[minmax(0,1.2fr)_minmax(420px,.8fr)] border-b-2 border-[var(--text-strong)]">
        <div className="flex flex-col justify-between border-r border-[var(--border)] py-16 pr-14">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-[var(--accent-text)]">NINETY-NINE VINTAGE · WELCOME</p>
            <h1 className="mt-6 max-w-3xl text-[4.8rem] font-black leading-[0.98] tracking-[-0.075em] text-[var(--text-strong)]">
              시간을 다시 입는<br />빈티지 셀렉션.
            </h1>
            <p className="mt-7 max-w-xl break-keep text-base font-medium leading-7 text-[var(--text-muted)]">
              매일 공개되는 한정 빈티지를 보고, 마음에 드는 상품에 투명하게 입찰하거나 표시된 가격으로 바로 구매하세요.
            </p>
          </div>
          <div className="mt-10 flex items-center gap-3">
            <Link href="/feed"><Button size="lg">LIVE AUCTION 입장</Button></Link>
            <Link href="/shop"><Button size="lg" variant="secondary">BUY NOW 둘러보기</Button></Link>
            {!isAuthenticated ? <button type="button" onClick={onSignIn} className="text-xs font-black text-[var(--text-muted)] underline decoration-[var(--border-strong)] underline-offset-4 transition-colors hover:text-[var(--text-strong)]">카카오로 시작하기</button> : null}
          </div>
        </div>
        <div className="flex flex-col justify-between bg-[var(--surface-muted)] p-10">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">TODAY&apos;S DROP</span>
            <span className="font-mono text-xs font-black tabular-nums tracking-tight">KST · 21:00 CLOSE</span>
          </div>
          <div className="py-10">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">{phase === "closed" ? "NEXT DROP OPENS" : "LIVE DROP COUNTDOWN"}</p>
            <p className="mt-4 font-mono text-6xl font-black tabular-nums tracking-[-0.08em] text-[var(--text-strong)]">{phase === "closed" ? "22:00" : formatCountdown(countdown)}</p>
            <p className="mt-5 max-w-sm break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">오전 10시 공개 · 20:56 신규 참여 제한 · 21:00 마감 · 22:00 재입찰</p>
          </div>
          <div className="grid grid-cols-3 border-t border-[var(--border)] pt-5 text-xs font-bold text-[var(--text-muted)]">
            <span><strong className="block font-mono text-lg text-[var(--text-strong)]">01</strong>Browse</span>
            <span><strong className="block font-mono text-lg text-[var(--text-strong)]">02</strong>Bid / Buy</span>
            <span><strong className="block font-mono text-lg text-[var(--text-strong)]">03</strong>Settle</span>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-[240px_minmax(0,1fr)] gap-12 border-b border-[var(--border)] py-14">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--accent-text)]">HOW IT WORKS</p>
          <h2 className="mt-3 text-2xl font-black tracking-[-0.05em]">처음이라면<br />이 순서로 시작하세요.</h2>
        </div>
        <div className="grid grid-cols-3 gap-8">
          {[
            ["01", "상품 찾기", "LIVE AUCTION에서 오늘의 상품을 확인하거나 BUY NOW에서 정가 상품을 둘러봅니다."],
            ["02", "참여하기", "경매는 현재가보다 높은 금액으로 입찰하고, 상시 구매는 표시된 정가로 구매를 확정합니다."],
            ["03", "결제·배송", "낙찰 또는 구매 확정 후 내 정보에서 계좌이체 안내와 배송 신청을 진행합니다."],
          ].map(([number, title, copy]) => (
            <article key={number} className="border-t-2 border-[var(--text-strong)] pt-4">
              <span className="font-mono text-sm font-black tabular-nums text-[var(--accent-text)]">{number}</span>
              <h3 className="mt-8 text-lg font-black">{title}</h3>
              <p className="mt-3 break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-b border-[var(--border)] py-14" aria-labelledby="home-feed-title">
        <div className="mb-6 flex items-end justify-between border-b border-[var(--border)] pb-4">
          <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--accent-text)]">A QUICK LOOK</p><h2 id="home-feed-title" className="mt-2 text-2xl font-black tracking-[-0.05em]">지금 공개된 상품</h2></div>
          <Link href="/feed" className="text-xs font-black underline underline-offset-4 transition-colors hover:text-[var(--accent-text)]">전체 경매 보기 →</Link>
        </div>
        {isLoading && visiblePosts.length === 0 ? <HomeLoadingGrid /> : visiblePosts.length > 0 ? <div className="grid grid-cols-4 gap-5">{visiblePosts.map((post) => <HomeProductCard key={post.id} post={post} />)}</div> : <div className="border border-dashed border-[var(--border-strong)] px-6 py-14 text-center"><p className="text-lg font-black">다음 드롭을 준비 중입니다.</p><p className="mt-2 text-sm text-[var(--text-muted)]">경매 피드에서 공개 예정 상품을 확인해 보세요.</p><Link href="/feed" className="mt-5 inline-flex border border-[var(--border-strong)] px-4 py-2 text-xs font-black">경매 피드 열기</Link></div>}
      </section>

      <section className="grid grid-cols-4 gap-8 py-14">
        <Link href="/feed" className="group border-t-2 border-[var(--text-strong)] pt-4"><p className="text-[10px] font-black tracking-[0.2em] text-[var(--text-muted)]">01 · LIVE AUCTION</p><h2 className="mt-6 text-xl font-black group-hover:underline">실시간 경매</h2><p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">오늘 공개된 상품과 현재 입찰가를 확인하세요.</p></Link>
        <Link href="/shop" className="group border-t-2 border-[var(--text-strong)] pt-4"><p className="text-[10px] font-black tracking-[0.2em] text-[var(--text-muted)]">02 · BUY NOW</p><h2 className="mt-6 text-xl font-black group-hover:underline">상시 바로구매</h2><p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">기다림 없이 정가로 바로 구매하세요.</p></Link>
        <Link href="/account" className="group border-t-2 border-[var(--text-strong)] pt-4"><p className="text-[10px] font-black tracking-[0.2em] text-[var(--text-muted)]">03 · MY ACCOUNT</p><h2 className="mt-6 text-xl font-black group-hover:underline">내 정보·결제</h2><p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">낙찰품 결제, 배송지, 보관함을 관리하세요.</p></Link>
        <Link href="/chat" className="group border-t-2 border-[var(--text-strong)] pt-4"><p className="text-[10px] font-black tracking-[0.2em] text-[var(--text-muted)]">04 · SUPPORT</p><h2 className="mt-6 text-xl font-black group-hover:underline">상담·문의</h2><p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">상품 문의와 이용 도움을 운영팀에 보내세요.</p></Link>
      </section>
    </main>
  );
}
