"use client";

import { useMemo, useState } from "react";

import type {
  AdminCustomerChatPayload,
  AdminCustomerChatThread,
  AdminSaleRecord,
  AdminShipmentBatch,
  BuyerInfo,
  ShipmentRegistrationPayload,
} from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";

import { AdminCsChatModal } from "./AdminCsChatModal";
import { AdminShipmentBoard } from "./AdminShipmentBoard";
import { buildRecentSevenClosingDays, buildShipmentBatchesFromSales } from "./adminUtils";
import { PickingPreviewModal } from "./PickingPreviewModal";
import { RecentClosingList } from "./RecentClosingList";
import { ShipmentRegistrationModal } from "./ShipmentRegistrationModal";

export interface AdminPageProps {
  sales: readonly AdminSaleRecord[];
  shipments?: readonly AdminShipmentBatch[];
  customerChats?: readonly AdminCustomerChatThread[];
  onRegisterShipment?: (
    payload: ShipmentRegistrationPayload,
  ) => void | Promise<void>;
  onSendCustomerMessage?: (
    payload: AdminCustomerChatPayload,
  ) => void | Promise<void>;
  onNotify?: (message: string) => void;
}

export function AdminPage({
  sales,
  shipments,
  customerChats = [],
  onRegisterShipment,
  onSendCustomerMessage,
  onNotify,
}: AdminPageProps) {
  const [fallbackShipments, setFallbackShipments] = useState<
    AdminShipmentBatch[]
  >(() => buildShipmentBatchesFromSales(sales));
  const [fallbackChats, setFallbackChats] = useState<
    AdminCustomerChatThread[]
  >([]);
  const [previewBatch, setPreviewBatch] =
    useState<AdminShipmentBatch | null>(null);
  const [registrationBatch, setRegistrationBatch] =
    useState<AdminShipmentBatch | null>(null);
  const [chatBuyer, setChatBuyer] = useState<BuyerInfo | null>(null);

  const shipmentBatches = shipments ?? fallbackShipments;
  const chatThreads = customerChats.length > 0 ? customerChats : fallbackChats;

  const salesWithLiveShippingStatus = useMemo(() => {
    const shippedAuctionIds = new Set(
      shipmentBatches
        .filter((batch) => batch.status === "shipped")
        .flatMap((batch) => batch.items.map((item) => item.auctionId)),
    );
    const packingAuctionIds = new Set(
      shipmentBatches
        .filter((batch) => batch.status === "packing")
        .flatMap((batch) => batch.items.map((item) => item.auctionId)),
    );

    return sales.map((sale) => {
      if (shippedAuctionIds.has(sale.auctionId)) {
        return {
          ...sale,
          stage: "shipped" as const,
          shippingStatus: "shipped" as const,
        };
      }
      if (packingAuctionIds.has(sale.auctionId)) {
        return {
          ...sale,
          stage: "shipping-requested" as const,
          shippingStatus: "ready" as const,
        };
      }
      return sale;
    });
  }, [sales, shipmentBatches]);

  const recentDays = useMemo(
    () => buildRecentSevenClosingDays(salesWithLiveShippingStatus),
    [salesWithLiveShippingStatus],
  );
  const totalSales = salesWithLiveShippingStatus.reduce(
    (sum, sale) => sum + sale.winningBid,
    0,
  );
  const pendingPayments = salesWithLiveShippingStatus.filter(
    (sale) => sale.paymentStatus === "pending",
  ).length;
  const packingCount = shipmentBatches.filter(
    (batch) => batch.status === "packing",
  ).length;

  const activeChatThread = chatBuyer
    ? chatThreads.find((thread) => thread.userId === chatBuyer.userId)
    : undefined;

  const handleRegisterShipment = async (
    payload: ShipmentRegistrationPayload,
  ) => {
    if (onRegisterShipment) {
      await onRegisterShipment(payload);
    } else {
      setFallbackShipments((current) =>
        current.map((batch) =>
          batch.id === payload.batchId
            ? {
                ...batch,
                status: "shipped",
                courier: payload.courier,
                trackingNumber: payload.trackingNumber,
                shippedAt: payload.shippedAt,
              }
            : batch,
        ),
      );
    }

    onNotify?.("송장이 등록되어 배송 중 / 발송 완료 영역으로 이동했습니다.");
  };

  const handleSendCustomerMessage = async (
    payload: AdminCustomerChatPayload,
  ) => {
    if (onSendCustomerMessage) {
      await onSendCustomerMessage(payload);
      return;
    }

    const sentAt = new Date().toISOString();
    setFallbackChats((current) => {
      const existing = current.find((thread) => thread.userId === payload.userId);
      const message = {
        id: `admin-cs-local-${Date.now()}`,
        sender: "admin" as const,
        text: payload.text,
        sentAt,
      };

      if (!existing) {
        return [
          ...current,
          {
            id: `admin-chat-${payload.userId}`,
            userId: payload.userId,
            customerName: payload.customerName,
            lastMessage: payload.text,
            lastMessageAt: sentAt,
            messages: [message],
          },
        ];
      }

      return current.map((thread) =>
        thread.userId === payload.userId
          ? {
              ...thread,
              lastMessage: payload.text,
              lastMessageAt: sentAt,
              messages: [...thread.messages, message],
            }
          : thread,
      );
    });
    onNotify?.(`${payload.customerName} 고객에게 메시지를 보냈습니다.`);
  };

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
      <header className="mb-7 flex flex-col gap-5 sm:mb-9 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[17px] font-black tracking-[0.15em] text-[#688493]">
            ADMIN LOGISTICS &amp; CS
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-[#493b31] sm:text-4xl">
            다미네 구제 관리자 페이지
          </h1>
          <p className="mt-3 max-w-3xl text-[17px] font-bold leading-8 text-[#796b60]">
            합배송 피킹부터 송장 등록, 최근 7일 낙찰 고객 CS까지 한 화면에서 처리합니다.
          </p>
        </div>
        <span className="w-fit rounded-full border-2 border-[#e5d5c4] bg-[#fffaf3] px-4 py-2 text-[17px] font-black text-[#8a7060] shadow-sm">
          운영자 전용
        </span>
      </header>

      <section
        aria-label="관리자 운영 현황 요약"
        className="mb-8 grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4"
      >
        <article className="rounded-[1.5rem] border-2 border-[#eadfce] bg-[#fffaf3] p-5">
          <p className="text-[17px] font-black text-[#8c7b6e]">최근 낙찰</p>
          <p className="mt-2 text-3xl font-black text-[#493b31]">
            {salesWithLiveShippingStatus.length}
            <span className="ml-1 text-[17px]">벌</span>
          </p>
        </article>
        <article className="rounded-[1.5rem] border-2 border-[#cbdde5] bg-[#e4f0f5] p-5">
          <p className="text-[17px] font-black text-[#66808e]">총 낙찰 금액</p>
          <p className="mt-2 text-2xl font-black text-[#3e5b69]">
            {formatKRW(totalSales)}
          </p>
        </article>
        <article className="rounded-[1.5rem] border-2 border-[#efd2c8] bg-[#fbe4dc] p-5">
          <p className="text-[17px] font-black text-[#9f6659]">입금 확인 필요</p>
          <p className="mt-2 text-3xl font-black text-[#b96351]">
            {pendingPayments}
            <span className="ml-1 text-[17px]">건</span>
          </p>
        </article>
        <article className="rounded-[1.5rem] border-2 border-[#b9d9c8] bg-[#e5f4eb] p-5">
          <p className="text-[17px] font-black text-[#557866]">포장 대기</p>
          <p className="mt-2 text-3xl font-black text-[#35684f]">
            {packingCount}
            <span className="ml-1 text-[17px]">건</span>
          </p>
        </article>
      </section>

      <AdminShipmentBoard
        batches={shipmentBatches}
        onOpenPreview={setPreviewBatch}
        onOpenRegistration={setRegistrationBatch}
      />

      <div className="my-10 h-px bg-[#dfd2c4]" />

      <RecentClosingList
        days={recentDays}
        onOpenChat={setChatBuyer}
      />

      <PickingPreviewModal
        batch={previewBatch}
        onClose={() => setPreviewBatch(null)}
      />
      <ShipmentRegistrationModal
        batch={registrationBatch}
        onRegister={handleRegisterShipment}
        onClose={() => setRegistrationBatch(null)}
      />
      <AdminCsChatModal
        buyer={chatBuyer}
        thread={activeChatThread}
        onSendMessage={handleSendCustomerMessage}
        onClose={() => setChatBuyer(null)}
      />
    </main>
  );
}
