"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminAccessGate } from "@/src/components/admin/AdminAccessGate";
import AdminLoginModal from "@/src/components/admin/AdminLoginModal";
import { AdminPage } from "@/src/components/admin";
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
import { ProfilePage } from "@/src/components/profile";
import {
  LiveBidSidebar,
  OnlineMembersSidebar,
} from "@/src/components/live";
import {
  adminSaleRecords,
  adminCustomerChats,
  adminShipmentBatches,
  chatThreads,
  currentUser,
  paymentAccount,
  wonAuctions,
} from "@/src/data/mockData";
import type {
  AdminCustomerChatPayload,
  AdminCustomerChatThread,
  AdminShipmentBatch,
  BidHistoryRecord,
  ChatMessage,
  ChatThread,
  Role,
  ShipmentRegistrationPayload,
  WonAuction,
} from "@/src/types/auction";
import { getMinimumBidAmount } from "@/src/utils/bidding";
import {
  assertAuctionBidAllowed,
  AuctionBidPolicyError,
} from "@/src/utils/auctionBidPolicy";
import { formatKRW } from "@/src/utils/formatters";
import { createProduct } from "@/src/lib/supabase/products";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";
import {
  isSupabaseAdmin,
  signOutSupabaseAdmin,
} from "@/src/lib/supabase/adminAuth";
import { useFulfillmentFlow } from "@/src/hooks/useFulfillmentFlow";
import { useSupabaseProducts } from "@/src/hooks/useSupabaseProducts";

const PROFILE_STORAGE_KEY = "damine-vintage-profile";
const AUCTION_STORAGE_KEY = "damine-vintage-won-auctions";
const ADMIN_SHIPMENT_STORAGE_KEY = "damine-vintage-admin-shipments";
const AUCTION_HOST_THREAD_ID = "chat-auction-host";
const MOCK_BIDDER_IDENTITY = currentUser.name;

