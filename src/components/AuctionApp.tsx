"use client";

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  AuctionClock,
  Button,
  type NavigationTarget,
} from "@/src/components/common";
import { Toast } from "@/src/components/common/Toast";
import CommerceScheduleBanner from "@/src/components/commerce/CommerceScheduleBanner";
import type { NewAuctionDraft } from "@/src/components/feed/NewAuctionModal";
import { useAuthSession } from "@/src/hooks/useAuthSession";
import { notifyMemberAccountChanged } from "@/src/lib/memberAccountEvents";
import { useOnlineMembers } from "@/src/hooks/useOnlineMembers";
import { useSupabaseProducts } from "@/src/hooks/useSupabaseProducts";
import {
  canAccessOperationsCenter,
  canManageProducts,
  getPublicRoleLabel,
  isMemberRole,
  isOwnerRole,
  isStaffRole,
  type AppRole,
} from "@/src/lib/supabase/auth";
import type { SupportViewerRole } from "@/src/lib/supabase/supportChat";
import type { createProductsBatch as CreateProductsBatch } from "@/src/lib/supabase/products";
import type { AuctionPost } from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";
import { WorkspaceFrame } from "@/src/components/commerce/WorkspaceFrame";

const AdminAccessGate = lazy(() =>
  import("@/src/components/admin/AdminAccessGate").then((module) => ({
    default: module.AdminAccessGate,
  })),
);
const AdminPage = lazy(() =>
  import("@/src/components/admin/AdminPage").then((module) => ({
    default: module.AdminPage,
  })),
);
const BulkAuctionImportModal = lazy(
  () => import("@/src/components/admin/BulkAuctionImportModal"),
);
const ShippingWorkPanel = lazy(() =>
  import("@/src/components/admin/ShippingWorkPanel").then((module) => ({
    default: module.ShippingWorkPanel,
  })),
);
const AuthModal = lazy(() => import("@/src/components/auth/AuthModal"));
const ChatPage = lazy(() =>
  import("@/src/components/chat/ChatPage").then((module) => ({
    default: module.ChatPage,
  })),
);
const FloatingAdminChat = lazy(() =>
  import("@/src/components/chat/FloatingAdminChat").then((module) => ({
    default: module.FloatingAdminChat,
  })),
);
const FeedList = lazy(() => import("@/src/components/feed/FeedList"));
const HomeLandingPage = lazy(() =>
  import("@/src/components/home/HomeLandingPage").then((module) => ({
    default: module.HomeLandingPage,
  })),
);
const EditorialCatalogSidebar = lazy(() => import("@/src/components/feed/EditorialCatalogSidebar").then((module) => ({ default: module.EditorialCatalogSidebar })));
const NewAuctionModal = lazy(
  () => import("@/src/components/feed/NewAuctionModal"),
);
const ShopPage = lazy(() => import("@/src/components/shop/ShopPage"));
const AuctionOverviewSidebar = lazy(
  () => import("@/src/components/live/AuctionOverviewSidebar"),
);
const LiveBidSidebar = lazy(
  () => import("@/src/components/live/LiveBidSidebar"),
);
const OnlineMembersSidebar = lazy(
  () => import("@/src/components/live/OnlineMembersSidebar"),
);
const AccountPage = lazy(() =>
  import("@/src/components/profile/AccountPage").then((module) => ({
    default: module.AccountPage,
  })),
);
const SecondChanceOfferGate = lazy(
  () => import("@/src/components/payment/SecondChanceOfferGate"),
);
const NicknameOnboardingModal = lazy(() =>
  import("@/src/components/profile/NicknameOnboardingModal").then((module) => ({
    default: module.NicknameOnboardingModal,
  })),
);

const NAVIGATION_PATHS: Record<NavigationTarget, string> = {
  feed: "/feed",
  chat: "/chat",
  profile: "/account",
  admin: "/operator",
};

type AuctionAppPage = NavigationTarget | "home" | "shop";

