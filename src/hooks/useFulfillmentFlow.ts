"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  BatchPaymentCompletionPayload,
  BatchPaymentStartPayload,
  ShippingCreditCompletionPayload,
  ShipmentRegistrationPayload,
  ShippingRequestPayload,
  UserProfile,
  WonAuction,
} from "@/src/types/auction";
import {
  formatShippingDispatchNotice,
  getKeepExpiration,
  getNextShippingDispatchDate,
  SHIPPING_FEE,
} from "@/src/utils/shipping";

export const SHIPPING_COUNT_SHORTAGE_MESSAGE =
  "택배 가능 횟수가 부족합니다. 택배비 선결제를 진행해 주세요.";

interface UseFulfillmentFlowOptions {
  initialProfile: UserProfile;
  initialAuctions: WonAuction[];
  profileStorageKey: string;
  auctionStorageKey?: string;
  onNotify: (message: string) => void;
}

function normalizeStoredProfile(
  stored: Partial<UserProfile>,
  fallback: UserProfile,
): UserProfile | null {
  if (!stored.name || !stored.phone || !stored.address) return null;

  const storedAddresses = Array.isArray(stored.shippingAddresses)
    ? stored.shippingAddresses
    : [];
  const fallbackDefault = fallback.shippingAddresses.find(
    (address) => address.isDefault,
  );
  const storedDefaultIndex = storedAddresses.findIndex(
    (address) => address.isDefault,
  );
  const shippingAddresses =
    storedAddresses.length === 0
      ? [
          {
            id: fallbackDefault?.id ?? "address-home",
            label: fallbackDefault?.label ?? "기본 배송지",
            recipientName: stored.name,
            phone: stored.phone,
            address: stored.address,
            isDefault: true,
          },
        ]
      : storedDefaultIndex < 0
        ? [
            {
              id: "address-migrated-default",
              label: fallbackDefault?.label ?? "기본 배송지",
              recipientName: stored.name,
              phone: stored.phone,
              address: stored.address,
              isDefault: true,
            },
            ...storedAddresses.map((address) => ({
              ...address,
              isDefault: false,
            })),
          ]
        : storedAddresses.map((address, index) => ({
            ...address,
            isDefault: index === storedDefaultIndex,
          }));

  return {
    ...fallback,
    ...stored,
    shippingCount:
      Number.isInteger(stored.shippingCount) && Number(stored.shippingCount) >= 0
        ? Number(stored.shippingCount)
        : fallback.shippingCount,
    shippingAddresses,
  };
}

/**
 * 결제와 택배 접수를 의도적으로 분리한 로컬 데모 상태 흐름입니다.
 * 실제 운영에서는 각 콜백의 TODO 위치를 서버의 원자적 트랜잭션으로 교체합니다.
 */
