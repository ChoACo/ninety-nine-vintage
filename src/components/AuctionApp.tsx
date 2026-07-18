"use client";

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  AuctionClock,
  Button,
  Navigation,
  SiteHeader,
  type NavigationTarget,
} from "@/src/components/common";
import { Toast } from "@/src/components/common/Toast";
import type { NewAuctionDraft } from "@/src/components/feed/NewAuctionModal";
import { useAuthSession } from "@/src/hooks/useAuthSession";
import { useOnlineMembers } from "@/src/hooks/useOnlineMembers";
import { usePublicSoldAuctions } from "@/src/hooks/usePublicSoldAuctions";
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
import { formatKRW } from "@/src/utils/formatters";

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
const NewAuctionModal = lazy(
  () => import("@/src/components/feed/NewAuctionModal"),
);
const SoldAuctionFeed = lazy(() =>
  import("@/src/components/feed/SoldAuctionFeed").then((module) => ({
    default: module.SoldAuctionFeed,
  })),
);
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

export interface AuctionAppProps {
  page?: NavigationTarget;
}

function toSupportRole(role: AppRole): SupportViewerRole | null {
  if (isMemberRole(role)) return "member";
  // The private owner account participates in ordinary support work only as an
  // operator. Cross-operator review lives exclusively on the gated owner page.
  if (role === "admin") return "operator";
  if (role === "employee" || role === "operator") return role;
  return null;
}

function useDesktopRails() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1280px)");
    const sync = () => setIsDesktop(mediaQuery.matches);

    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, []);

  return isDesktop;
}

