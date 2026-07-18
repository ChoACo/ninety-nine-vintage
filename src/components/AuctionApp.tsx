"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminAccessGate } from "@/src/components/admin/AdminAccessGate";
import { AdminPage } from "@/src/components/admin";
import BulkAuctionImportModal from "@/src/components/admin/BulkAuctionImportModal";
import { ShippingWorkPanel } from "@/src/components/admin/ShippingWorkPanel";
import { AuthModal } from "@/src/components/auth";
import { ChatPage } from "@/src/components/chat/ChatPage";
import { FloatingAdminChat } from "@/src/components/chat/FloatingAdminChat";
import {
  AuctionClock,
  Button,
  Navigation,
  SiteHeader,
  type NavigationTarget,
} from "@/src/components/common";
import { Toast } from "@/src/components/common/Toast";
import {
  FeedList,
  NewAuctionModal,
  type NewAuctionDraft,
} from "@/src/components/feed";
import { SoldAuctionFeed } from "@/src/components/feed/SoldAuctionFeed";
import {
  AuctionOverviewSidebar,
  LiveBidSidebar,
  OnlineMembersSidebar,
} from "@/src/components/live";
import { AccountPage } from "@/src/components/profile";
import { NicknameOnboardingModal } from "@/src/components/profile/NicknameOnboardingModal";
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
import { placeBid } from "@/src/lib/supabase/bids";
import {
  startProductInquiry,
  type SupportViewerRole,
} from "@/src/lib/supabase/supportChat";
import {
  createProduct,
  createProductsBatch,
} from "@/src/lib/supabase/products";
import { formatKRW } from "@/src/utils/formatters";

function toSupportRole(role: AppRole): SupportViewerRole | null {
  if (isMemberRole(role)) return "member";
  // The private owner account participates in ordinary support work only as an
  // operator. Cross-operator review lives exclusively on the gated owner page.
  if (role === "admin") return "operator";
  if (role === "employee" || role === "operator") return role;
  return null;
}

