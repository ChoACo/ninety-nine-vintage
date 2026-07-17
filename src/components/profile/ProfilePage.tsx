"use client";

import { useMemo, useState } from "react";

import type {
  BatchPaymentCompletionPayload,
  BatchPaymentStartPayload,
  PaymentAccount,
  ShippingCreditCompletionPayload,
  ShippingRequestPayload,
  UserProfile,
  WonAuction,
} from "@/src/types/auction";
import { getKeepExpiration } from "@/src/utils/shipping";

import { KeepStorage } from "./KeepStorage";
import { PaymentModal } from "./PaymentModal";
import { PaymentSummary } from "./PaymentSummary";
import { ShipmentStatusBoard } from "./ShipmentStatusBoard";
import { ShippingCreditModal } from "./ShippingCreditModal";
import { ShippingWallet } from "./ShippingWallet";
import { UserInfoForm } from "./UserInfoForm";
import { WonAuctionList } from "./WonAuctionList";

export interface ProfilePageProps {
  user: UserProfile;
  wonAuctions: readonly WonAuction[];
  paymentAccount: PaymentAccount;
  onSaveProfile?: (profile: UserProfile) => void | Promise<void>;
  onBatchPaymentStart?: (
    payload: BatchPaymentStartPayload,
  ) => void | Promise<void>;
  onBatchPaymentComplete?: (
    payload: BatchPaymentCompletionPayload,
  ) => void | Promise<void>;
  onShippingCreditComplete?: (
    payload: ShippingCreditCompletionPayload,
  ) => void | Promise<void>;
  onShippingRequest?: (
    payload: ShippingRequestPayload,
  ) => void | Promise<void>;
}

function normalizeProfile(profile: UserProfile): UserProfile {
  return {
    ...profile,
    shippingCount:
      Number.isInteger(profile.shippingCount) && profile.shippingCount >= 0
        ? profile.shippingCount
        : 0,
    shippingAddresses: Array.isArray(profile.shippingAddresses)
      ? profile.shippingAddresses
      : [],
  };
}

