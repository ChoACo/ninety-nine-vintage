"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Heart,
  List,
  LockKeyhole,
  MessageCircle,
  Ruler,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuctionPolicyClock } from "@/hooks/useAuctionPolicyClock";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useBidStore } from "@/store/useBidStore";
import type { BidHistoryEntry, ItemDetail } from "@/types/detail";
import { measurementEntries } from "@/lib/catalog/measurements";
import { ProductInquiryModal } from "@/components/features/auction/detail/ProductInquiryModal";
import { SizeComparisonScanner } from "@/components/features/auction/detail/SizeComparisonScanner";
import { ShareProductButton } from "@/components/ui/ShareProductButton";
import { AuctionBidHistoryModal } from "@/components/features/auction/AuctionBidHistoryModal";
import { useAccountAuctionBids } from "@/components/features/auction/AuctionBidSummary";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import {
  canStartAuctionBid,
  getAuctionFeedBidAccess,
  getAuctionFeedPhase,
  getAuctionRemainingLabel,
  parseAuctionProductRealtimeSnapshot,
  type AuctionFeedPhase,
} from "@/components/features/auction/auctionFeedLogic";
import { SettlementActions } from "@/components/features/auction/detail/SettlementActions";
import { useCommerceStore } from "@/store/useCommerceStore";
import { useToastStore } from "@/store/useToastStore";
import { persistWishlist, reserveCartProduct } from "@/lib/commerce/client";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { getDailyAuctionPhase } from "@/utils/auctionBidPolicy";
import {
  consumeFixedPurchaseIntent,
  rememberFixedPurchaseIntent,
  type FixedPurchaseIntent,
} from "@/lib/commerce/purchaseIntent";
import { formatConditionGrade } from "@/lib/catalog/conditions";
import { MobileBidBar } from "@/components/mobile/MobileBidBar";
import {
  AUCTION_BID_OPTIMISTIC_EVENT,
  type AuctionBidOptimisticDetail,
} from "@/lib/auction/bidEvents";

interface StickyBidPanelProps {
  basePath?: "" | "/m";
  compact?: boolean;
  item: ItemDetail;
  surface?: "desktop" | "mobile";
}

function getFixedCheckoutHref(basePath: "" | "/m", productId: string) {
  return basePath === "/m"
    ? `/m/checkout?productId=${productId}`
    : `/cart?productId=${productId}`;
}

function navigateToFixedCheckout(
  basePath: "" | "/m",
  productId: string,
  replaceRoute: (href: string) => void,
) {
  const href = getFixedCheckoutHref(basePath, productId);
  if (basePath === "/m") {
    replaceRoute(href);
    return;
  }

  // A soft navigation can retain the intercepted product-detail @modal slot.
  // Rebuild the desktop route tree so checkout never opens behind that modal.
  window.location.replace(href);
}

interface RefreshedAuctionProduct {
  antiSnipingBaseClosesAt: string | null;
  antiSnipingExtendedAt: string | null;
  antiSnipingExtensionCount: number;
  bidHistory: unknown;
  bidLockedAt: string | null;
  closesAt: string;
  currentPrice: number;
  finalBidAmount: number | null;
  participantCount: number;
  publishAt: string;
  status: "pending" | "active" | "closed";
}

function refreshedBidHistory(
  value: unknown,
  productId: string,
): BidHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const amount = Number(record.amount);
    const outcome = record.outcome ?? "active";
    if (
      typeof record.id !== "string" ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      (outcome !== "active" &&
        outcome !== "cancelled" &&
        outcome !== "unpaid_cancelled")
    )
      return [];
    const bidderName =
      typeof record.bidderName === "string" && record.bidderName.trim()
        ? record.bidderName.trim()
        : "회원";
    return [
      {
        amount,
        bidderId: "public",
        bidderMaskedId: bidderName,
        bidderName,
        createdAt: typeof record.bidAt === "string" ? record.bidAt : "",
        id: record.id,
        itemId: productId,
        outcome,
        timeLabel: index === 0 ? "최근" : "기록됨",
      },
    ];
  });
}