export function AuctionApp() {
  const [role, setRole] = useState<Role>("user");
  const [activePage, setActivePage] = useState<NavigationTarget>("feed");
  const {
    posts,
    setPosts,
    isLoading: productsLoading,
    error: productsError,
    refreshProducts,
  } = useSupabaseProducts();
  const [chatThreadState, setChatThreadState] =
    useState<ChatThread[]>(chatThreads);
  const [adminShipmentState, setAdminShipmentState] =
    useState<AdminShipmentBatch[]>(adminShipmentBatches);
  const [adminCustomerChatState, setAdminCustomerChatState] =
    useState<AdminCustomerChatThread[]>(adminCustomerChats);
  const [newAuctionOpen, setNewAuctionOpen] = useState(false);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [isAdminSigningOut, setIsAdminSigningOut] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  useEffect(() => {
    let client;

    try {
      client = getSupabaseBrowserClient();
    } catch {
      return undefined;
    }

    let active = true;
    const applyUser = (user: Parameters<typeof isSupabaseAdmin>[0]) => {
      if (!active) return;
      const isAdmin = isSupabaseAdmin(user);
      setIsAdminAuthenticated(isAdmin);
      if (!isAdmin) {
        setRole((currentRole) =>
          currentRole === "admin" ? "user" : currentRole,
        );
      }
    };

    void client.auth
      .getUser()
      .then(({ data }) => applyUser(data.user))
      .catch(() => applyUser(null));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      applyUser(session?.user);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!toastMessage) return;

    const timer = window.setTimeout(() => setToastMessage(""), 3600);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    const saved = window.localStorage.getItem(ADMIN_SHIPMENT_STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as unknown;
      if (Array.isArray(parsed)) {
        const storedBatches = parsed as AdminShipmentBatch[];
        const storedById = new Map(
          storedBatches.map((batch) => [batch.id, batch]),
        );
        const initialIds = new Set(
          adminShipmentBatches.map((batch) => batch.id),
        );
        const mergedBatches = [
          ...adminShipmentBatches.map(
            (batch) => storedById.get(batch.id) ?? batch,
          ),
          ...storedBatches.filter((batch) => !initialIds.has(batch.id)),
        ];
        const restoreTimer = window.setTimeout(
          () => setAdminShipmentState(mergedBatches),
          0,
        );
        return () => window.clearTimeout(restoreTimer);
      }
    } catch {
      window.localStorage.removeItem(ADMIN_SHIPMENT_STORAGE_KEY);
    }
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage("");
    window.setTimeout(() => setToastMessage(message), 0);
  }, []);

  const commitAdminShipments = useCallback(
    (update: (current: AdminShipmentBatch[]) => AdminShipmentBatch[]) => {
      setAdminShipmentState((current) => {
        const next = update(current);
        window.localStorage.setItem(
          ADMIN_SHIPMENT_STORAGE_KEY,
          JSON.stringify(next),
        );
        return next;
      });
    },
    [],
  );

  const {
    profile,
    auctions: wonAuctionState,
    saveProfile,
    startBatchPayment,
    completeBatchPayment,
    completeShippingCredit,
    requestShipping,
    registerShipment,
  } = useFulfillmentFlow({
    initialProfile: currentUser,
    initialAuctions: wonAuctions,
    profileStorageKey: PROFILE_STORAGE_KEY,
    auctionStorageKey: AUCTION_STORAGE_KEY,
    onNotify: showToast,
  });

  const currentUserShipmentBatches = useMemo<AdminShipmentBatch[]>(() => {
    const grouped = new Map<string, WonAuction[]>();

    wonAuctionState.forEach((auction) => {
      if (
        !auction.shipmentBatchId ||
        (auction.stage !== "shipping-requested" && auction.stage !== "shipped")
      ) {
        return;
      }

      const current = grouped.get(auction.shipmentBatchId) ?? [];
      grouped.set(auction.shipmentBatchId, [...current, auction]);
    });

    return Array.from(grouped, ([batchId, items]) => {
      const representative = items[0];
      const shippingAddress =
        representative.shippingAddress ??
        profile.shippingAddresses.find((address) => address.isDefault) ??
        profile.shippingAddresses[0];
      const shippedItem = items.find((item) => item.stage === "shipped");
      const requestedAt =
        representative.shippingRequestedAt ?? representative.closedAt;
      const scheduledAt =
        representative.shippingScheduledAt ??
        representative.shippedAt ??
        requestedAt;

      return {
        id: batchId,
        buyer: {
          userId: profile.id,
          name: shippingAddress?.recipientName ?? profile.name,
          phone: shippingAddress?.phone ?? profile.phone,
          address: shippingAddress?.address ?? profile.address,
        },
        shippingAddress: shippingAddress ?? {
          id: "address-profile-fallback",
          label: "기본 배송지",
          recipientName: profile.name,
          phone: profile.phone,
          address: profile.address,
          isDefault: true,
        },
        requestedAt,
        scheduledAt,
        status: items.every((item) => item.stage === "shipped")
          ? "shipped"
          : "packing",
        courier: shippedItem?.courier,
        trackingNumber: shippedItem?.trackingNumber,
        shippedAt: shippedItem?.shippedAt,
        items: items.map((item) => ({
          id: item.id,
          auctionId: item.auctionId,
          title: item.title,
          description: item.description ?? item.title,
          imageUrls:
            item.imageUrls && item.imageUrls.length > 0
              ? item.imageUrls
              : [item.thumbnailUrl],
          thumbnailUrl: item.thumbnailUrl,
          winningBid: item.winningBid,
        })),
      };
    });
  }, [profile, wonAuctionState]);

  const shipmentBatches = useMemo(
    () => [...currentUserShipmentBatches, ...adminShipmentState],
    [adminShipmentState, currentUserShipmentBatches],
  );

  const salesWithCurrentProfile = useMemo(
    () =>
      adminSaleRecords.map((sale) => {
        const userAuction = wonAuctionState.find(
          (auction) => auction.auctionId === sale.auctionId,
        );
        const buyer = userAuction?.shippingAddress
          ? {
              userId: profile.id,
              name: userAuction.shippingAddress.recipientName,
              phone: userAuction.shippingAddress.phone,
              address: userAuction.shippingAddress.address,
            }
          : sale.buyer.userId === profile.id
            ? { ...sale.buyer, ...profile, userId: profile.id }
            : sale.buyer;

        if (!userAuction) return { ...sale, buyer };

        return {
          ...sale,
          buyer,
          paymentStatus: userAuction.paymentStatus,
          stage: userAuction.stage,
          description: userAuction.description ?? sale.description,
          imageUrls: userAuction.imageUrls ?? sale.imageUrls,
          shippingStatus:
            userAuction.stage === "shipped"
              ? ("shipped" as const)
              : userAuction.stage === "shipping-requested"
                ? ("ready" as const)
                : ("preparing" as const),
        };
      }),
    [profile, wonAuctionState],
  );

  const handleBid = async (postId: string, amount: number) => {
    const target = posts.find((post) => post.id === postId);

    if (!target) throw new Error("입찰 상품을 찾을 수 없습니다.");

    try {
      // TODO: DB 연동 필요 - 실제 저장 시 서버 트랜잭션 안에서 최신 입찰 원장을
      // 다시 조회한 뒤 이 정책을 재검증해야 무입찰 상품의 동시 첫 입찰을 차단할 수 있습니다.
      assertAuctionBidAllowed({
        post: target,
        currentUserName: MOCK_BIDDER_IDENTITY,
        now: new Date(),
      });
    } catch (error) {
      const message =
        error instanceof AuctionBidPolicyError
          ? error.decision.message
          : "현재 입찰 가능 여부를 확인하지 못했습니다.";
      showToast(message);
      throw error;
    }

    const minimumBid = getMinimumBidAmount(target);
    if (!Number.isInteger(amount) || amount < minimumBid) {
      showToast(`현재 최소 입찰가는 ${formatKRW(minimumBid)}이에요.`);
      throw new Error("Bid amount is stale or invalid");
    }

    const bidRecord: BidHistoryRecord = Object.freeze({
      id: `bid-local-${Date.now()}`,
      bidderName: MOCK_BIDDER_IDENTITY,
      amount,
      bidAt: new Date().toISOString(),
    });

    setPosts((currentPosts) =>
      currentPosts.map((post) =>
        post.id === postId
          ? {
              ...post,
              currentPrice: amount,
              participantCount: post.bidHistory.some(
                (bid) => bid.bidderName === MOCK_BIDDER_IDENTITY,
              )
                ? post.participantCount
                : post.participantCount + 1,
              bidHistory: Object.freeze([bidRecord, ...post.bidHistory]),
            }
          : post,
      ),
    );

    // TODO: DB 연동 필요 - Firebase/서버의 입찰 트랜잭션 호출 위치입니다.
    showToast(`${target?.title ?? "선택한 상품"}에 ${formatKRW(amount)}으로 입찰했어요.`);
  };

  const appendChatMessage = async (threadId: string, text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const sentAt = new Date().toISOString();
    const message: ChatMessage = {
      id: `chat-local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sender: "me",
      text: trimmedText,
      sentAt,
    };

    setChatThreadState((currentThreads) =>
      currentThreads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              lastMessage: trimmedText,
              lastMessageAt: sentAt,
              messages: [...thread.messages, message],
            }
          : thread,
      ),
    );

    // TODO: DB 연동 필요 - 실제 1:1 채팅 메시지 전송 API를 연결하세요.
  };

  const handleRegisterShipment = async (
    payload: ShipmentRegistrationPayload,
  ) => {
    const isExternalMockBatch = adminShipmentState.some(
      (batch) => batch.id === payload.batchId && batch.status === "packing",
    );

    await registerShipment(payload);
    commitAdminShipments((current) =>
      current.map((batch) =>
        batch.id === payload.batchId && batch.status === "packing"
          ? {
              ...batch,
              status: "shipped",
              courier: payload.courier,
              trackingNumber: payload.trackingNumber.replace(/\D/g, ""),
              shippedAt: payload.shippedAt,
            }
          : batch,
      ),
    );

    if (isExternalMockBatch) {
      showToast(
        "송장이 등록되어 발송 완료 영역과 구매자 배송 현황에 반영되었습니다.",
      );
    }
    // TODO: DB 연동 필요 - 실제 운영에서는 물류 배치와 모든 구매자 프로필을
    // 동일 서버 트랜잭션으로 갱신하고 실시간 구독으로 각 화면에 전달합니다.
  };

  const handleSendCustomerMessage = async (
    payload: AdminCustomerChatPayload,
  ) => {
    const text = payload.text.trim();
    if (!text) return;

    const sentAt = new Date().toISOString();
    const messageId = `admin-cs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    setAdminCustomerChatState((current) => {
      const existing = current.find(
        (thread) => thread.userId === payload.userId,
      );
      if (!existing) {
        return [
          ...current,
          {
            id: `admin-chat-${payload.userId}`,
            userId: payload.userId,
            customerName: payload.customerName,
            online: false,
            lastMessage: text,
            lastMessageAt: sentAt,
            messages: [
              { id: messageId, sender: "admin", text, sentAt },
            ],
          },
        ];
      }

      return current.map((thread) =>
        thread.userId === payload.userId
          ? {
              ...thread,
              lastMessage: text,
              lastMessageAt: sentAt,
              messages: [
                ...thread.messages,
                { id: messageId, sender: "admin" as const, text, sentAt },
              ],
            }
          : thread,
      );
    });

    if (payload.userId === profile.id) {
      setChatThreadState((current) =>
        current.map((thread) =>
          thread.id === AUCTION_HOST_THREAD_ID
            ? {
                ...thread,
                lastMessage: text,
                lastMessageAt: sentAt,
                unread: thread.unread + 1,
                messages: [
                  ...thread.messages,
                  { id: messageId, sender: "admin" as const, text, sentAt },
                ],
              }
            : thread,
        ),
      );
    }

    // TODO: DB 연동 필요 - 고객별 1:1 CS 방에 관리자 메시지를 저장하고
    // 해당 고객의 채팅 구독으로 즉시 전달합니다.
    showToast(`${payload.customerName} 고객에게 메시지를 보냈습니다.`);
  };

  const handleProductInquiry = async (postId: string, message: string) => {
    const target = posts.find((post) => post.id === postId);
    const trimmedMessage = message.trim();

    if (!target || !trimmedMessage) {
      throw new Error("문의할 상품 또는 문의 내용이 없습니다.");
    }

    const descriptionLead =
      target.description
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? target.title;
    const inquiryText = [
      `[상품 문의 · ${target.id}]`,
      descriptionLead,
      "",
      trimmedMessage,
    ].join("\n");

    await appendChatMessage(AUCTION_HOST_THREAD_ID, inquiryText);

    // 현재 상품 피드의 activePage는 변경하지 않습니다.
    showToast("관리자에게 문의가 전송되었습니다.");
  };

  const handleCreateAuction = async (draft: NewAuctionDraft) => {
    await createProduct(draft);
    await refreshProducts();
    if (draft.status === "active") setActivePage("feed");

    showToast(
      draft.status === "pending"
        ? "새 경매글을 다음날 오전 10시 공개로 예약했어요."
        : "새 경매글이 피드 가장 위에 등록됐어요.",
    );
  };

  const handleRoleChange = (nextRole: Role) => {
    if (nextRole === "admin" && !isAdminAuthenticated) {
      setAdminLoginOpen(true);
      return;
    }

    setRole(nextRole);
    showToast(nextRole === "admin" ? "운영자 모드로 전환했어요." : "일반 사용자 모드로 전환했어요.");
  };

  const handleAdminAuthenticated = () => {
    setIsAdminAuthenticated(true);
    setAdminLoginOpen(false);
    setRole("admin");
    showToast("Supabase 관리자 인증을 완료했어요.");
  };

  const handleAdminSignOut = async () => {
    setIsAdminSigningOut(true);

    try {
      await signOutSupabaseAdmin();
      setIsAdminAuthenticated(false);
      setRole("user");
      setActivePage("feed");
      setNewAuctionOpen(false);
      showToast("관리자 로그아웃을 완료했어요.");
    } catch (signOutError) {
      showToast(
        signOutError instanceof Error
          ? signOutError.message
          : "관리자 로그아웃을 완료하지 못했어요.",
      );
    } finally {
      setIsAdminSigningOut(false);
    }
  };

  const renderPage = () => {
    if (activePage === "chat") {
      return (
        <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
          <ChatPage threads={chatThreadState} onSendMessage={appendChatMessage} />
        </main>
      );
    }

    if (activePage === "profile") {
      return (
        <ProfilePage
          user={profile}
          wonAuctions={wonAuctionState}
          paymentAccount={paymentAccount}
          onSaveProfile={saveProfile}
          onBatchPaymentStart={startBatchPayment}
          onBatchPaymentComplete={completeBatchPayment}
          onShippingCreditComplete={completeShippingCredit}
          onShippingRequest={requestShipping}
        />
      );
    }

    if (activePage === "admin") {
      return role === "admin" ? (
        <AdminPage
          sales={salesWithCurrentProfile}
          shipments={shipmentBatches}
          onRegisterShipment={handleRegisterShipment}
          customerChats={adminCustomerChatState}
          onSendCustomerMessage={handleSendCustomerMessage}
          onNotify={showToast}
        />
      ) : (
        <AdminAccessGate onSwitchToAdmin={() => handleRoleChange("admin")} />
      );
    }

    return (
      <main className="mx-auto w-full max-w-[1800px] px-3 pb-28 pt-6 sm:px-4 sm:pt-8 lg:px-5 lg:pb-12">
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_235px] xl:grid-cols-[170px_minmax(0,1fr)_235px] xl:gap-4">
          <OnlineMembersSidebar className="hidden xl:block" />

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
                    오후 8시 56분부터 기존 참여자만 입찰할 수 있고 오후 9시에 마감됩니다. 모든 입찰은 취소할 수 없으며 시간과 금액이 기록됩니다.
                  </p>
                </div>
                <span className="w-fit shrink-0 rounded-full bg-[#e4f0f3] px-4 py-2 text-sm font-bold text-[#517783]">
                  매일 약 100벌 · 20:56 신규 참여 제한
                </span>
              </div>
            </section>

            <FeedList
              posts={posts}
              currentUserName={MOCK_BIDDER_IDENTITY}
              onBid={handleBid}
              onInquiry={handleProductInquiry}
              isLoading={productsLoading}
              loadError={productsError}
              onRetry={refreshProducts}
            />
          </div>

          <LiveBidSidebar
            posts={posts}
            currentUserName={MOCK_BIDDER_IDENTITY}
            onBid={handleBid}
            className="hidden lg:block"
          />
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
          onRoleChange={handleRoleChange}
          onCreateAuction={() => setNewAuctionOpen(true)}
          isAdminAuthenticated={isAdminAuthenticated}
          isAdminSigningOut={isAdminSigningOut}
          onAdminSignOut={handleAdminSignOut}
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
        open={newAuctionOpen}
        onClose={() => setNewAuctionOpen(false)}
        onSubmit={handleCreateAuction}
      />

      <AdminLoginModal
        open={adminLoginOpen}
        onClose={() => setAdminLoginOpen(false)}
        onAuthenticated={handleAdminAuthenticated}
      />

      <FloatingAdminChat
        thread={chatThreadState.find(
          (thread) => thread.id === AUCTION_HOST_THREAD_ID,
        )}
        onSendMessage={appendChatMessage}
      />

      <Toast
        message={toastMessage}
        visible={Boolean(toastMessage)}
        onDismiss={() => setToastMessage("")}
      />
    </div>
  );
}
