"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthModal from "@/src/components/auth/AuthModal";
import Button from "@/src/components/common/Button";
import { Toast } from "@/src/components/common/Toast";
import BidConfirmModal from "@/src/components/feed/BidConfirmModal";
import BidFormModal from "@/src/components/feed/BidFormModal";
import BidHistoryModal from "@/src/components/feed/BidHistoryModal";
import ProductInquiryModal from "@/src/components/feed/ProductInquiryModal";
import SizeComparisonScanner from "@/src/components/feed/SizeComparisonScanner";
import PhotoGallery from "@/src/components/feed/PhotoGallery";
import { useAuthSession } from "@/src/hooks/useAuthSession";
import { useAuctionPolicyMinuteClock } from "@/src/hooks/useAuctionPolicyClock";
import { isMemberRole } from "@/src/lib/supabase/auth";
import {
  claimFixedPriceProduct,
  fetchPublishedProductById,
} from "@/src/lib/supabase/products";
import { placeBid } from "@/src/lib/supabase/bids";
import { startProductInquiry } from "@/src/lib/supabase/supportChat";
import type { AuctionPost } from "@/src/types/auction";
import { getProductFeedDetails } from "@/src/utils/productFeedDetails";
import { toCommerceProductView } from "@/src/features/commerce/productViewModel";
import { getAuctionBidDecision } from "@/src/utils/auctionBidPolicy";
import { getMinimumBidAmount, getQuickBidAmount } from "@/src/utils/bidding";
import { getUserBidState } from "@/src/utils/bidStatus";
import { formatKRW } from "@/src/utils/formatters";