export function ProfilePage({
  user,
  wonAuctions,
  paymentAccount,
  onSaveProfile,
  onBatchPaymentStart,
  onBatchPaymentComplete,
  onShippingCreditComplete,
  onShippingRequest,
}: ProfilePageProps) {
  const [localProfile, setLocalProfile] = useState<UserProfile>(() =>
    normalizeProfile(user),
  );
  const [localAuctions, setLocalAuctions] = useState<WonAuction[]>(() =>
    wonAuctions.map((auction) => ({ ...auction })),
  );
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [shippingCreditOpen, setShippingCreditOpen] = useState(false);
  const [includeShippingFee, setIncludeShippingFee] = useState(true);

  /**
   * 네 가지 거래 콜백을 모두 전달하면 AuctionApp 상태를 단일 진실 공급원으로
   * 사용하고, 정적 컴포넌트 데모에서는 내부 상태로 동일한 흐름을 실행합니다.
   */
  const controlledFlow = Boolean(
    onBatchPaymentStart &&
      onBatchPaymentComplete &&
      onShippingCreditComplete &&
      onShippingRequest,
  );
  const profile = controlledFlow ? normalizeProfile(user) : localProfile;
  const auctions = controlledFlow ? wonAuctions : localAuctions;

  const pendingAuctions = useMemo(
    () =>
      auctions.filter(
        (auction) =>
          auction.stage === "payment-pending" &&
          auction.paymentStatus === "pending",
      ),
    [auctions],
  );
  const keepItems = useMemo(
    () => auctions.filter((auction) => auction.stage === "keep"),
    [auctions],
  );
  const shippingRequestedItems = useMemo(
    () => auctions.filter((auction) => auction.stage === "shipping-requested"),
    [auctions],
  );
  const shippedItems = useMemo(
    () => auctions.filter((auction) => auction.stage === "shipped"),
    [auctions],
  );

  const handleSaveProfile = async (savedProfile: UserProfile) => {
    await onSaveProfile?.(savedProfile);
    if (!controlledFlow) setLocalProfile(normalizeProfile(savedProfile));
  };

  const openBatchPayment = async (
    targets: readonly WonAuction[],
    startIfNeeded: boolean,
  ) => {
    if (targets.length === 0) return;

    setIncludeShippingFee(true);

    if (startIfNeeded && !targets.some((auction) => auction.paymentStartedAt)) {
      const payload: BatchPaymentStartPayload = Object.freeze({
        auctionIds: Object.freeze(targets.map((auction) => auction.id)),
        startedAt: new Date().toISOString(),
      });

      // TODO: DB 연동 필요 — 일괄 결제 세션과 계좌 조회 이력을 서버에 기록합니다.
      await onBatchPaymentStart?.(payload);

      if (!controlledFlow) {
        const ids = new Set(payload.auctionIds);
        setLocalAuctions((current) =>
          current.map((auction) =>
            ids.has(auction.id)
              ? { ...auction, paymentStartedAt: payload.startedAt }
              : auction,
          ),
        );
      }
    }

    setPaymentOpen(true);
  };

  const handleBatchPaymentComplete = async (
    payload: BatchPaymentCompletionPayload,
  ) => {
    // TODO: DB 연동 필요 — 전체 입금 승인, Keep 이동, 이용권 적립을 서버
    // 트랜잭션 한 건으로 처리해야 일부 상품만 결제되는 상태를 막을 수 있습니다.
    await onBatchPaymentComplete?.(payload);

    if (!controlledFlow) {
      const ids = new Set(payload.auctionIds);
      setLocalAuctions((current) =>
        current.map((auction) =>
          ids.has(auction.id)
            ? {
                ...auction,
                paymentStatus: "paid",
                stage: "keep",
                paymentStartedAt:
                  auction.paymentStartedAt ?? payload.completedAt,
                paidAt: payload.completedAt,
                keepExpiresAt: getKeepExpiration(
                  payload.completedAt,
                  auction.isBulky,
                ),
              }
            : auction,
        ),
      );
      if (payload.includeShippingFee) {
        setLocalProfile((current) => ({
          ...current,
          shippingCount: current.shippingCount + 1,
        }));
      }
    }

    setPaymentOpen(false);
  };

  const handleShippingCreditComplete = async (
    payload: ShippingCreditCompletionPayload,
  ) => {
    await onShippingCreditComplete?.(payload);

    if (!controlledFlow) {
      setLocalProfile((current) => ({
        ...current,
        shippingCount: current.shippingCount + 1,
      }));
    }

    setShippingCreditOpen(false);
  };

  const handleShippingRequest = async (payload: ShippingRequestPayload) => {
    // TODO: DB 연동 필요 — 배송지 스냅샷, 이용권 차감, 발송 대기열 등록을
    // idempotency key가 있는 서버 트랜잭션으로 처리합니다.
    await onShippingRequest?.(payload);

    if (!controlledFlow) {
      const requestedIds = new Set(payload.itemIds);

      setLocalProfile((current) => ({
        ...current,
        shippingCount: Math.max(0, current.shippingCount - 1),
      }));
      setLocalAuctions((current) =>
        current.map((auction) =>
          requestedIds.has(auction.id) && auction.stage === "keep"
            ? {
                ...auction,
                stage: "shipping-requested",
                shippingRequestedAt: payload.requestedAt,
                shippingScheduledAt: payload.scheduledAt,
                shippingAddress: { ...payload.shippingAddress },
              }
            : auction,
        ),
      );
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 text-[17px] sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
      <header className="mb-6 sm:mb-8">
        <p className="font-bold tracking-[0.18em] text-[#c87967]">MY AUCTION ROOM</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-[#493b31] sm:text-4xl">
          내 정보
        </h1>
        <p className="mt-3 max-w-3xl text-[17px] font-semibold leading-7 text-[#796b60]">
          입금 대기 상품은 한 번에 결제하고, 결제가 끝난 상품은 Keep 보관함에서
          배송지를 확인한 뒤 안전하게 택배 접수해 주세요.
        </p>
      </header>

      <ShippingWallet
        shippingCount={profile.shippingCount}
        onRecharge={() => setShippingCreditOpen(true)}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <UserInfoForm user={profile} onSave={handleSaveProfile} />
        <PaymentSummary auctions={auctions} />
      </div>

      <div className="mt-10">
        <WonAuctionList
          auctions={auctions}
          onStartBatchPayment={(targets) =>
            void openBatchPayment(targets, true)
          }
          onViewAccount={(targets) => void openBatchPayment(targets, false)}
        />
      </div>

      <KeepStorage
        items={keepItems}
        shippingCount={profile.shippingCount}
        addresses={profile.shippingAddresses}
        onRequestShipping={handleShippingRequest}
        onOpenRecharge={() => setShippingCreditOpen(true)}
      />

      <ShipmentStatusBoard
        requestedItems={shippingRequestedItems}
        shippedItems={shippedItems}
      />

      <PaymentModal
        open={paymentOpen}
        auctions={pendingAuctions}
        account={paymentAccount}
        includeShippingFee={includeShippingFee}
        onIncludeShippingFeeChange={setIncludeShippingFee}
        onClose={() => setPaymentOpen(false)}
        onComplete={handleBatchPaymentComplete}
      />

      <ShippingCreditModal
        open={shippingCreditOpen}
        account={paymentAccount}
        onClose={() => setShippingCreditOpen(false)}
        onComplete={handleShippingCreditComplete}
      />
    </main>
  );
}