export function StickyBidPanel({
  basePath = "",
  compact = false,
  item,
  surface = "desktop",
}: StickyBidPanelProps) {
  const policyNow = useAuctionPolicyClock(item.saleType === "auction");
  const router = useRouter();
  const resumedPurchaseIntent = useRef(false);
  const accountRefreshTimer = useRef<number | null>(null);
  const productRefreshTimer = useRef<number | null>(null);
  const previousPhase = useRef<AuctionFeedPhase | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [realtimeState, setRealtimeState] = useState<
    "connected" | "reconnecting" | "offline"
  >("reconnecting");
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [wishlistBusy, setWishlistBusy] = useState(false);
  const [optimisticBid, setOptimisticBid] = useState<{
    amount: number;
    state: "pending" | "confirmed";
  } | null>(null);
  const [buyNotice, setBuyNotice] = useState("");
  const [buyNoticeKind, setBuyNoticeKind] = useState<"success" | "error">(
    "success",
  );
  const [auctionSnapshot, setAuctionSnapshot] = useState(() => ({
    bidLockedAt: item.bidLockedAt ?? null,
    closesAt: item.closesAt ?? "",
    currentPrice: item.currentBid,
    finalBidAmount: item.finalBidAmount ?? null,
    antiSnipingBaseClosesAt: item.antiSnipingBaseClosesAt ?? null,
    antiSnipingExtendedAt: item.antiSnipingExtendedAt ?? null,
    antiSnipingExtensionCount: item.antiSnipingExtensionCount ?? 0,
    participantCount: item.participantCount,
    publishAt: item.publishAt ?? "",
    status: item.status,
  }));
  const { session } = useSupabaseSession();
  const accountBids = useAccountAuctionBids(item.saleType === "auction");
  const accountBidItems = accountBids.items;
  const accountBidsSignedIn = accountBids.signedIn;
  const bidCapability = accountBids.capability;
  const refreshAccountBids = accountBids.refresh;
  const bids = useBidStore((state) => state.bids);
  const bidStoreItemId = useBidStore((state) => state.itemId);
  const hydrate = useBidStore((state) => state.hydrate);
  const replaceAuthoritative = useBidStore(
    (state) => state.replaceAuthoritative,
  );
  const addToCart = useCommerceStore((state) => state.addToCart);
  const removeFromCart = useCommerceStore((state) => state.removeFromCart);
  const cartContainsItem = useCommerceStore((state) =>
    state.cartIds.includes(item.id),
  );
  const pushToast = useToastStore((state) => state.pushToast);
  const liked = useCommerceStore((state) => state.likedIds.includes(item.id));
  const toggleLike = useCommerceStore((state) => state.toggleLike);
  const hydrateCommerce = useCommerceStore((state) => state.hydrate);

  const scheduleAccountBidRefresh = useCallback(() => {
    if (!accountBidsSignedIn) return;
    if (accountRefreshTimer.current !== null) {
      window.clearTimeout(accountRefreshTimer.current);
    }
    accountRefreshTimer.current = window.setTimeout(() => {
      accountRefreshTimer.current = null;
      refreshAccountBids();
    }, 800);
  }, [accountBidsSignedIn, refreshAccountBids]);

  const refreshProductSnapshot = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/products/${encodeURIComponent(item.id)}`,
        {
          cache: "no-store",
        },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        product?: RefreshedAuctionProduct;
      };
      const product = payload.product;
      if (!product) return;
      setAuctionSnapshot({
        antiSnipingBaseClosesAt: product.antiSnipingBaseClosesAt,
        antiSnipingExtendedAt: product.antiSnipingExtendedAt,
        antiSnipingExtensionCount: product.antiSnipingExtensionCount,
        bidLockedAt: product.bidLockedAt,
        closesAt: product.closesAt,
        currentPrice: product.currentPrice,
        finalBidAmount: product.finalBidAmount,
        participantCount: product.participantCount,
        publishAt: product.publishAt,
        status: product.status,
      });
      replaceAuthoritative(
        item.id,
        refreshedBidHistory(product.bidHistory, item.id),
        product.currentPrice,
      );
    } catch {
      // The allow-listed realtime snapshot and DB bid RPC remain authoritative.
      // A later realtime event or bounded poll retries this optional projection.
    }
  }, [item.id, replaceAuthoritative]);

  const scheduleProductRefresh = useCallback(() => {
    if (productRefreshTimer.current !== null) {
      window.clearTimeout(productRefreshTimer.current);
    }
    productRefreshTimer.current = window.setTimeout(() => {
      productRefreshTimer.current = null;
      void refreshProductSnapshot();
    }, 800);
  }, [refreshProductSnapshot]);

  useEffect(() => {
    const receiveOptimisticBid = (event: Event) => {
      const detail = (event as CustomEvent<AuctionBidOptimisticDetail>).detail;
      if (!detail || detail.productId !== item.id) return;
      if (detail.state === "rollback") {
        setOptimisticBid(null);
        return;
      }
      setOptimisticBid({ amount: detail.amount, state: detail.state });
      if (detail.state === "confirmed") scheduleProductRefresh();
    };
    window.addEventListener(AUCTION_BID_OPTIMISTIC_EVENT, receiveOptimisticBid);
    return () =>
      window.removeEventListener(
        AUCTION_BID_OPTIMISTIC_EVENT,
        receiveOptimisticBid,
      );
  }, [item.id, scheduleProductRefresh]);

  useEffect(() => {
    hydrate(item.id, item.bidHistory, item.currentBid);
  }, [hydrate, item.bidHistory, item.id, item.currentBid]);

  useEffect(() => hydrateCommerce(), [hydrateCommerce]);

  useEffect(() => {
    const requestedIntent = new URLSearchParams(window.location.search).get(
      "purchaseIntent",
    );
    if (
      resumedPurchaseIntent.current ||
      item.saleType !== "fixed" ||
      (requestedIntent !== "cart" && requestedIntent !== "buy")
    ) {
      return;
    }
    resumedPurchaseIntent.current = true;
    router.replace(`${basePath}/auction/${item.id}`, { scroll: false });
    const intent: FixedPurchaseIntent = requestedIntent;
    if (!consumeFixedPurchaseIntent(item.id, intent)) {
      queueMicrotask(() => {
        setBuyNotice("로그인 후 구매 버튼을 다시 눌러 주세요.");
        setBuyNoticeKind("error");
      });
      return;
    }

    void (async () => {
      setBuying(true);
      setBuyNotice("");
      setBuyNoticeKind("success");
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        const session = data.session;
        if (!session?.access_token) {
          throw new Error(
            "로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.",
          );
        }
        await reserveCartProduct(item.id, session.user.id);
        addToCart(item.id);
        if (intent === "buy") {
          setBuying(false);
          navigateToFixedCheckout(basePath, item.id, (href) =>
            router.replace(href),
          );
        } else {
          setBuyNoticeKind("success");
          setBuyNotice(
            "로그인 후 장바구니에 담았습니다. 구매 가능 여부는 결제 시 다시 확인됩니다.",
          );
        }
      } catch (error) {
        setBuyNoticeKind("error");
        setBuyNotice(
          error instanceof Error ? error.message : "구매 준비에 실패했습니다.",
        );
      } finally {
        setBuying(false);
      }
    })();
  }, [addToCart, basePath, item.id, item.saleType, router]);

  useEffect(() => {
    if (!LIVE_AUCTION_ENABLED || item.saleType !== "auction") return;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        item.id,
      )
    )
      return;
    let client: ReturnType<typeof getSupabaseBrowserClient> | null = null;
    let active = true;
    let channel: ReturnType<
      ReturnType<typeof getSupabaseBrowserClient>["channel"]
    > | null = null;
    try {
      client = getSupabaseBrowserClient();
      channel = client
        .channel(`auction-product:${item.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "products",
            filter: `id=eq.${item.id}`,
          },
          (payload) => {
            const snapshot = parseAuctionProductRealtimeSnapshot(payload.new);
            if (!snapshot || snapshot.id !== item.id) return;
            setAuctionSnapshot({
              antiSnipingBaseClosesAt: snapshot.antiSnipingBaseClosesAt,
              antiSnipingExtendedAt: snapshot.antiSnipingExtendedAt,
              antiSnipingExtensionCount: snapshot.antiSnipingExtensionCount,
              bidLockedAt: snapshot.bidLockedAt,
              closesAt: snapshot.closesAt,
              currentPrice: snapshot.currentPrice,
              finalBidAmount: snapshot.finalBidAmount,
              participantCount: snapshot.participantCount,
              publishAt: snapshot.publishAt,
              status: snapshot.status,
            });
            scheduleAccountBidRefresh();
            scheduleProductRefresh();
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") setRealtimeState("connected");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
            setRealtimeState("reconnecting");
          else if (status === "CLOSED") setRealtimeState("offline");
        });
    } catch {
      channel = null;
      queueMicrotask(() => {
        if (active) setRealtimeState("offline");
      });
    }
    return () => {
      active = false;
      if (channel && client) void client.removeChannel(channel);
    };
  }, [
    item.id,
    item.saleType,
    scheduleAccountBidRefresh,
    scheduleProductRefresh,
  ]);

  useEffect(() => {
    if (!LIVE_AUCTION_ENABLED || item.saleType !== "auction") return;
    const interval = window.setInterval(() => {
      void refreshProductSnapshot();
      if (accountBidsSignedIn) refreshAccountBids();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [
    accountBidsSignedIn,
    item.saleType,
    refreshAccountBids,
    refreshProductSnapshot,
  ]);

  useEffect(
    () => () => {
      if (accountRefreshTimer.current !== null) {
        window.clearTimeout(accountRefreshTimer.current);
        accountRefreshTimer.current = null;
      }
      if (productRefreshTimer.current !== null) {
        window.clearTimeout(productRefreshTimer.current);
        productRefreshTimer.current = null;
      }
    },
    [],
  );

  const addFixedToCart = async () => {
    if (buying) return;
    if (cartContainsItem) {
      pushToast("success", "이미 장바구니에 담긴 상품입니다.", {
        action: { label: "장바구니 바로가기", href: `${basePath}/cart` },
      });
      return;
    }
    setBuying(true);
    setBuyNotice("");
    setBuyNoticeKind("success");
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const session = data.session;
      if (!session?.access_token) {
        rememberFixedPurchaseIntent(item.id, "cart");
        router.push(
          `${basePath}/account/login?next=${encodeURIComponent(`${basePath}/auction/${item.id}?purchaseIntent=cart`)}`,
        );
        return;
      }
      addToCart(item.id);
      await reserveCartProduct(item.id, session.user.id);
      pushToast("success", "장바구니에 상품을 담았습니다.", {
        action: { label: "장바구니 바로가기", href: `${basePath}/cart` },
      });
    } catch (error) {
      removeFromCart(item.id);
      setBuyNoticeKind("error");
      const message =
        error instanceof Error ? error.message : "장바구니에 담지 못했습니다.";
      setBuyNotice(message);
      pushToast("error", `${message} 장바구니 상태를 되돌렸습니다.`);
    } finally {
      setBuying(false);
    }
  };

  const buyNow = async () => {
    if (buying) return;
    const optimisticallyAdded = !cartContainsItem;
    setBuying(true);
    setBuyNotice("");
    setBuyNoticeKind("success");
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const session = data.session;
      if (!session?.access_token) {
        rememberFixedPurchaseIntent(item.id, "buy");
        router.push(
          `${basePath}/account/login?next=${encodeURIComponent(`${basePath}/auction/${item.id}?purchaseIntent=buy`)}`,
        );
        return;
      }
      if (optimisticallyAdded) addToCart(item.id);
      await reserveCartProduct(item.id, session.user.id);
      setBuying(false);
      navigateToFixedCheckout(basePath, item.id, (href) =>
        router.replace(href),
      );
    } catch (error) {
      if (optimisticallyAdded) removeFromCart(item.id);
      setBuyNoticeKind("error");
      setBuyNotice(
        error instanceof Error ? error.message : "구매 준비에 실패했습니다.",
      );
      setBuying(false);
    }
  };
  const updateWishlist = async () => {
    if (wishlistBusy) return;
    const nextLiked = !liked;
    toggleLike(item.id);
    setWishlistBusy(true);
    try {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data
        .session;
      if (session && !(await persistWishlist(item.id, nextLiked, session.user.id))) {
        toggleLike(item.id);
        setBuyNoticeKind("error");
        setBuyNotice("로그인 계정이 변경되었거나 찜을 저장하지 못했습니다.");
        pushToast("error", "찜을 저장하지 못해 이전 상태로 되돌렸습니다.");
      }
    } catch {
      toggleLike(item.id);
      setBuyNoticeKind("error");
      setBuyNotice("로그인 상태를 확인하지 못했습니다.");
      pushToast("error", "찜을 저장하지 못해 이전 상태로 되돌렸습니다.");
    } finally {
      setWishlistBusy(false);
    }
  };

  const visibleBids =
    bidStoreItemId === item.id && bids.length > 0 ? bids : item.bidHistory;
  const activeVisibleBids = visibleBids.filter(
    (bid) => bid.outcome === undefined || bid.outcome === "active",
  );
  const publicBidHistory = visibleBids.map((bid) => ({
    amount: bid.amount,
    bidAt: bid.createdAt,
    bidderName: bid.bidderName,
    id: bid.id,
    outcome: bid.outcome ?? ("active" as const),
  }));
  const activeOptimisticBid =
    optimisticBid && auctionSnapshot.currentPrice < optimisticBid.amount
      ? optimisticBid
      : null;
  const displayPrice =
    item.saleType === "fixed"
      ? (item.fixedPrice ?? item.currentBid)
      : Math.max(auctionSnapshot.currentPrice, activeOptimisticBid?.amount ?? 0);
  const now = policyNow.getTime();
  const dailyAuctionPhase = now > 0 ? getDailyAuctionPhase(now) : "open";
  const phase = getAuctionFeedPhase(
    {
      antiSnipingBaseClosesAt: auctionSnapshot.antiSnipingBaseClosesAt,
      antiSnipingExtendedAt: auctionSnapshot.antiSnipingExtendedAt,
      antiSnipingExtensionCount: auctionSnapshot.antiSnipingExtensionCount,
      bidLockedAt: auctionSnapshot.bidLockedAt,
      closesAt: auctionSnapshot.closesAt,
      publishAt: auctionSnapshot.publishAt,
      status: auctionSnapshot.status,
    },
    now,
    dailyAuctionPhase,
  );
  const timeLeft =
    phase === "CLOSED"
      ? "마감"
      : dailyAuctionPhase === "closed" && phase !== "CLOSING_SOON"
      ? "마감·동기화 점검 중"
        : getAuctionRemainingLabel(auctionSnapshot.closesAt, now);
  const remainingMs = Date.parse(auctionSnapshot.closesAt) - now;
  const isLastMinute =
    phase !== "CLOSED" && remainingMs > 0 && remainingMs < 60_000;
  const participationState = accountBidItems.find(
    (entry) => entry.productId === item.id,
  )?.state;
  const hasVisibleBidHistory =
    Array.isArray(item.bidHistory) && item.bidHistory.length > 0;
  const knownBidCount = hasVisibleBidHistory
    ? activeVisibleBids.length
    : auctionSnapshot.participantCount;
  const { canBid, firstBidExtended, hasParticipated } = getAuctionFeedBidAccess({
    bidCount: knownBidCount,
    bidIncrement: item.bidIncrement,
    currentPrice: displayPrice,
    participationState,
    phase,
  });
  const canStartBid = canBid && canStartAuctionBid(bidCapability);
  const bidButtonLabel =
    phase === "CLOSED"
      ? "경매 마감"
      : phase === "UPCOMING"
        ? "오픈 예정"
        : phase === "CLOSING_SOON"
          ? firstBidExtended
            ? "첫 입찰 · 15분 연장"
            : hasParticipated
              ? "기존 참여자 입찰"
              : "기존 참여자 전용"
          : !canBid
            ? "현재 입찰 불가"
            : bidCapability === "checking"
              ? "입찰 자격 확인 중"
              : bidCapability === "non_member"
                ? "카카오 회원 전용"
                : bidCapability === "unavailable"
                  ? "입찰 자격 확인 불가"
                  : bidCapability === "guest"
                    ? "로그인 후 입찰"
                    : participationState === "outbid"
                      ? "재입찰하기"
                      : "라이브 옥션 입찰하기";
  const conditionLabel = formatConditionGrade(item.conditionGrade);
  const guestCanSignInToBid = canBid && bidCapability === "guest";
  const bidLoginHref = `${basePath}/account/login?next=${encodeURIComponent(`${basePath}/auction/${item.id}/bid`)}`;

  const explainUnavailableBid = () => {
    if (!guestCanSignInToBid) return;
    pushToast("error", "로그인 후 입찰에 참여하실 수 있습니다.", {
      action: { href: bidLoginHref, label: "카카오 로그인" },
      durationMs: 8_000,
    });
  };

  useEffect(() => {
    if (item.saleType !== "auction") return;
    if (previousPhase.current === null) {
      previousPhase.current = phase;
      return;
    }
    if (previousPhase.current !== phase) {
      previousPhase.current = phase;
      scheduleAccountBidRefresh();
    }
  }, [item.saleType, phase, scheduleAccountBidRefresh]);

  const measurementChips = measurementEntries(item.measurements).map(
    (measurement) => [measurement.label, measurement.value] as [string, number],
  );

  return (
    <aside
      className={`${surface === "desktop" ? "p-6 pb-6" : "p-5 pb-32 sm:pb-6"} ${compact ? "sm:top-6" : "sm:top-20 md:top-24"} z-10 h-fit self-start space-y-6 rounded-3xl border border-border bg-card text-card-foreground shadow-xl shadow-black/5 sm:sticky sm:col-span-6 md:col-span-5 lg:col-auto`}
      data-bid-panel="sticky"
    >
      <div className="border-b border-border py-6">
        <p className="mb-3 text-xs font-medium tracking-[0.1em] text-muted-foreground">
          {item.brand}
        </p>
        <h1 className="text-3xl font-black leading-snug tracking-tight text-foreground [text-wrap:balance]">
          {item.name}
        </h1>
        <dl className={`mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border/50 bg-border/50 text-[11px] ${conditionLabel ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          <div className="bg-card px-3 py-3">
            <dt className="text-muted-foreground">카테고리</dt>
            <dd className="mt-1 truncate font-bold">
              {item.category || "미분류"}
            </dd>
          </div>
          <div className="bg-card px-3 py-3">
            <dt className="text-muted-foreground">사이즈</dt>
            <dd className="mt-1 truncate font-bold">
              {item.size || "표기 없음"}
            </dd>
          </div>
          {conditionLabel && <div className="bg-card px-3 py-3">
            <dt className="text-muted-foreground">상태</dt>
            <dd className="mt-1 truncate font-bold" title={conditionLabel}>
              {conditionLabel}
            </dd>
          </div>}
        </dl>
        <p className="mt-5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
          {item.description || "상세 사진과 컨디션 리포트를 확인해 주세요."}
        </p>
        <div
          className={`mt-8 flex items-start gap-3 ${surface === "desktop" ? "flex-row items-end justify-between" : "flex-col"}`}
        >
          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              {item.saleType === "fixed" ? "판매 정가" : "현재 최고 입찰가"}
            </p>
            <p className="flex min-h-9 items-baseline overflow-hidden font-mono text-3xl font-bold tracking-[-0.04em]">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  animate={{ backgroundColor: ["rgba(245,158,11,.28)", "rgba(245,158,11,0)"], opacity: 1, y: 0 }}
                  className="rounded-lg tabular-nums"
                  exit={{ opacity: 0, y: -14 }}
                  initial={{ opacity: 0, y: 14 }}
                  key={displayPrice}
                  transition={{ duration: 0.34, ease: "easeOut" }}
                >
                  {displayPrice.toLocaleString("ko-KR")}
                </motion.span>
              </AnimatePresence>
              <span className="ml-1 text-base">원</span>
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {item.saleType === "fixed"
              ? "즉시 구매 가능"
              : `입찰 ${activeVisibleBids.length}건 · 참여 ${auctionSnapshot.participantCount}명`}
          </p>
        </div>
        {measurementChips.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-foreground">
            {measurementChips.map(([label, value]) => (
              <span
                className="rounded-xl border border-border/50 bg-muted px-3 py-2 shadow-sm"
                key={label}
              >
                {label} {value}cm
              </span>
            ))}
          </div>
        )}
        <button
          className="mt-4 flex h-11 w-full items-center justify-between rounded-2xl border border-border/50 px-4 text-xs font-bold text-foreground shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-foreground hover:shadow-lg active:scale-95"
          onClick={() => setScannerOpen(true)}
          type="button"
        >
          <span className="inline-flex items-center gap-2">
            <Ruler size={14} /> 내 옷과 실측 비교
          </span>
          <span aria-hidden="true">→</span>
        </button>
      </div>

      {LIVE_AUCTION_ENABLED && item.saleType === "auction" && (
        <div
          className={`my-6 rounded-2xl border px-5 py-5 shadow-xl shadow-black/15 transition-colors ${isLastMinute ? "animate-pulse border-red-400/60 bg-red-950 text-white" : "border-border/50 bg-foreground text-background"}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs opacity-75">라이브 옥션 남은 시간</span>
            <span className="inline-flex items-center gap-2 text-[10px] opacity-80">
              <span
                className={`h-2 w-2 rounded-full ${realtimeState === "connected" ? "animate-pulse bg-emerald-400" : realtimeState === "reconnecting" ? "bg-amber-400" : "bg-red-500"}`}
              />
              {realtimeState === "connected"
                ? "실시간 연결"
                : realtimeState === "reconnecting"
                  ? "재연결 중"
                  : "연결 확인 필요"}
            </span>
          </div>
          <p
            className={`mt-3 font-mono text-3xl font-bold tracking-[0.06em] ${isLastMinute ? "text-red-200" : ""}`}
          >
            {timeLeft}
          </p>
          <p className="mt-2 text-[11px] opacity-75">
            21:00–22:00 정산 점검 · 20:56 이후 신규 참여 제한
          </p>
          <p className="mt-2 rounded-xl border border-current/15 bg-current/5 px-3 py-2 text-[11px] opacity-80">
            마감 3분 전 유효 입찰 시 남은 시간이 3분으로 자동 연장됩니다.
          </p>
        </div>
      )}

      {LIVE_AUCTION_ENABLED && item.saleType === "auction" && (
        <div className="border-b border-border/50 pb-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-[0.08em]">
              실시간 입찰 내역
            </h2>
            <button
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground underline"
              onClick={() => setHistoryOpen(true)}
              type="button"
            >
              <List size={11} /> 전체 원장 {visibleBids.length}건
            </button>
          </div>
          <div className="space-y-3 overflow-hidden">
            <AnimatePresence initial={false}>
            {activeOptimisticBid && (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center justify-between rounded-xl bg-amber-500/10 px-2 py-2 text-xs"
                exit={{ opacity: 0, x: 16 }}
                initial={{ opacity: 0, x: -16 }}
                key="my-optimistic-bid"
                layout
              >
                <span className="font-bold text-amber-800">
                  내 입찰 · {activeOptimisticBid.state === "pending" ? "전송 중" : "서버 반영 완료"}
                </span>
                <span className="font-mono font-bold tabular-nums">
                  {activeOptimisticBid.amount.toLocaleString("ko-KR")}원
                </span>
              </motion.div>
            )}
            {activeVisibleBids.slice(0, 5).map((bid) => (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center justify-between text-xs"
                initial={{ opacity: 0, x: -16 }}
                key={bid.id}
                layout
                transition={{ duration: 0.24, ease: "easeOut" }}
              >
                <span className="text-muted-foreground">
                  {bid.bidderMaskedId}{" "}
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    {bid.timeLabel}
                  </span>
                </span>
                <span className="font-mono font-medium">
                  {bid.amount.toLocaleString("ko-KR")}원
                </span>
              </motion.div>
            ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {item.saleType === "auction" ? (
        LIVE_AUCTION_ENABLED ? (
          <>
            {canStartBid ? (
              <Link
                aria-describedby="auction-settlement-summary"
                className={`${surface === "mobile" ? "hidden lg:flex" : "flex"} mt-6 h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-lg shadow-black/10 transition-all duration-300 hover:-translate-y-1 hover:bg-primary/90 hover:shadow-xl active:scale-95`}
                href={`${basePath}/auction/${item.id}/bid`}
              >
                <LockKeyhole size={15} /> {bidButtonLabel}
              </Link>
            ) : (
              <button
                aria-describedby="auction-settlement-summary"
                className={`${surface === "mobile" ? "hidden lg:flex" : "flex"} mt-6 h-14 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold ${guestCanSignInToBid ? "bg-primary text-primary-foreground shadow-lg shadow-black/10 transition-all duration-300 hover:-translate-y-1 hover:bg-primary/90 hover:shadow-xl active:scale-95" : "cursor-not-allowed bg-muted text-muted-foreground"}`}
                disabled={!guestCanSignInToBid}
                onClick={explainUnavailableBid}
                type="button"
              >
                <LockKeyhole size={15} /> {bidButtonLabel}
              </button>
            )}
            {surface === "mobile" && (
              <MobileBidBar
                actionHref={
                  canStartBid ? `${basePath}/auction/${item.id}/bid` : undefined
                }
                actionLabel={bidButtonLabel}
                currentBid={displayPrice}
                disabled={!canStartBid && !guestCanSignInToBid}
                onAction={guestCanSignInToBid ? explainUnavailableBid : undefined}
                remainingTime={timeLeft}
              />
            )}
            <p
              className="mt-3 text-[11px] leading-5 text-muted-foreground"
              id="auction-settlement-summary"
            >
              낙찰 후 서버가 확정한 결제 마감까지 입금 · 미결제 시 낙찰
              취소·경고 및 차순위 전환
            </p>
            {phase === "CLOSING_SOON" && (
              <p className="mt-2 text-[11px] font-bold leading-5 text-amber-700">
                {firstBidExtended
                  ? "무입찰 상품의 첫 입찰은 마감이 15분 연장되며 경매가 계속됩니다."
                  : hasParticipated
                    ? "마감 직전에는 기존 참여자만 추가 입찰할 수 있습니다."
                    : "신규 참여가 마감되었습니다. 기존 참여자만 입찰할 수 있습니다."}
              </p>
            )}
            {bidCapability === "non_member" && (
              <p className="mt-2 text-[11px] font-bold leading-5 text-amber-700">
                현재 로그인한 계정은 경매 입찰용 회원 계정이 아닙니다.
              </p>
            )}
          </>
        ) : (
          <div className="mt-6 rounded-2xl border border-border/50 bg-muted p-4 text-xs leading-5 text-muted-foreground shadow-sm">
            실시간 경매는 현재 점검 중입니다. 즉시 구매 상품은 정상적으로 이용할
            수 있습니다.
          </div>
        )
      ) : (
        <>
          <div className="mt-6 break-keep rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs leading-5 text-foreground sm:p-4">
            <strong className="block">14일 무료 보관함</strong>
            <span className="mt-1 block break-keep text-muted-foreground">
              결제 후 같은 센터 상품과 묶음 배송을 신청할 수 있습니다. 단 1점
              고유 재고 상품입니다.
            </span>
          </div>
          <div
            className={`${surface === "mobile" ? "mobile-detail-cta" : ""} mt-4 grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)] gap-2`}
          >
            <button
              aria-label={liked ? "찜 해제" : "찜하기"}
              aria-pressed={liked}
              className="flex h-14 min-w-11 items-center justify-center rounded-2xl border border-border text-foreground shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-foreground hover:shadow-lg active:scale-95"
              disabled={wishlistBusy}
              onClick={() => void updateWishlist()}
              type="button"
            >
              <Heart fill={liked ? "currentColor" : "none"} size={18} />
            </button>
            <button
              className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-border text-sm font-bold text-foreground shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-foreground hover:shadow-lg active:scale-95 disabled:opacity-50"
              disabled={buying}
              onClick={() => void addFixedToCart()}
              type="button"
            >
              <ShoppingBag size={15} /> <span className="truncate">장바구니 담기</span>
            </button>
            <button
              className="flex h-14 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-lg shadow-black/10 transition-all duration-300 hover:-translate-y-1 hover:bg-primary/90 hover:shadow-xl active:scale-95 disabled:opacity-50"
              disabled={buying}
              onClick={() => void buyNow()}
              type="button"
            >
              {buying ? "구매 준비 중..." : "즉시 소장하기"}
            </button>
          </div>
        </>
      )}
      {buyNotice && (
        <p
          aria-live="polite"
          className={`mt-3 text-xs font-bold ${
            buyNoticeKind === "error" ? "text-red-600" : "text-emerald-700"
          }`}
          role={buyNoticeKind === "error" ? "alert" : undefined}
        >
          {buyNotice}
        </p>
      )}
      {item.saleType === "auction" && (
        <button
          className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border/50 text-xs font-bold text-foreground shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-foreground hover:shadow-lg active:scale-95 disabled:opacity-50"
          disabled={wishlistBusy}
          onClick={() => void updateWishlist()}
          type="button"
        >
          <Heart fill={liked ? "currentColor" : "none"} size={15} />{" "}
          {liked ? "찜 해제" : "관심 상품 담기"}
        </button>
      )}
      <button
        className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border/50 text-xs font-bold text-foreground shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-foreground hover:shadow-lg active:scale-95 disabled:opacity-50"
        onClick={() => setInquiryOpen(true)}
        type="button"
      >
        <MessageCircle size={15} /> 상품 문의하기
      </button>
      <ShareProductButton
        className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border/50 text-xs font-bold text-foreground shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-foreground hover:shadow-lg active:scale-95"
        label="공유하기"
        priceText={`${item.saleType === "fixed" ? "판매 정가" : "현재 최고 입찰가"} ${displayPrice.toLocaleString("ko-KR")}원`}
        title={`${item.name} | ${item.brand}`}
        url={`/auction/${item.id}`}
      />
      {LIVE_AUCTION_ENABLED &&
        item.saleType === "auction" &&
        participationState === "final" && (
          <SettlementActions
            basePath={surface === "mobile" ? "/m" : ""}
            productId={item.id}
          />
        )}
      {LIVE_AUCTION_ENABLED && item.saleType === "auction" && (
        <AuctionBidHistoryModal
          history={publicBidHistory}
          itemTitle={item.name}
          onClose={() => setHistoryOpen(false)}
          open={historyOpen}
        />
      )}
      <ProductInquiryModal
        basePath={basePath}
        onClose={() => setInquiryOpen(false)}
        open={inquiryOpen}
        productId={item.id}
        productTitle={item.name}
      />
      <SizeComparisonScanner
        itemMeasurements={item.measurements}
        onClose={() => setScannerOpen(false)}
        open={scannerOpen}
        productDescription={item.description}
        productSize={item.size ?? ""}
        productTitle={item.name}
        userId={session?.user.id}
      />
    </aside>
  );
}