export function AuctionApp({ page: activePage = "feed" }: AuctionAppProps) {
  const [authOpen, setAuthOpen] = useState(false);
  const [newAuctionOpen, setNewAuctionOpen] = useState(false);
  const [bulkAuctionOpen, setBulkAuctionOpen] = useState(false);
  const [operationsRevision, setOperationsRevision] = useState(0);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const auth = useAuthSession();
  const displayName = auth.profile?.displayName ?? "";
  const publicDisplayName = isOwnerRole(auth.role) ? "" : displayName;
  const isMember = Boolean(auth.user) && isMemberRole(auth.role);
  const isFeedPage = activePage === "feed";
  const showDesktopRails = useDesktopRails();
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
    isLoading: productsLoading,
    hasMoreProducts,
    isLoadingMore: productsLoadingMore,
    error: productsError,
    refreshProducts,
    loadMoreProducts,
  } = useSupabaseProducts({ enabled: isFeedPage });
  const soldAuctions = usePublicSoldAuctions({ enabled: isFeedPage });

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
    const isCurrentFeedAlias = target === "feed" && currentPath === "/";
    if (currentPath !== nextPath && !isCurrentFeedAlias) {
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

  const handleCreateAuction = async (draft: NewAuctionDraft) => {
    if (!canManageProducts(auth.role)) {
      openAuthentication();
      throw new Error("상품 업무 권한이 있는 운영 스태프로 로그인해 주세요.");
    }

    const { createProduct } = await import("@/src/lib/supabase/products");
    await createProduct(draft);
    await refreshProducts();
    setOperationsRevision((current) => current + 1);
    if (draft.status === "active") navigateToPage("feed");
    showToast(
      draft.status === "pending"
        ? "새 경매글을 가장 가까운 오전 10시 공개로 예약했습니다."
        : "새 경매글을 즉시 공개했습니다.",
    );
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
    await refreshProducts();
    setOperationsRevision((current) => current + 1);
    showToast(`${drafts.length.toLocaleString("ko-KR")}개 경매글을 일괄 등록했습니다.`);
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await auth.signOut();
      setNewAuctionOpen(false);
      setBulkAuctionOpen(false);
      showToast("로그아웃했습니다.");
      navigateToPage("feed");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "로그아웃하지 못했습니다.");
    } finally {
      setIsSigningOut(false);
    }
  };

  const renderPage = () => {
    if (activePage === "chat") {
      return (
        <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
          <ChatPage
            userId={auth.user?.id ?? null}
            role={auth.user ? toSupportRole(auth.role) : null}
            onRequestSignIn={openAuthentication}
          />
        </main>
      );
    }

    if (activePage === "profile") {
      if (auth.user && isStaffRole(auth.role)) {
        return (
          <StaffAccountPage
            role={auth.role}
            displayName={publicDisplayName}
            onOpenWorkspace={() => navigateToPage("admin")}
            onSignOut={handleSignOut}
          />
        );
      }

      return (
        <AccountPage
          userId={auth.user?.id}
          displayName={publicDisplayName}
          avatarUrl={auth.profile?.avatarUrl}
          email={auth.user?.email}
          role="user"
          onSignIn={openAuthentication}
          onSignOut={handleSignOut}
          onProfileRefresh={auth.refreshProfile}
        />
      );
    }

    if (activePage === "admin") {
      if (canAccessOperationsCenter(auth.role)) {
        return (
          <AdminPage
            key={`${operationsRevision}-${operationsRole}`}
            role={operationsRole}
            onCreateProduct={() => setNewAuctionOpen(true)}
            onOpenBulkImport={() => setBulkAuctionOpen(true)}
            onProductsChanged={refreshProducts}
            onNotify={showToast}
          />
        );
      }

      if (auth.role === "employee") {
        return (
          <EmployeeOperationsPage
            onCreateProduct={() => setNewAuctionOpen(true)}
            onOpenBulkImport={() => setBulkAuctionOpen(true)}
          />
        );
      }

      return (
        <AdminAccessGate onSwitchToStaff={openAuthentication} />
      );
    }

    return (
      <main className="mx-auto w-full max-w-[1800px] px-3 pb-28 pt-6 sm:px-4 sm:pt-8 lg:px-5 lg:pb-12">
        <div
          className={`grid items-start gap-3 xl:gap-4 ${
            showOnlineMembers
              ? "xl:grid-cols-[180px_minmax(0,1fr)_220px] 2xl:grid-cols-[200px_minmax(0,1fr)_240px]"
              : "xl:grid-cols-[minmax(0,1fr)_235px]"
          }`}
        >
          {showOnlineMembers && showDesktopRails ? (
            <OnlineMembersSidebar
              members={onlineMembers}
              totalCount={onlineMemberCount}
              hasMore={hasMoreOnlineMembers}
              status={onlineMembersStatus}
              error={onlineMembersError}
              className="hidden xl:block"
            />
          ) : null}

          <div className="min-w-0">
            <AuctionClock />

            {showOnlineMembers ? (
              <section
                aria-label="현재 온라인 사용자 요약"
                className="theme-panel mt-3 flex min-h-12 items-center gap-2 overflow-hidden rounded-2xl border px-3 py-2 xl:hidden"
              >
                <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-black text-[var(--success-text)]">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full bg-[#4aaf63]"
                  />
                  온라인 {onlineMemberCount}명
                </span>
                <span
                  aria-hidden="true"
                  className="h-4 w-px shrink-0 bg-[var(--border)]"
                />
                <span className="truncate text-sm font-bold text-[var(--text-muted)]">
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

            <section className="theme-panel relative my-4 overflow-hidden rounded-[1.6rem] border sm:my-5 sm:rounded-[1.8rem]">
              <div className="grid items-stretch md:grid-cols-[minmax(0,1.2fr)_minmax(15rem,0.8fr)]">
                <div className="flex flex-col justify-center px-4 py-5 sm:px-6 sm:py-6 lg:px-7">
                  <p className="text-xs font-black tracking-[0.16em] text-[var(--accent-text)] sm:text-sm">
                    NINETY-NINE VINTAGE
                  </p>
                  <h2 className="mt-1.5 text-xl font-black tracking-[-0.035em] text-[var(--text-strong)] sm:text-2xl">
                    오늘의 빈티지를 투명한 경매로 만나보세요
                  </h2>
                  <p className="mt-2 max-w-2xl break-keep text-sm font-semibold leading-6 text-[var(--text-muted)] sm:text-[15px] sm:leading-7">
                    오후 8시 56분부터 기존 참여자만 입찰할 수 있습니다. 오후 9시
                    정산 후 미판매 상품은 오후 10시에 다시 열립니다.
                  </p>
                  <span className="mt-3 w-fit rounded-full bg-[var(--info-surface)] px-3 py-1.5 text-xs font-black text-[var(--info-text)] sm:text-sm">
                    20:56 신규 제한 · 21:00 정산 · 22:00 재개
                  </span>
                </div>

                <picture className="block min-h-40 overflow-hidden bg-black md:min-h-full">
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
                    alt="나인티 나인 빈티지 공식 배너"
                    width={1024}
                    height={1024}
                    loading="lazy"
                    decoding="async"
                    className="h-full max-h-64 w-full object-contain md:max-h-none"
                  />
                </picture>
              </div>
            </section>

            <FeedList
              posts={posts}
              currentUserName={publicDisplayName}
              onBid={handleBid}
              onInquiry={handleProductInquiry}
              isLoading={productsLoading}
              hasMoreProducts={hasMoreProducts}
              isLoadingMore={productsLoadingMore}
              loadError={productsError}
              onRetry={refreshProducts}
              onLoadMore={loadMoreProducts}
              description="오후 8시 56분 이후 무입찰 첫 건은 즉시 확정되며, 오후 9시 정산 후 미판매 상품은 오후 10시에 다시 열립니다."
            />
            <SoldAuctionFeed
              auctions={soldAuctions.auctions}
              isLoading={soldAuctions.isLoading}
              error={soldAuctions.error}
              onRetry={soldAuctions.refresh}
            />
          </div>

          {showDesktopRails && isMember ? (
            <LiveBidSidebar
              posts={posts}
              currentUserName={publicDisplayName}
              onBid={handleBid}
              className="hidden xl:block"
            />
          ) : showDesktopRails && auth.user && isStaffRole(auth.role) ? (
            <AuctionOverviewSidebar
              posts={posts}
              className="hidden xl:block"
            />
          ) : showDesktopRails ? (
            <aside className="theme-panel sticky top-24 hidden rounded-[1.6rem] border p-5 text-center xl:block">
              <p className="text-[17px] font-black text-[var(--text-strong)]">내 입찰 현황</p>
              <p className="mt-2 break-keep text-[15px] font-bold leading-6 text-[var(--text-muted)]">
                카카오 회원으로 로그인하면 참여 중인 상품을 실시간으로 확인할 수 있어요.
              </p>
              {!auth.user ? (
                <button
                  type="button"
                  onClick={openAuthentication}
                  className="mt-4 min-h-11 rounded-xl bg-[#fee500] px-4 text-sm font-black text-[#191919]"
                >
                  카카오 로그인
                </button>
              ) : null}
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
      <div aria-hidden="true" className="theme-coral-glow pointer-events-none fixed -left-20 top-36 h-72 w-72 rounded-full blur-3xl" />
      <div aria-hidden="true" className="theme-sky-glow pointer-events-none fixed -right-24 top-[45%] h-80 w-80 rounded-full blur-3xl" />

      <div className="relative mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        <SiteHeader
          role={auth.role}
          isAuthenticated={Boolean(auth.user)}
          displayName={publicDisplayName}
          onOpenAuth={openAuthentication}
          onOpenOwnerTools={
            isOwnerRole(auth.role)
              ? () => window.location.assign("/owner")
              : undefined
          }
          isSigningOut={isSigningOut}
          onSignOut={auth.user ? handleSignOut : undefined}
        />
        <Navigation
          activePage={activePage}
          onNavigate={(page) => {
            if (page === "profile" && isOwnerRole(auth.role)) {
              window.location.assign("/owner");
              return;
            }
            navigateToPage(page);
          }}
          role={auth.role}
          className="mt-3"
        />
      </div>

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
      className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="theme-panel rounded-[1.6rem] border px-5 py-8 text-center font-bold text-[var(--text-muted)]">
        화면을 불러오는 중…
      </div>
    </main>
  );
}

function NetworkBlockedPage() {
  return (
    <main className="theme-app-shell grid min-h-[75dvh] place-items-center px-4 py-12">
      <section className="theme-panel w-full max-w-xl rounded-[2rem] border p-7 text-center shadow-[0_22px_60px_rgba(92,67,51,0.09)] sm:p-9">
        <span
          aria-hidden="true"
          className="mx-auto grid size-16 place-items-center rounded-2xl bg-[var(--danger-surface)] text-2xl font-black text-[var(--danger-text)]"
        >
          !
        </span>
        <h1 className="mt-5 text-2xl font-black text-[var(--text-strong)]">
          보안 정책에 따라 접속이 제한되었습니다
        </h1>
        <p className="mt-3 break-keep font-bold leading-7 text-[var(--text-muted)]">
          비정상 접속이나 오남용 방지를 위해 현재 네트워크 세션이 차단되었습니다.
          잘못 차단되었다면 고객센터에 차단 시각과 함께 해제를 요청해 주세요.
        </p>
        <a
          href="/privacy"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-5 font-black text-[var(--text-strong)]"
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
      <section className="theme-panel overflow-hidden rounded-[2rem] border shadow-[0_22px_60px_rgba(92,67,51,0.09)]">
        <div className="bg-[linear-gradient(135deg,var(--accent-surface)_0%,var(--info-surface)_100%)] px-6 py-8 sm:px-9">
          <p className="text-sm font-black tracking-[0.14em] text-[var(--accent-text)]">
            OPERATIONS ACCOUNT
          </p>
          <div className="mt-4 flex items-center gap-4">
            <span
              aria-hidden="true"
              className="grid size-16 place-items-center rounded-2xl bg-[var(--surface)] text-2xl font-black text-[var(--accent-text)] shadow-sm"
            >
              운영
            </span>
            <div>
              <h2 className="text-2xl font-black text-[var(--text-strong)]">
                {safeDisplayName || "운영 계정"}
              </h2>
              <span className="mt-1 inline-flex rounded-full bg-[var(--surface)]/80 px-3 py-1 text-sm font-black text-[var(--success-text)]">
                {roleLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="px-6 py-6 sm:px-9">
          <p className="break-keep text-[17px] font-bold leading-8 text-[var(--text-muted)]">
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
      <header className="mb-7">
        <p className="text-sm font-black tracking-[0.16em] text-[var(--info-text)]">
          EMPLOYEE WORKSPACE
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black tracking-tight text-[var(--text-strong)]">
            직원 업무 도구
          </h1>
          <span className="rounded-full bg-[var(--info-surface)] px-3 py-1.5 text-sm font-black text-[var(--info-text)]">
            직원
          </span>
        </div>
        <p className="mt-3 max-w-3xl break-keep text-[17px] font-bold leading-8 text-[var(--text-muted)]">
          상품 등록과 배송 대기 처리에 필요한 권한만 사용할 수 있습니다. 회원 관리와
          상담함은 이 계정에 노출되지 않습니다.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="theme-panel rounded-[1.6rem] border p-6">
          <p className="text-xs font-black tracking-[0.14em] text-[var(--accent-text)]">
            BULK REGISTRATION
          </p>
          <h2 className="mt-2 text-xl font-black text-[var(--text-strong)]">
            상품 일괄 등록
          </h2>
          <p className="mt-2 break-keep font-bold leading-7 text-[var(--text-muted)]">
            Excel 상품 정보와 이미지 폴더를 검토한 뒤 여러 경매글을 등록합니다.
          </p>
          <Button className="mt-5" onClick={onOpenBulkImport}>
            일괄 등록 열기
          </Button>
        </section>

        <section className="theme-panel rounded-[1.6rem] border p-6">
          <p className="text-xs font-black tracking-[0.14em] text-[var(--info-text)]">
            SINGLE REGISTRATION
          </p>
          <h2 className="mt-2 text-xl font-black text-[var(--text-strong)]">
            상품 개별 등록
          </h2>
          <p className="mt-2 break-keep font-bold leading-7 text-[var(--text-muted)]">
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

      <section className="theme-panel mt-4 rounded-[1.6rem] border p-5 sm:p-6">
        <h2 className="text-xl font-black text-[var(--text-strong)]">배송 대기 업무</h2>
        <p className="mt-1 break-keep font-bold leading-7 text-[var(--text-muted)]">
          접수된 배송지와 상품을 확인하고 운송장 번호를 등록합니다.
        </p>
        <div className="mt-4">
          <ShippingWorkPanel />
        </div>
      </section>
    </main>
  );
}
