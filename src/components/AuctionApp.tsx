"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminAccessGate } from "@/src/components/admin/AdminAccessGate";
import { AdminPage } from "@/src/components/admin";
import BulkAuctionImportModal from "@/src/components/admin/BulkAuctionImportModal";
import { AuthModal } from "@/src/components/auth";
import { ChatPage } from "@/src/components/chat/ChatPage";
import { FloatingAdminChat } from "@/src/components/chat/FloatingAdminChat";
import {
  AuctionClock,
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
import { LiveBidSidebar, OnlineMembersSidebar } from "@/src/components/live";
import { AccountPage } from "@/src/components/profile";
import { useAuthSession } from "@/src/hooks/useAuthSession";
import { useOnlineMembers } from "@/src/hooks/useOnlineMembers";
import { useSupabaseProducts } from "@/src/hooks/useSupabaseProducts";
import { isStaffRole, type AppRole } from "@/src/lib/supabase/auth";
import { placeBid } from "@/src/lib/supabase/bids";
import {
  getOrCreateMemberSupportConversation,
  reopenMemberSupportConversation,
  sendSupportMessage,
} from "@/src/lib/supabase/supportChat";
import {
  createProduct,
  createProductsBatch,
} from "@/src/lib/supabase/products";
import type { Role } from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";

type AuthMode = "member" | "staff";

function toUiRole(role: AppRole): Role {
  return role === "admin" || role === "operator" ? role : "user";
}

export function AuctionApp() {
  const [activePage, setActivePage] = useState<NavigationTarget>("feed");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("member");
  const [newAuctionOpen, setNewAuctionOpen] = useState(false);
  const [bulkAuctionOpen, setBulkAuctionOpen] = useState(false);
  const [operationsRevision, setOperationsRevision] = useState(0);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const auth = useAuthSession();
  const role = toUiRole(auth.role);
  const displayName = auth.profile?.displayName ?? "";
  const isMember = Boolean(auth.user) && auth.role === "member";

  const {
    members: onlineMembers,
    hasMore: hasMoreOnlineMembers,
    status: onlineMembersStatus,
    error: onlineMembersError,
  } = useOnlineMembers();
  const {
    posts,
    isLoading: productsLoading,
    error: productsError,
    refreshProducts,
  } = useSupabaseProducts();

  const showToast = useCallback((message: string) => {
    setToastMessage("");
    window.setTimeout(() => setToastMessage(message), 0);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3_800);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const openAuthentication = useCallback((mode: AuthMode = "member") => {
    setAuthMode(mode);
    setAuthOpen(true);
  }, []);

  const requireMember = useCallback(() => {
    if (auth.user && auth.role === "member") return auth.user;

    if (auth.user) {
      throw new Error(
        auth.role === "admin" || auth.role === "operator"
          ? "관리자·운영자 계정은 입찰이나 회원 문의를 보낼 수 없습니다."
          : "이 로그인 방식에는 회원 권한이 없습니다. 로그아웃 후 카카오로 다시 로그인해 주세요.",
      );
    }

    openAuthentication("member");
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
    const member = requireMember();
    const post = posts.find((item) => item.id === postId);
    if (!post) throw new Error("문의할 상품을 찾지 못했습니다.");

    const productLabel = (
      post.description
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? post.title
    ).slice(0, 160);
    let conversation = await getOrCreateMemberSupportConversation();
    if (conversation.status === "closed") {
      conversation = await reopenMemberSupportConversation();
    }
    await sendSupportMessage(
      conversation.id,
      member.id,
      [`[상품 문의 · ${post.id}]`, productLabel, "", message.trim()].join("\n"),
    );
    showToast("운영팀에 상품 문의를 전송했습니다.");
  };

  const handleCreateAuction = async (draft: NewAuctionDraft) => {
    if (!isStaffRole(auth.role)) {
      openAuthentication("staff");
      throw new Error("관리자 또는 운영자 계정으로 로그인해 주세요.");
    }

    await createProduct(draft);
    await refreshProducts();
    setOperationsRevision((current) => current + 1);
    if (draft.status === "active") setActivePage("feed");
    showToast(
      draft.status === "pending"
        ? "새 경매글을 다음날 오전 10시 공개로 예약했습니다."
        : "새 경매글을 즉시 공개했습니다.",
    );
  };

  const handleCreateAuctionsBatch = async (
    drafts: NewAuctionDraft[],
    onProgress: Parameters<typeof createProductsBatch>[1],
  ) => {
    if (!isStaffRole(auth.role)) {
      openAuthentication("staff");
      throw new Error("관리자 또는 운영자 계정으로 로그인해 주세요.");
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
            role={
              auth.user && auth.role !== "unauthorized" ? auth.role : null
            }
            onRequestSignIn={() => openAuthentication("member")}
          />
        </main>
      );
    }

    if (activePage === "profile") {
      return (
        <AccountPage
          userId={auth.user?.id}
          displayName={displayName}
          avatarUrl={auth.profile?.avatarUrl}
          email={auth.user?.email}
          role={role}
          onSignIn={() => openAuthentication("member")}
          onSignOut={handleSignOut}
        />
      );
    }

    if (activePage === "admin") {
      return role === "admin" || role === "operator" ? (
        <AdminPage
          key={operationsRevision}
          role={role}
          onCreateProduct={() => setNewAuctionOpen(true)}
          onOpenBulkImport={() => setBulkAuctionOpen(true)}
          onProductsChanged={refreshProducts}
          onNotify={showToast}
        />
      ) : (
        <AdminAccessGate onSwitchToStaff={() => openAuthentication("staff")} />
      );
    }

    return (
      <main className="mx-auto w-full max-w-[1800px] px-3 pb-28 pt-6 sm:px-4 sm:pt-8 lg:px-5 lg:pb-12">
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_235px] xl:grid-cols-[170px_minmax(0,1fr)_235px] xl:gap-4">
          <OnlineMembersSidebar
            members={onlineMembers}
            hasMore={hasMoreOnlineMembers}
            status={onlineMembersStatus}
            error={onlineMembersError}
            className="hidden xl:block"
          />

          <div className="min-w-0">
            <AuctionClock />

            <section className="relative my-6 overflow-hidden rounded-[2rem] border border-[#eadfd3] bg-[#fffaf4] px-5 py-5 sm:px-7 sm:py-6">
              <div aria-hidden="true" className="absolute -right-10 -top-14 h-36 w-36 rounded-full bg-[#f6d9d0]/70" />
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black tracking-[0.14em] text-[#bf6c5b]">DAMINE&apos;S VINTAGE CLOSET</p>
                  <h2 className="mt-2 text-xl font-black tracking-[-0.035em] text-[#473c35] sm:text-2xl">
                    매일 만나는 믿을 수 있는 구제 옷, 다미네 구제
                  </h2>
                  <p className="mt-2 max-w-2xl break-keep text-[17px] font-medium leading-7 text-[#7f6f65]">
                    오후 8시 56분부터 기존 참여자만 입찰할 수 있습니다. 단, 무입찰 상품은 오후 9시 전 첫 입찰이 즉시 확정됩니다.
                  </p>
                </div>
                <span className="w-fit shrink-0 rounded-full bg-[#e4f0f3] px-4 py-2 text-sm font-bold text-[#517783]">
                  20:56 신규 제한 · 무입찰 첫 건 즉시 확정
                </span>
              </div>
            </section>

            <FeedList
              posts={posts}
              currentUserName={displayName}
              onBid={handleBid}
              onInquiry={handleProductInquiry}
              isLoading={productsLoading}
              loadError={productsError}
              onRetry={refreshProducts}
              description="Supabase에 등록된 실제 상품만 표시합니다. 오후 8시 56분 이후 무입찰 첫 입찰은 즉시 확정됩니다."
            />
          </div>

          {isMember ? (
            <LiveBidSidebar
              posts={posts}
              currentUserName={displayName}
              onBid={handleBid}
              className="hidden lg:block"
            />
          ) : (
            <aside className="sticky top-24 hidden rounded-[1.6rem] border border-[#ead8cc] bg-[#fffaf5]/95 p-5 text-center shadow-sm lg:block">
              <p className="text-[17px] font-black text-[#493b34]">내 입찰 현황</p>
              <p className="mt-2 break-keep text-[15px] font-bold leading-6 text-[#806f64]">
                카카오 회원으로 로그인하면 참여 중인 상품을 실시간으로 확인할 수 있어요.
              </p>
              {!auth.user ? (
                <button
                  type="button"
                  onClick={() => openAuthentication("member")}
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

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#fff6ec_0%,#f8f3ec_38%,#f3f7f6_100%)]">
      <div aria-hidden="true" className="pointer-events-none fixed -left-20 top-36 h-72 w-72 rounded-full bg-[#f3cfc4]/20 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none fixed -right-24 top-[45%] h-80 w-80 rounded-full bg-[#bfdde5]/20 blur-3xl" />

      <div className="relative mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        <SiteHeader
          role={role}
          isAuthenticated={Boolean(auth.user)}
          displayName={displayName}
          onOpenAuth={() => openAuthentication("member")}
          isSigningOut={isSigningOut}
          onSignOut={auth.user ? handleSignOut : undefined}
        />
        <Navigation
          activePage={activePage}
          onNavigate={setActivePage}
          role={role}
          className="mt-3"
        />
      </div>

      <div key={activePage} className="animate-fade-in-up relative">
        {renderPage()}
      </div>

      <NewAuctionModal
        open={newAuctionOpen && (role === "admin" || role === "operator")}
        onClose={() => setNewAuctionOpen(false)}
        onSubmit={handleCreateAuction}
      />

      <BulkAuctionImportModal
        open={bulkAuctionOpen && (role === "admin" || role === "operator")}
        onClose={() => setBulkAuctionOpen(false)}
        onSubmit={handleCreateAuctionsBatch}
      />

      <AuthModal
        key={`${authMode}-${authOpen ? "open" : "closed"}`}
        open={authOpen}
        initialMode={authMode}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={() => showToast("로그인했습니다.")}
      />

      <FloatingAdminChat
        userId={auth.user?.id ?? null}
        role={auth.user && auth.role !== "unauthorized" ? auth.role : null}
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