export function AuctionApp() {
  const [activePage, setActivePage] = useState<NavigationTarget>("feed");
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
  const showOnlineMembers =
    Boolean(auth.user) && auth.role !== "unauthorized";
  const operationsRole = isOwnerRole(auth.role) ? "admin" : "operator";

  const {
    members: onlineMembers,
    totalCount: onlineMemberCount,
    hasMore: hasMoreOnlineMembers,
    status: onlineMembersStatus,
    error: onlineMembersError,
  } = useOnlineMembers({
    enabled: !auth.isLoading && showOnlineMembers,
    userId: auth.user?.id ?? null,
    role: auth.user ? auth.role : null,
  });
  const {
    posts,
    isLoading: productsLoading,
    error: productsError,
    refreshProducts,
  } = useSupabaseProducts();
  const soldAuctions = usePublicSoldAuctions();

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

    await startProductInquiry(postId, message);
    showToast("운영팀에 상품 문의를 전송했습니다.");
  };

  const handleCreateAuction = async (draft: NewAuctionDraft) => {
    if (!canManageProducts(auth.role)) {
      openAuthentication();
      throw new Error("상품 업무 권한이 있는 운영 스태프로 로그인해 주세요.");
    }

    await createProduct(draft);
    await refreshProducts();
    setOperationsRevision((current) => current + 1);
    if (draft.status === "active") setActivePage("feed");
    showToast(
      draft.status === "pending"
        ? "새 경매글을 가장 가까운 오전 10시 공개로 예약했습니다."
        : "새 경매글을 즉시 공개했습니다.",
    );
  };

  const handleCreateAuctionsBatch = async (
    drafts: NewAuctionDraft[],
    onProgress: Parameters<typeof createProductsBatch>[1],
  ) => {
    if (!canManageProducts(auth.role)) {
      openAuthentication();
      throw new Error("상품 업무 권한이 있는 운영 스태프로 로그인해 주세요.");
    }

    await createProductsBatch(drafts, onProgress);
    await refreshProducts();
    setOperationsRevision((current) => current + 1);
    showToast(`${drafts.length.toLocaleString("ko-KR")}개 경매글을 일괄 등록했습니다.`);
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await auth.signOut();
      setActivePage("feed");
      setNewAuctionOpen(false);
      setBulkAuctionOpen(false);
      showToast("로그아웃했습니다.");
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
            onOpenWorkspace={() => setActivePage("admin")}
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
              ? "lg:grid-cols-[180px_minmax(0,1fr)_220px] xl:grid-cols-[200px_minmax(0,1fr)_240px]"
              : "lg:grid-cols-[minmax(0,1fr)_235px]"
          }`}
        >
          {showOnlineMembers ? (
            <OnlineMembersSidebar
              members={onlineMembers}
              totalCount={onlineMemberCount}
              hasMore={hasMoreOnlineMembers}
              status={onlineMembersStatus}
              error={onlineMembersError}
              className="hidden lg:block"
            />
          ) : null}

          <div className="min-w-0">
            <AuctionClock />

            <section className="theme-panel relative my-6 overflow-hidden rounded-[2rem] border px-5 py-5 sm:px-7 sm:py-6">
              <div aria-hidden="true" className="absolute -right-10 -top-14 h-36 w-36 rounded-full bg-[var(--accent-surface)]/70" />
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black tracking-[0.14em] text-[var(--accent-text)]">DAMINE&apos;S VINTAGE CLOSET</p>
                  <h2 className="mt-2 text-xl font-black tracking-[-0.035em] text-[var(--text-strong)] sm:text-2xl">
                    매일 만나는 믿을 수 있는 구제 옷, 다미네 구제
                  </h2>
                  <p className="mt-2 max-w-2xl break-keep text-[17px] font-medium leading-7 text-[var(--text-muted)]">
                    오후 8시 56분부터 기존 참여자만 입찰할 수 있습니다. 오후 9시에는 정산을 위해 멈추고, 미판매 상품은 오후 10시부터 다시 입찰할 수 있습니다.
                  </p>
                </div>
                <span className="w-fit shrink-0 rounded-full bg-[var(--info-surface)] px-4 py-2 text-sm font-bold text-[var(--info-text)]">
                  20:56 신규 제한 · 21:00 정산 · 22:00 재개
                </span>
              </div>
            </section>

            <FeedList
              posts={posts}
              currentUserName={publicDisplayName}
              onBid={handleBid}
              onInquiry={handleProductInquiry}
              isLoading={productsLoading}
              loadError={productsError}
              onRetry={refreshProducts}
              description="오후 8시 56분 이후 무입찰 첫 건은 즉시 확정되며, 오후 9시 정산 후 미판매 상품은 오후 10시에 다시 열립니다."
            />
            <SoldAuctionFeed
              auctions={soldAuctions.auctions}
              isLoading={soldAuctions.isLoading}
              error={soldAuctions.error}
              onRetry={soldAuctions.refresh}
            />
          </div>

          {isMember ? (
            <LiveBidSidebar
              posts={posts}
              currentUserName={publicDisplayName}
              onBid={handleBid}
              className="hidden lg:block"
            />
          ) : auth.user && isStaffRole(auth.role) ? (
            <AuctionOverviewSidebar
              posts={posts}
              className="hidden lg:block"
            />
          ) : (
            <aside className="theme-panel sticky top-24 hidden rounded-[1.6rem] border p-5 text-center lg:block">
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
          )}
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
            setActivePage(page);
          }}
          role={auth.role}
          className="mt-3"
        />
      </div>

      <div key={activePage} className="animate-fade-in-up relative">
        {renderPage()}
      </div>

      <NewAuctionModal
        open={newAuctionOpen && canManageProducts(auth.role)}
        onClose={() => setNewAuctionOpen(false)}
        onSubmit={handleCreateAuction}
      />

      <BulkAuctionImportModal
        open={bulkAuctionOpen && canManageProducts(auth.role)}
        onClose={() => setBulkAuctionOpen(false)}
        onSubmit={handleCreateAuctionsBatch}
      />

      <AuthModal
        key={authOpen ? "open" : "closed"}
        open={authOpen}
        onClose={() => setAuthOpen(false)}
      />

      <NicknameOnboardingModal
        enabled={Boolean(auth.user) && isMemberRole(auth.role)}
        userId={auth.user?.id ?? null}
        onCompleted={auth.refreshProfile}
        onSignOut={handleSignOut}
      />

      <FloatingAdminChat
        userId={auth.user?.id ?? null}
        role={auth.user ? toSupportRole(auth.role) : null}
        hidden={activePage === "chat"}
      />

      <Toast
        message={toastMessage}
        visible={Boolean(toastMessage)}
        onDismiss={() => setToastMessage("")}
      />
    </div>
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