function getClosingLabel(post: AuctionPost, now: Date) {
  const remaining = Math.max(Date.parse(post.closesAt) - now.getTime(), 0);
  if (remaining <= 0) return "CLOSED";
  const totalMinutes = Math.floor(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `CLOSE ${String(hours).padStart(2, "0")}H ${String(minutes).padStart(2, "0")}M`;
}

function DetailSkeleton() {
  return (
    <main className="mx-auto grid w-full max-w-[1680px] grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)] gap-12 px-10 py-10" aria-busy="true">
      <div className="space-y-4">
        <div className="commerce-skeleton aspect-[4/5]" />
        <div className="grid grid-cols-6 gap-3">{Array.from({ length: 6 }, (_, index) => <div className="commerce-skeleton aspect-square" key={index} />)}</div>
      </div>
      <div className="space-y-5 border-l border-[var(--border)] pl-10">
        <div className="commerce-skeleton h-3 w-24" />
        <div className="commerce-skeleton h-12 w-4/5" />
        <div className="commerce-skeleton h-28 w-full" />
        <div className="commerce-skeleton h-14 w-full" />
      </div>
    </main>
  );
}

export default function EditorialAuctionDetail({ productId }: { productId: string }) {
  const router = useRouter();
  const auth = useAuthSession();
  const now = useAuctionPolicyMinuteClock();
  const [post, setPost] = useState<AuctionPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [bidOpen, setBidOpen] = useState(false);
  const [pendingBid, setPendingBid] = useState<number | null>(null);
  const [pendingCurrentPrice, setPendingCurrentPrice] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadProduct = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPost(await fetchPublishedProductById(productId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "상품을 불러오지 못했어요.");
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProduct(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProduct]);

  const details = useMemo(() => (post ? getProductFeedDetails(post) : null), [post]);
  const productView = useMemo(() => (post ? toCommerceProductView(post) : null), [post]);
  const bidState = post ? getUserBidState(post, auth.profile?.displayName ?? "") : null;
  const bidDecision = post ? getAuctionBidDecision({ post, currentUserName: auth.profile?.displayName ?? "", now }) : null;
  const displayedPrice = bidState?.leadingBid?.amount ?? post?.startingPrice ?? 0;
  const minimumBid = post ? getMinimumBidAmount(post) : 0;
  const quickBid = post ? getQuickBidAmount(post) : 0;

  const requireMember = () => {
    if (auth.user && isMemberRole(auth.role)) return true;
    if (!auth.user) {
      setAuthOpen(true);
      return false;
    }
    setToast("운영 스태프 계정은 입찰할 수 없습니다.");
    return false;
  };

  const submitBid = async (amount: number) => {
    if (!post || !requireMember()) return;
    setBusy(true);
    try {
      await placeBid(post.id, amount);
      await loadProduct();
      setToast(`${formatKRW(amount)}으로 입찰했습니다.`);
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "입찰을 완료하지 못했어요.");
      throw reason;
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <DetailSkeleton />;
  if (error || !post || !details || !productView) {
    return <main className="mx-auto max-w-[720px] px-10 py-24 text-center"><h1 className="text-2xl font-black">상품을 찾을 수 없습니다.</h1><p className="mt-3 text-sm text-[var(--text-muted)]">{error || "공개가 종료되었거나 존재하지 않는 상품입니다."}</p><Link className="mt-8 inline-flex border border-[var(--border-strong)] px-5 py-3 text-sm font-black" href="/feed">경매 피드로 돌아가기</Link></main>;
  }

  const closingLabel = getClosingLabel(post, now);
  const galleryTitle = productView.name;
  const canBid = post.saleType === "auction" && Boolean(bidDecision?.allowed) && post.status === "active";

  return (
    <main className="mx-auto grid w-full max-w-[1760px] grid-cols-[minmax(0,1.5fr)_420px] gap-14 px-10 py-12">
      <div className="col-span-2 flex items-center justify-between border-b border-[var(--text-strong)] pb-5">
        <button type="button" onClick={() => router.back()} className="inline-flex min-h-10 items-center gap-2 border border-[var(--border)] px-4 text-[11px] font-black text-[var(--text-muted)] transition-all hover:border-[var(--text-strong)] hover:text-[var(--text-strong)] active:scale-95">
          <span aria-hidden="true">←</span> 이전 화면 / CATALOG
        </button>
        <Link href="/feed" className="nn-data-label text-[var(--text-strong)] underline underline-offset-4">LIVE AUCTION / DETAIL</Link>
      </div>
      <section>
        <div className="nn-surface bg-[var(--surface-muted)] p-4">
          <PhotoGallery images={post.imageUrls} thumbnailImages={post.thumbnailUrls} title={galleryTitle} lotLabel={`LOT ${post.id.slice(0, 8).toUpperCase()}`} />
        </div>
        <section className="mt-14 grid grid-cols-2 gap-10 border-t border-[var(--text-strong)] pt-6">
          <div className="border-y border-[var(--border)]">
            <p className="nn-data-label border-b border-[var(--border)] py-4">PRODUCT SPECIFICATION</p>
            <dl className="divide-y divide-[var(--border)] text-sm">
              <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--text-muted)]">브랜드</dt><dd className="font-bold">{productView.brand}</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--text-muted)]">사이즈</dt><dd className="font-bold">{productView.size}</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--text-muted)]">상태</dt><dd className="font-bold">{productView.condition}</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--text-muted)]">판매 방식</dt><dd className="font-bold">{post.saleType === "fixed" ? "BUY NOW" : "LIVE BID"}</dd></div>
            </dl>
          </div>
          <div className="nn-surface p-6">
            <p className="nn-data-label">CURATOR NOTE</p>
            <p className="mt-4 whitespace-pre-line text-sm leading-7 text-[var(--text-muted)]">{productView.description || "상세 사진과 상품 상태를 확인해 주세요."}</p>
          </div>
        </section>
      </section>

      <aside className="sticky top-[8rem] self-start border-l border-[var(--border)] pl-10">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-5"><span className="font-mono text-[10px] font-black tracking-[0.14em] text-[var(--text-muted)]">{closingLabel}</span><span className="border border-[var(--border)] px-2 py-1 text-[10px] font-black">{post.saleType === "fixed" ? "BUY NOW" : "LIVE BID"}</span></div>
        <p className="nn-data-label mt-8">{productView.brand} / VINTAGE EDIT</p>
        <h1 className="mt-3 text-5xl font-black leading-[0.98] tracking-[-0.075em]">{galleryTitle}</h1>
        <p className="mt-5 line-clamp-3 whitespace-pre-line text-sm leading-6 text-[var(--text-muted)]">{productView.description || "상세 사진과 상품 상태를 확인해 주세요."}</p>
        <div className="mt-8 border-y border-[var(--text-strong)] py-6"><p className="nn-data-label">{post.saleType === "fixed" ? "판매 정가" : bidState?.status === "user-leading" ? "내 입찰 최고가" : "현재 입찰가"}</p><p className="mt-2 font-mono text-4xl font-black tabular-nums tracking-[-0.06em] text-[var(--accent-text)]">{formatKRW(post.saleType === "fixed" ? (post.fixedPrice ?? post.currentPrice) : displayedPrice)}</p></div>
        <button type="button" onClick={() => setScannerOpen(true)} className="mt-6 flex min-h-12 w-full items-center justify-between border border-[var(--border)] bg-[var(--surface-raised)] px-4 text-sm font-black transition-all duration-200 hover:border-[var(--text-strong)] active:scale-[0.99]"><span>📏 내 옷과 실측 비교하기</span><span aria-hidden="true">→</span></button>
        <div className="mt-6 grid gap-3">
          {post.saleType === "fixed" ? <Button fullWidth size="lg" className="min-h-14 text-sm font-black" isLoading={busy} onClick={async () => { if (!requireMember()) return; setBusy(true); try { await claimFixedPriceProduct(post.id); setToast("구매가 확정되었습니다. 내 정보에서 결제를 진행해 주세요."); } catch (reason) { setToast(reason instanceof Error ? reason.message : "구매를 확정하지 못했어요."); } finally { setBusy(false); } }}>바로 구매하기</Button> : canBid ? <><Button fullWidth size="lg" className="min-h-14 text-sm font-black" onClick={() => { setPendingCurrentPrice(post.currentPrice); setBidOpen(true); }}>경매하기</Button><Button fullWidth size="lg" variant="secondary" className="min-h-14 text-sm font-black" onClick={() => { setPendingCurrentPrice(post.currentPrice); setPendingBid(quickBid); }}>+1,000원 입찰하기</Button></> : <Button fullWidth size="lg" disabled className="min-h-14 text-sm font-black">{post.status === "closed" ? "경매 마감" : "현재 입찰 불가"}</Button>}
        </div>
        {post.saleType === "auction" ? <button type="button" onClick={() => setHistoryOpen(true)} className="mt-4 w-full border-b border-[var(--border)] py-3 text-left text-xs font-black text-[var(--text-muted)]">입찰 현황 보기 · <span className="font-mono tabular-nums">{post.bidHistory.length.toLocaleString("ko-KR")}건</span></button> : null}
        <button type="button" onClick={() => setInquiryOpen(true)} className="mt-4 w-full border border-[var(--border)] py-3 text-xs font-black transition-colors hover:border-[var(--text-strong)]">상품 문의하기</button>
      </aside>

      <BidFormModal open={bidOpen} onClose={() => setBidOpen(false)} onSubmit={(amount) => { setBidOpen(false); setPendingBid(amount); }} title={details.name} currentPrice={post.currentPrice} bidIncrement={post.bidIncrement} minimumBid={minimumBid} productDescription={post.description} productSize={details.size} userId={auth.user?.id ?? null} />
      <BidConfirmModal open={pendingBid !== null} currentPrice={pendingCurrentPrice ?? post.currentPrice} latestCurrentPrice={post.currentPrice} amount={pendingBid ?? 0} itemTitle={details.name} isFinalBid={Boolean(bidDecision?.finalOnAccept)} onClose={() => { setPendingBid(null); setPendingCurrentPrice(null); }} onConfirm={async () => { if (pendingBid === null) return; await submitBid(pendingBid); setPendingBid(null); setPendingCurrentPrice(null); }} />
      <BidHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} itemTitle={details.name} history={post.bidHistory} />
      <ProductInquiryModal open={inquiryOpen} productLabel={details.name} onClose={() => setInquiryOpen(false)} onSubmit={async (message) => { if (!requireMember()) return; await startProductInquiry(post.id, message); setToast("운영팀에 상품 문의를 전송했습니다."); }} />
      <SizeComparisonScanner open={scannerOpen} onClose={() => setScannerOpen(false)} productTitle={details.name} productDescription={post.description} productSize={details.size} userId={auth.user?.id ?? null} />
      {authOpen ? <AuthModal open onClose={() => setAuthOpen(false)} /> : null}
      <Toast message={toast} visible={Boolean(toast)} onDismiss={() => setToast("")} />
    </main>
  );
}