export function useFulfillmentFlow({
  initialProfile,
  initialAuctions,
  profileStorageKey,
  auctionStorageKey = `${profileStorageKey}-won-auctions`,
  onNotify,
}: UseFulfillmentFlowOptions) {
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [auctions, setAuctions] = useState<WonAuction[]>(initialAuctions);

  useEffect(() => {
    const savedProfile = window.localStorage.getItem(profileStorageKey);
    if (!savedProfile) return;

    let restoreTimer: number | undefined;

    try {
      const normalized = normalizeStoredProfile(
        JSON.parse(savedProfile) as Partial<UserProfile>,
        initialProfile,
      );
      if (normalized) {
        restoreTimer = window.setTimeout(() => setProfile(normalized), 0);
      }
    } catch {
      window.localStorage.removeItem(profileStorageKey);
    }

    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    };
  }, [initialProfile, profileStorageKey]);

  useEffect(() => {
    const savedAuctions = window.localStorage.getItem(auctionStorageKey);
    if (!savedAuctions) return;

    let restoreTimer: number | undefined;
    try {
      const parsed = JSON.parse(savedAuctions) as unknown;
      if (Array.isArray(parsed)) {
        const storedAuctions = parsed as WonAuction[];
        const storedById = new Map(
          storedAuctions.map((auction) => [auction.id, auction]),
        );
        const initialIds = new Set(initialAuctions.map((auction) => auction.id));
        const mergedAuctions = [
          ...initialAuctions.map(
            (auction) => storedById.get(auction.id) ?? auction,
          ),
          ...storedAuctions.filter((auction) => !initialIds.has(auction.id)),
        ];
        restoreTimer = window.setTimeout(
          () => setAuctions(mergedAuctions),
          0,
        );
      }
    } catch {
      window.localStorage.removeItem(auctionStorageKey);
    }

    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    };
  }, [auctionStorageKey, initialAuctions]);

  const commitProfile = useCallback(
    (update: (current: UserProfile) => UserProfile) => {
      setProfile((current) => {
        const next = update(current);
        window.localStorage.setItem(profileStorageKey, JSON.stringify(next));
        return next;
      });
    },
    [profileStorageKey],
  );

  const commitAuctions = useCallback(
    (update: (current: WonAuction[]) => WonAuction[]) => {
      setAuctions((current) => {
        const next = update(current);
        window.localStorage.setItem(auctionStorageKey, JSON.stringify(next));
        return next;
      });
    },
    [auctionStorageKey],
  );

  const saveProfile = useCallback(
    async (updatedProfile: UserProfile) => {
      commitProfile(() => updatedProfile);
      // TODO: DB 연동 필요 - 사용자 배송 정보와 택배 이용권은 서버에서 함께 저장합니다.
      onNotify("배송 정보가 저장되어 관리자 판매 목록에도 반영되었습니다.");
    },
    [commitProfile, onNotify],
  );

  const startBatchPayment = useCallback(
    async (payload: BatchPaymentStartPayload) => {
      const auctionIds = new Set(payload.auctionIds);
      commitAuctions((current) =>
        current.map((auction) =>
          auctionIds.has(auction.id) && auction.paymentStatus === "pending"
            ? {
                ...auction,
                paymentStartedAt:
                  auction.paymentStartedAt ?? payload.startedAt,
              }
            : auction,
        ),
      );
      // TODO: DB 연동 필요 - 일괄 결제 배치와 계좌 조회 이력을 서버에 기록합니다.
    },
    [commitAuctions],
  );

  const completeBatchPayment = useCallback(
    async (payload: BatchPaymentCompletionPayload) => {
      const auctionIds = new Set(payload.auctionIds);
      const targets = auctions.filter(
        (auction) =>
          auctionIds.has(auction.id) && auction.paymentStatus === "pending",
      );
      if (targets.length === 0) return;

      commitAuctions((current) =>
        current.map((auction) =>
          auctionIds.has(auction.id) && auction.paymentStatus === "pending"
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
        commitProfile((current) => ({
          ...current,
          shippingCount: current.shippingCount + 1,
        }));
      }

      // TODO: DB 연동 필요 - 입금 승인, Keep 이동, 이용권 적립을 한 트랜잭션으로 처리합니다.
      onNotify(
        payload.includeShippingFee
          ? `${targets.length}개 상품 결제 완료! Keep 보관함으로 이동했고 택배 가능 횟수가 1회 추가되었습니다.`
          : `${targets.length}개 상품 결제 완료! Keep 보관함으로 이동했습니다.`,
      );
    },
    [auctions, commitAuctions, commitProfile, onNotify],
  );

  const completeShippingCredit = useCallback(
    async (payload: ShippingCreditCompletionPayload) => {
      if (payload.amount !== SHIPPING_FEE) {
        throw new Error("택배 이용권은 4,000원 입금 확인 후에만 충전할 수 있습니다.");
      }
      commitProfile((current) => ({
        ...current,
        shippingCount: current.shippingCount + 1,
      }));
      // TODO: DB 연동 필요 - 택배비 입금 승인 후 이용권 원장을 append-only로 기록합니다.
      onNotify("택배비 입금 완료! 택배 가능 횟수가 1회 추가되었습니다.");
    },
    [commitProfile, onNotify],
  );

  const requestShipping = useCallback(
    async (payload: ShippingRequestPayload) => {
      if (profile.shippingCount <= 0) {
        throw new Error(SHIPPING_COUNT_SHORTAGE_MESSAGE);
      }

      const savedAddress = profile.shippingAddresses.find(
        (address) => address.id === payload.shippingAddress.id,
      );
      if (!savedAddress) {
        throw new Error("선택한 배송지를 찾을 수 없습니다. 배송지 목록을 다시 확인해 주세요.");
      }

      const itemIds = new Set(payload.itemIds);
      const scheduledAt = getNextShippingDispatchDate(payload.requestedAt);
      const requestableCount = auctions.filter(
        (auction) => itemIds.has(auction.id) && auction.stage === "keep",
      ).length;
      if (requestableCount === 0) {
        throw new Error("택배로 접수할 보관 상품을 선택해 주세요.");
      }

      const shipmentBatchId = `shipment-batch-${Date.parse(payload.requestedAt)}-${payload.itemIds[0]}`;

      commitAuctions((current) =>
        current.map((auction) =>
          itemIds.has(auction.id) && auction.stage === "keep"
            ? {
                ...auction,
                stage: "shipping-requested",
                shipmentBatchId,
                shippingRequestedAt: payload.requestedAt,
                shippingScheduledAt: scheduledAt,
                shippingAddress: { ...savedAddress },
              }
            : auction,
        ),
      );
      commitProfile((current) => ({
        ...current,
        shippingCount: Math.max(0, current.shippingCount - 1),
      }));

      // TODO: DB 연동 필요 - 선택 상품 스냅샷, 이용권 차감, 관리자 발송 대기열 생성을
      // 한 트랜잭션으로 묶어 중복 접수를 방지합니다.
      onNotify(formatShippingDispatchNotice(scheduledAt));
    },
    [
      auctions,
      commitAuctions,
      commitProfile,
      onNotify,
      profile.shippingAddresses,
      profile.shippingCount,
    ],
  );

  const registerShipment = useCallback(
    async (payload: ShipmentRegistrationPayload) => {
      const trackingNumber = payload.trackingNumber.replace(/\D/g, "");
      if (trackingNumber.length < 10 || trackingNumber.length > 14) {
        throw new Error("한진택배 송장번호를 숫자 10~14자리로 입력해 주세요.");
      }

      const updatedCount = auctions.filter(
        (auction) =>
          auction.shipmentBatchId === payload.batchId &&
          auction.stage === "shipping-requested",
      ).length;
      if (updatedCount === 0) return;

      commitAuctions((current) =>
        current.map((auction) => {
          if (
            auction.shipmentBatchId !== payload.batchId ||
            auction.stage !== "shipping-requested"
          ) {
            return auction;
          }
          return {
            ...auction,
            stage: "shipped",
            courier: payload.courier,
            trackingNumber,
            shippedAt: payload.shippedAt,
          };
        }),
      );

      // TODO: DB 연동 필요 - 관리자 송장 등록과 구매자 배송 상태 갱신을
      // 서버 트랜잭션 및 실시간 구독으로 원자적으로 동기화합니다.
      onNotify(
        `${updatedCount}벌의 한진택배 송장이 등록되어 구매자 배송 현황에 반영되었습니다.`,
      );
    },
    [auctions, commitAuctions, onNotify],
  );

  return {
    profile,
    auctions,
    saveProfile,
    startBatchPayment,
    completeBatchPayment,
    completeShippingCredit,
    requestShipping,
    registerShipment,
  };
}