export interface AuctionAppProps {
  page?: AuctionAppPage;
}

function toSupportRole(role: AppRole): SupportViewerRole | null {
  if (isMemberRole(role)) return "member";
  // The private owner account participates in ordinary support work only as an
  // operator. Cross-operator review lives exclusively on the gated owner page.
  if (role === "admin") return "operator";
  if (role === "employee" || role === "operator") return role;
  return null;
}

export function AuctionApp({ page: activePage = "home" }: AuctionAppProps) {
  const [authOpen, setAuthOpen] = useState(false);
  const [newAuctionOpen, setNewAuctionOpen] = useState(false);
  const [bulkAuctionOpen, setBulkAuctionOpen] = useState(false);
  const [operationsRevision, setOperationsRevision] = useState(0);
  const [toastMessage, setToastMessage] = useState("");

  const auth = useAuthSession();
  const displayName = auth.profile?.displayName ?? "";
  const publicDisplayName = isOwnerRole(auth.role) ? "" : displayName;
  const isMember = Boolean(auth.user) && isMemberRole(auth.role);
  const isHomePage = activePage === "home";
  const isFeedPage = activePage === "feed";
  const isShopPage = activePage === "shop";
  const isProductSurface = isHomePage || isFeedPage;
  // The v2 catalog owns its filtering and status surface. The former left/right
  // rails remain intentionally disabled so the product canvas uses the full PC width.
  const showDesktopRails = false;
  // The public feed includes authenticated members and ephemeral guest
  // Presence identities. Private owner/employee accounts remain absent from
  // the directory inside useOnlineMembers.
  const showOnlineMembers = isFeedPage;
  const operationsRole = isOwnerRole(auth.role) ? "admin" : "operator";

  const {
    members: onlineMembers,
    totalCount: onlineMemberCount,
    hasMore: hasMoreOnlineMembers,
    status: onlineMembersStatus,
    error: onlineMembersError,
  } = useOnlineMembers({
    enabled: isFeedPage && !auth.isLoading && showOnlineMembers,
    userId: auth.user?.id ?? null,
    role: auth.user ? auth.role : null,
  });
  const {
    posts,
    setPosts,
    isLoading: productsLoading,
    hasMoreProducts,
    isLoadingMore: productsLoadingMore,
    error: productsError,
    refreshProducts,
    loadMoreProducts,
  } = useSupabaseProducts({ enabled: isProductSurface });
  const {
    posts: fixedPricePosts,
    setPosts: setFixedPricePosts,
    isLoading: fixedPriceProductsLoading,
    hasMoreProducts: hasMoreFixedPriceProducts,
    isLoadingMore: fixedPriceProductsLoadingMore,
    error: fixedPriceProductsError,
    refreshProducts: refreshFixedPriceProducts,
    loadMoreProducts: loadMoreFixedPriceProducts,
  } = useSupabaseProducts({
    enabled: isShopPage,
    saleType: "fixed",
  });

  const showToast = useCallback((message: string) => {
    setToastMessage("");
    window.setTimeout(() => setToastMessage(message), 0);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3_800);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const openAuthentication = useCallback(() => {
    setAuthOpen(true);
  }, []);

  const navigateToPage = useCallback((target: NavigationTarget) => {
    const nextPath = NAVIGATION_PATHS[target];
    const currentPath = window.location.pathname;
    if (currentPath !== nextPath) {
      window.location.assign(nextPath);
    }
  }, []);

  const requireMember = useCallback(() => {
    if (auth.user && isMemberRole(auth.role)) return auth.user;

    if (auth.user) {
      throw new Error(
        isStaffRole(auth.role)
          ? "운영 스태프 계정은 입찰이나 회원 문의를 보낼 수 없습니다."
          : "이 로그인 방식에는 회원 권한이 없습니다. 로그아웃 후 카카오로 다시 로그인해 주세요.",
      );
    }

    openAuthentication();
    throw new Error("입찰과 상품 문의는 카카오 회원 로그인 후 이용할 수 있어요.");
  }, [auth.role, auth.user, openAuthentication]);

  const handleBid = async (postId: string, amount: number) => {
    requireMember();

    try {
      const { placeBid } = await import("@/src/lib/supabase/bids");
      const result = await placeBid(postId, amount);
      await refreshProducts();
      showToast(
        result.isFinal
          ? `${formatKRW(result.amount)} 입찰이 즉시 확정되었습니다.`
          : `${formatKRW(result.amount)}으로 입찰했습니다.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "입찰을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      showToast(message);
      throw error;
    }
  };

  const handleProductInquiry = async (postId: string, message: string) => {
    requireMember();
    const post = posts.find((item) => item.id === postId);
    if (!post) throw new Error("문의할 상품을 찾지 못했습니다.");

    const { startProductInquiry } = await import(
      "@/src/lib/supabase/supportChat"
    );
    await startProductInquiry(postId, message);
    showToast("운영팀에 상품 문의를 전송했습니다.");
  };

  const handleDeleteFeedProduct = async (post: AuctionPost) => {
    if (!canAccessOperationsCenter(auth.role)) {
      throw new Error("운영자 권한을 확인하지 못했습니다.");
    }
    if (!post.updatedAt) {
      throw new Error(
        "상품의 최신 수정 시각이 없어 안전하게 삭제할 수 없습니다. 피드를 새로고침해 주세요.",
      );
    }

    const { deleteManagedProduct } = await import(
      "@/src/lib/supabase/products"
    );
    await deleteManagedProduct(post.id, post.updatedAt);
    setPosts((current) => current.filter((item) => item.id !== post.id));
    setOperationsRevision((current) => current + 1);
    showToast(`${post.title} 상품을 삭제했습니다.`);
  };

  const handleCreateAuction = async (draft: NewAuctionDraft) => {
    if (!canManageProducts(auth.role)) {
      openAuthentication();
      throw new Error("상품 업무 권한이 있는 운영 스태프로 로그인해 주세요.");
    }

    const { createProduct } = await import("@/src/lib/supabase/products");
    await createProduct(draft);
    if (draft.saleType === "fixed") {
      await refreshFixedPriceProducts();
    } else {
      await refreshProducts();
    }
    setOperationsRevision((current) => current + 1);
    if (draft.status === "active") {
      if (draft.saleType === "fixed") {
        window.location.assign("/shop");
      } else {
        navigateToPage("feed");
      }
    }
    showToast(
      draft.status === "pending"
        ? `${draft.saleType === "fixed" ? "정가 상품" : "새 경매글"}을 가장 가까운 오전 10시 공개로 예약했습니다.`
        : `${draft.saleType === "fixed" ? "정가 상품" : "새 경매글"}을 즉시 공개했습니다.`,
    );
  };

  const handleBuyNow = async (post: AuctionPost) => {
    requireMember();
    if (post.saleType !== "fixed" || !post.fixedPrice) {
      throw new Error("바로 구매할 수 있는 정가 상품이 아닙니다.");
    }

    try {
      const { claimFixedPriceProduct } = await import(
        "@/src/lib/supabase/products"
      );
      await claimFixedPriceProduct(post.id);
      setFixedPricePosts((current) =>
        current.filter((item) => item.id !== post.id),
      );
      showToast(`${post.title} 구매가 확정되었습니다. 결제를 진행해 주세요.`);
      window.location.assign("/account#payment");
    } catch (error) {
      await refreshFixedPriceProducts();
      const message =
        error instanceof Error
          ? error.message
          : "구매를 확정하지 못했습니다. 상품 상태를 다시 확인해 주세요.";
      showToast(message);
      throw error;
    }
  };

  const handleCreateAuctionsBatch = async (
    drafts: NewAuctionDraft[],
    onProgress: Parameters<typeof CreateProductsBatch>[1],
  ) => {
    if (!canManageProducts(auth.role)) {
      openAuthentication();
      throw new Error("상품 업무 권한이 있는 운영 스태프로 로그인해 주세요.");
    }

    const { createProductsBatch } = await import(
      "@/src/lib/supabase/products"
    );
    await createProductsBatch(drafts, onProgress);
    const containsAuctionProducts = drafts.some(
      (draft) => draft.saleType !== "fixed",
    );
    const containsFixedProducts = drafts.some(
      (draft) => draft.saleType === "fixed",
    );
    await Promise.all([
      containsAuctionProducts ? refreshProducts() : Promise.resolve(),
      containsFixedProducts
        ? refreshFixedPriceProducts()
        : Promise.resolve(),
    ]);
    setOperationsRevision((current) => current + 1);
    showToast(
      `${drafts.length.toLocaleString("ko-KR")}개 상품을 일괄 등록했습니다.`,
    );
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      setNewAuctionOpen(false);
      setBulkAuctionOpen(false);
      showToast("로그아웃했습니다.");
      navigateToPage("feed");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "로그아웃하지 못했습니다.");
    }
  };

  const renderPage = () => {
    if (activePage === "home") {
      return (
        <Suspense fallback={<RouteLoadingFallback />}>
          <HomeLandingPage
            posts={posts}
            isLoading={productsLoading}
            onSignIn={openAuthentication}
            isAuthenticated={Boolean(auth.user)}
          />
        </Suspense>
      );
    }

    if (activePage === "shop") {
      return (
        <ShopPage
          posts={fixedPricePosts}
          isLoading={fixedPriceProductsLoading}
          error={fixedPriceProductsError}
          onRetry={refreshFixedPriceProducts}
          hasMoreProducts={hasMoreFixedPriceProducts}
          isLoadingMore={fixedPriceProductsLoadingMore}
          onLoadMore={loadMoreFixedPriceProducts}
          onBuyNow={handleBuyNow}
        />
      );
    }

    if (activePage === "chat") {
      return (
        <WorkspaceFrame
          eyebrow="PRIVATE SUPPORT / REALTIME"
          title="상담 센터"
          description="상품 문의와 결제·배송 관련 대화를 담당 운영자와 안전하게 이어갈 수 있습니다. 모든 대화는 권한에 맞게 분리됩니다."
        >
          <ChatPage
            userId={auth.user?.id ?? null}
            role={auth.user ? toSupportRole(auth.role) : null}
            onRequestSignIn={openAuthentication}
          />
        </WorkspaceFrame>
      );
    }

    if (activePage === "profile") {
      if (auth.user && isStaffRole(auth.role)) {
        return (
          <WorkspaceFrame
            eyebrow="STAFF / ACCOUNT"
            title="업무 계정"
            description="운영 업무와 계정 세션을 안전하게 관리합니다."
          ><StaffAccountPage
            role={auth.role}
            displayName={publicDisplayName}
            onOpenWorkspace={() => navigateToPage("admin")}
            onSignOut={handleSignOut}
          /></WorkspaceFrame>
        );
      }

        return (
          <WorkspaceFrame
            eyebrow="MY NINETY-NINE"
            title="내 컬렉션과 주문"
            description="낙찰·구매 확정 상품의 결제와 배송, 보관함과 프로필을 한 곳에서 관리합니다."
          ><AccountPage
            userId={auth.user?.id}
            displayName={publicDisplayName}
            avatarUrl={auth.profile?.avatarUrl}
          email={auth.user?.email}
          role="user"
          onSignIn={openAuthentication}
            onSignOut={handleSignOut}
            onProfileRefresh={auth.refreshProfile}
          /></WorkspaceFrame>
        );
      }

    if (activePage === "admin") {
      if (canAccessOperationsCenter(auth.role)) {
        return (
          <WorkspaceFrame
            eyebrow="OPERATIONS / LIVE"
            title="운영 워크스페이스"
            description="상품 등록부터 배송·입금·회원 관리를 하나의 업무 흐름으로 처리합니다."
          ><AdminPage
            key={`${operationsRevision}-${operationsRole}`}
            role={operationsRole}
            onCreateProduct={() => setNewAuctionOpen(true)}
            onOpenBulkImport={() => setBulkAuctionOpen(true)}
            onProductsChanged={refreshProducts}
            onNotify={showToast}
          /></WorkspaceFrame>
        );
      }

      if (auth.role === "employee") {
        return (
          <WorkspaceFrame
            eyebrow="STAFF / OPERATIONS"
            title="업무 작업대"
            description="등록과 배송 대기 업무를 처리하는 직원 전용 화면입니다."
          ><EmployeeOperationsPage
            onCreateProduct={() => setNewAuctionOpen(true)}
            onOpenBulkImport={() => setBulkAuctionOpen(true)}
          /></WorkspaceFrame>
        );
      }

      return (
        <AdminAccessGate onSwitchToStaff={openAuthentication} />
      );
    }

    return (
      <main className="mx-auto w-full max-w-[1760px] px-10 pb-24 pt-7">
        <div className="min-w-0">
          {showOnlineMembers && showDesktopRails ? (
            <OnlineMembersSidebar
              members={onlineMembers}
              totalCount={onlineMemberCount}
              hasMore={hasMoreOnlineMembers}
              status={onlineMembersStatus}
              error={onlineMembersError}
              className="hidden min-[1200px]:block"
            />
          ) : null}

          <div className="min-w-0">
            <AuctionClock
              antiSnipingDeadlines={posts
                .filter(
                  (post) =>
                    post.status === "active" &&
                    (post.antiSnipingExtensionCount ?? 0) > 0,
                )
                .map((post) => post.closesAt)}
            />

            <CommerceScheduleBanner compact className="mb-4 mt-3" />

            {showOnlineMembers ? (
              <section
                aria-label="현재 온라인 사용자 요약"
                className="nn-surface mt-3 flex min-h-11 items-center gap-2 overflow-hidden px-4 py-2"
              >
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold tracking-tight text-[var(--success-text)]">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-[#2f9e5b] shadow-[0_0_0_3px_rgba(47,158,91,0.12)]"
                  />
                  LIVE <span className="font-mono tabular-nums">{onlineMemberCount}</span>명
                </span>
                <span
                  aria-hidden="true"
                  className="h-4 w-px shrink-0 bg-[var(--border)]"
                />
                <span className="truncate text-xs font-medium text-[var(--text-muted)] sm:text-sm">
                  {onlineMembersStatus === "connecting"
                    ? "접속 상태 확인 중"
                    : onlineMembersStatus === "error"
                      ? "접속 상태를 확인할 수 없어요"
                      : onlineMembers.length > 0
                        ? onlineMembers
                            .slice(0, 4)
                            .map((member) =>
                              member.isOperator
                                ? `운영자 ${member.displayName}`
                                : member.displayName,
                            )
                            .join(" · ")
                        : "현재 접속 중인 사용자가 없습니다"}
                </span>
              </section>
            ) : null}

            {isFeedPage && showDesktopRails ? (
              <div className="grid items-start gap-4 lg:grid-cols-[188px_minmax(0,1fr)]">
                <Suspense fallback={null}><EditorialCatalogSidebar /></Suspense>
                <FeedList
                  posts={posts}
                  currentUserName={publicDisplayName}
                  currentUserId={isMember ? auth.user?.id : null}
                  onBid={handleBid}
                  onInquiry={handleProductInquiry}
                  isLoading={productsLoading}
                  hasMoreProducts={hasMoreProducts}
                  isLoadingMore={productsLoadingMore}
                  loadError={productsError}
                  onRetry={refreshProducts}
                  onLoadMore={loadMoreProducts}
                  showOperatorControls={canAccessOperationsCenter(auth.role)}
                  onDeleteProduct={handleDeleteFeedProduct}
                  description="오후 8시 56분 이후 무입찰 첫 건은 즉시 확정되며, 오후 9시 정산 후 미판매 상품은 오후 10시에 다시 열립니다."
                />
              </div>
            ) : (
              <FeedList
                posts={posts}
                currentUserName={publicDisplayName}
                currentUserId={isMember ? auth.user?.id : null}
                onBid={handleBid}
                onInquiry={handleProductInquiry}
                isLoading={productsLoading}
                hasMoreProducts={hasMoreProducts}
                isLoadingMore={productsLoadingMore}
                loadError={productsError}
                onRetry={refreshProducts}
                onLoadMore={loadMoreProducts}
                showOperatorControls={canAccessOperationsCenter(auth.role)}
                onDeleteProduct={handleDeleteFeedProduct}
                description="오후 8시 56분 이후 무입찰 첫 건은 즉시 확정되며, 오후 9시 정산 후 미판매 상품은 오후 10시에 다시 열립니다."
              />
            )}
          </div>

          {showDesktopRails && isMember ? (
            <LiveBidSidebar
              posts={posts}
              currentUserName={publicDisplayName}
              onBid={handleBid}
              className="hidden min-[1200px]:block"
            />
          ) : showDesktopRails && auth.user && isStaffRole(auth.role) ? (
            <AuctionOverviewSidebar
              posts={posts}
              className="hidden min-[1200px]:block"
            />
          ) : showDesktopRails ? (
            <aside className="theme-panel sticky top-24 hidden overflow-hidden rounded-2xl border shadow-sm min-[1200px]:block">
              <div className="border-b border-[var(--border)] px-4 py-3 text-left">
                <p className="text-[10px] font-bold tracking-[0.18em] text-[var(--text-muted)]">MY AUCTIONS</p>
                <p className="mt-1 text-sm font-semibold text-[var(--text-strong)]">내 입찰 현황</p>
              </div>
              <div className="px-4 py-6 text-center">
                <span aria-hidden="true" className="mx-auto grid size-10 place-items-center rounded-full border border-[var(--border)] text-[var(--text-muted)]">↗</span>
                <p className="mt-3 break-keep text-xs font-medium leading-5 text-[var(--text-muted)]">
                카카오 회원으로 로그인하면 참여 중인 상품을 실시간으로 확인할 수 있어요.
                </p>
              {!auth.user ? (
                <button
                  type="button"
                  onClick={openAuthentication}
                  className="mt-4 min-h-10 w-full rounded-lg bg-[#fee500] px-4 text-xs font-bold text-[#191919] shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#191919]/30"
                >
                  카카오 로그인
                </button>
              ) : null}
              </div>
            </aside>
          ) : null}
        </div>
      </main>
    );
  };

  if (auth.isNetworkBlocked) {
    return <NetworkBlockedPage />;
  }

  return (
    <div className="theme-app-shell relative min-h-screen overflow-x-clip">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.32] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_38%)]"
      />

      <div key={activePage} className="animate-fade-in-up relative">
        <Suspense fallback={<RouteLoadingFallback />}>{renderPage()}</Suspense>
      </div>

      {newAuctionOpen && canManageProducts(auth.role) ? (
        <Suspense fallback={null}>
          <NewAuctionModal
            open
            onClose={() => setNewAuctionOpen(false)}
            onSubmit={handleCreateAuction}
          />
        </Suspense>
      ) : null}

      {bulkAuctionOpen && canManageProducts(auth.role) ? (
        <Suspense fallback={null}>
          <BulkAuctionImportModal
            open
            onClose={() => setBulkAuctionOpen(false)}
            onSubmit={handleCreateAuctionsBatch}
          />
        </Suspense>
      ) : null}

      {authOpen ? (
        <Suspense fallback={null}>
          <AuthModal open onClose={() => setAuthOpen(false)} />
        </Suspense>
      ) : null}

      {auth.user && isMemberRole(auth.role) ? (
        <Suspense fallback={null}>
          <NicknameOnboardingModal
            enabled
            userId={auth.user.id}
            onCompleted={auth.refreshProfile}
            onSignOut={handleSignOut}
          />
        </Suspense>
      ) : null}

      {auth.user && isMemberRole(auth.role) ? (
        <Suspense fallback={null}>
          <SecondChanceOfferGate
            userId={auth.user.id}
            paymentDeadlineExempt={auth.role === "band_member"}
            onNotify={showToast}
            onAccepted={(productId) => {
              const memberId = auth.user?.id;
              if (!memberId) return;
              notifyMemberAccountChanged(memberId, productId);
              navigateToPage("profile");
            }}
          />
        </Suspense>
      ) : null}

      {isMember && activePage !== "chat" ? (
        <Suspense fallback={null}>
          <FloatingAdminChat
            userId={auth.user?.id ?? null}
            role={auth.user ? toSupportRole(auth.role) : null}
          />
        </Suspense>
      ) : null}

      <Toast
        message={toastMessage}
        visible={Boolean(toastMessage)}
        onDismiss={() => setToastMessage("")}
      />
    </div>
  );
}

function RouteLoadingFallback() {
  return (
    <main
      className="mx-auto w-full max-w-[1680px] px-3 py-6 sm:px-5 lg:px-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">화면을 불러오는 중…</span>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_272px]">
        <div className="space-y-4">
          <div className="theme-panel overflow-hidden rounded-2xl border p-4">
            <div className="commerce-skeleton h-3 w-28 rounded" />
            <div className="commerce-skeleton mt-3 h-7 w-2/3 rounded" />
            <div className="commerce-skeleton mt-5 aspect-[16/6] w-full rounded-xl" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="theme-panel overflow-hidden rounded-xl border p-2.5">
                <div className="commerce-skeleton aspect-[3/4] w-full rounded-lg" />
                <div className="commerce-skeleton mt-3 h-3 w-3/4 rounded" />
                <div className="commerce-skeleton mt-2 h-4 w-1/2 rounded" />
              </div>
            ))}
          </div>
        </div>
        <div className="theme-panel hidden h-72 rounded-2xl border p-4 lg:block">
          <div className="commerce-skeleton h-3 w-24 rounded" />
          <div className="commerce-skeleton mt-5 h-12 w-full rounded-lg" />
          <div className="commerce-skeleton mt-2 h-12 w-full rounded-lg" />
          <div className="commerce-skeleton mt-2 h-12 w-full rounded-lg" />
        </div>
      </div>
    </main>
  );
}

function NetworkBlockedPage() {
  return (
    <main className="theme-app-shell grid min-h-[75dvh] place-items-center px-4 py-12">
      <section className="theme-panel w-full max-w-xl rounded-2xl border p-7 text-center shadow-[0_24px_70px_rgba(15,23,42,0.09)] sm:p-9">
        <span
          aria-hidden="true"
          className="mx-auto grid size-12 place-items-center rounded-xl border border-[var(--danger-text)]/20 bg-[var(--danger-surface)] text-lg font-bold text-[var(--danger-text)]"
        >
          !
        </span>
        <p className="mt-5 text-[10px] font-bold tracking-[0.2em] text-[var(--danger-text)]">ACCESS RESTRICTED</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text-strong)]">
          보안 정책에 따라 접속이 제한되었습니다
        </h1>
        <p className="mt-3 break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">
          비정상 접속이나 오남용 방지를 위해 현재 네트워크 세션이 차단되었습니다.
          잘못 차단되었다면 고객센터에 차단 시각과 함께 해제를 요청해 주세요.
        </p>
        <a
          href="/privacy"
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 text-sm font-semibold text-[var(--text-strong)] transition-all duration-200 ease-out hover:scale-[1.02] hover:border-[var(--text-muted)] hover:shadow-sm"
        >
          개인정보처리방침 확인
        </a>
      </section>
    </main>
  );
}

function StaffAccountPage({
  role,
  displayName,
  onOpenWorkspace,
  onSignOut,
}: {
  role: AppRole;
  displayName: string;
  onOpenWorkspace: () => void;
  onSignOut: () => void | Promise<void>;
}) {
  const roleLabel = getPublicRoleLabel(role);
  const safeDisplayName = isOwnerRole(role) ? "" : displayName.trim();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-28 pt-8 sm:px-6 lg:pb-12">
      <section className="theme-panel overflow-hidden rounded-2xl border shadow-[0_22px_60px_rgba(15,23,42,0.07)]">
        <div className="border-b border-[var(--border)] bg-[var(--surface-raised)] px-6 py-7 sm:px-9">
          <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--accent-text)]">
            OPERATIONS ACCOUNT
          </p>
          <div className="mt-4 flex items-center gap-4">
            <span
              aria-hidden="true"
              className="grid size-12 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm font-bold text-[var(--accent-text)] shadow-sm"
            >
              운영
            </span>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-[var(--text-strong)]">
                {safeDisplayName || "운영 계정"}
              </h2>
              <span className="mt-1 inline-flex rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-semibold text-[var(--success-text)]">
                {roleLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="px-6 py-6 sm:px-9">
          <p className="break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">
            운영 계정의 로그인 주소와 내부 식별 정보는 공개 화면에 표시하지 않습니다.
            허용된 업무는 서버 역할 정책으로 확인합니다.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onOpenWorkspace}>
              {role === "employee" ? "업무 도구 열기" : "운영 센터 열기"}
            </Button>
            <Button variant="ghost" onClick={() => void onSignOut()}>
              로그아웃
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function EmployeeOperationsPage({
  onCreateProduct,
  onOpenBulkImport,
}: {
  onCreateProduct: () => void;
  onOpenBulkImport: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-8 sm:px-6 lg:pb-12">
      <header className="mb-7 border-b border-[var(--border)] pb-5">
        <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--info-text)]">
          EMPLOYEE WORKSPACE
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--text-strong)]">
            직원 업무 도구
          </h1>
          <span className="rounded-md border border-[var(--border)] bg-[var(--info-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--info-text)]">
            직원
          </span>
        </div>
        <p className="mt-3 max-w-3xl break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">
          상품 등록과 배송 대기 처리에 필요한 권한만 사용할 수 있습니다. 회원 관리와
          상담함은 이 계정에 노출되지 않습니다.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="theme-panel rounded-2xl border p-6 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md">
          <p className="text-[10px] font-bold tracking-[0.18em] text-[var(--accent-text)]">
            BULK REGISTRATION
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-[var(--text-strong)]">
            상품 일괄 등록
          </h2>
          <p className="mt-2 break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">
            Excel 상품 정보와 이미지 폴더를 검토한 뒤 여러 경매글을 등록합니다.
          </p>
          <Button className="mt-5" onClick={onOpenBulkImport}>
            일괄 등록 열기
          </Button>
        </section>

        <section className="theme-panel rounded-2xl border p-6 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md">
          <p className="text-[10px] font-bold tracking-[0.18em] text-[var(--info-text)]">
            SINGLE REGISTRATION
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-[var(--text-strong)]">
            상품 개별 등록
          </h2>
          <p className="mt-2 break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">
            예외 상품 한 건의 사진·설명·공개 시각을 확인해 등록합니다.
          </p>
          <Button
            className="mt-5"
            variant="secondary"
            onClick={onCreateProduct}
          >
            상품 1건 등록
          </Button>
        </section>
      </div>

      <section className="theme-panel mt-4 rounded-2xl border p-5 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold tracking-tight text-[var(--text-strong)]">배송 대기 업무</h2>
        <p className="mt-1 break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">
          접수된 배송지와 상품을 확인하고 운송장 번호를 등록합니다.
        </p>
        <div className="mt-4">
          <ShippingWorkPanel />
        </div>
      </section>
    </main>
  );
}
