"use client";

import { useEffect, useMemo, useState } from "react";

import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import type {
  ShippingAddress,
  ShippingRequestPayload,
  WonAuction,
} from "@/src/types/auction";
import {
  formatShippingDispatchNotice,
  getNextShippingDispatchDate,
} from "@/src/utils/shipping";

import { KeepAllModal } from "./KeepAllModal";
import { KeepItemCard } from "./KeepItemCard";
import { ShippingAddressSelectModal } from "./ShippingAddressSelectModal";
import {
  getKeepItemExpiration,
  sortKeepItemsByExpiration,
} from "./keepStorageUtils";

interface KeepStorageProps {
  items: readonly WonAuction[];
  shippingCount: number;
  /** 기본 배송지와 사용자가 추가한 배송지를 모두 전달합니다. */
  addresses?: readonly ShippingAddress[];
  onRequestShipping: (
    payload: ShippingRequestPayload,
  ) => void | Promise<void>;
  onOpenRecharge: () => void;
}

const KEEP_PREVIEW_LIMIT = 6;

export function KeepStorage({
  items,
  shippingCount,
  addresses = [],
  onRequestShipping,
  onOpenRecharge,
}: KeepStorageProps) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [now, setNow] = useState(() => new Date());
  const [allOpen, setAllOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [shortageOpen, setShortageOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const sortedItems = useMemo(
    () => sortKeepItemsByExpiration(items),
    [items],
  );
  const previewItems = sortedItems.slice(0, KEEP_PREVIEW_LIMIT);
  const selectableIds = useMemo(
    () =>
      sortedItems
        .filter(
          (item) =>
            new Date(getKeepItemExpiration(item)).getTime() > now.getTime(),
        )
        .map((item) => item.id),
    [sortedItems, now],
  );
  const selectableIdSet = useMemo(
    () => new Set(selectableIds),
    [selectableIds],
  );
  const effectiveSelectedIds = useMemo(
    () =>
      new Set(
        [...selectedIds].filter((itemId) => selectableIdSet.has(itemId)),
      ),
    [selectedIds, selectableIdSet],
  );
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((itemId) => effectiveSelectedIds.has(itemId));
  const selectedAddress =
    addresses.find((address) => address.id === selectedAddressId) ??
    addresses.find((address) => address.isDefault) ??
    addresses[0] ??
    null;

  const resetMessages = () => {
    setNotice("");
    setErrorMessage("");
  };

  const toggleItem = (itemId: string) => {
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((selectedId) => selectableIdSet.has(selectedId)),
      );

      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);

      return next;
    });
    resetMessages();
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
    resetMessages();
  };

  const openAddressSelection = () => {
    if (effectiveSelectedIds.size === 0) return;

    const initialAddress =
      addresses.find((address) => address.isDefault) ?? addresses[0] ?? null;
    setSelectedAddressId(initialAddress?.id ?? null);
    setAllOpen(false);
    setAddressOpen(true);
    resetMessages();
  };

  const handleAddressConfirm = async () => {
    if (!selectedAddress || effectiveSelectedIds.size === 0) return;

    // 배송지 확인을 마친 뒤 이용권 부족 안내를 보여 주어 접수 순서를 일관되게 유지합니다.
    if (shippingCount <= 0) {
      setAddressOpen(false);
      setShortageOpen(true);
      return;
    }

    const requestedAt = new Date().toISOString();
    const scheduledAt = getNextShippingDispatchDate(requestedAt);
    const immutableItemIds = Object.freeze([...effectiveSelectedIds]);
    const immutableAddress = Object.freeze({ ...selectedAddress });
    const payload = Object.freeze({
      itemIds: immutableItemIds,
      requestedAt,
      scheduledAt,
      shippingAddress: immutableAddress,
    }) satisfies ShippingRequestPayload;

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      // TODO: DB 연동 필요 — 주소 스냅샷, 이용권 1회 차감, 발송 대기열 등록을 서버 트랜잭션으로 처리하세요.
      await onRequestShipping(payload);
      setSelectedIds(new Set());
      setAddressOpen(false);
      setNotice(formatShippingDispatchNotice(scheduledAt));
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "택배 접수에 실패했습니다. 이용권은 차감되지 않았으니 다시 시도해 주세요.";

      if (message.includes("택배 가능 횟수")) {
        setAddressOpen(false);
        setShortageOpen(true);
      } else {
        setErrorMessage(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="keep-storage-title" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[17px] font-bold tracking-[0.16em] text-[#5a8b79]">
            KEEP STORAGE
          </p>
          <h2
            id="keep-storage-title"
            className="mt-1 text-2xl font-black text-[#493b31] sm:text-3xl"
          >
            📦 나의 보관함 (Keep)
          </h2>
          <p className="mt-2 text-[17px] font-semibold leading-7 text-[#76685e]">
            결제가 끝난 상품만 보관됩니다. 만료가 가장 촉박한 상품부터 보여드립니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {sortedItems.length > 0 ? (
            <button
              type="button"
              onClick={() => setAllOpen(true)}
              className="min-h-12 rounded-full border-2 border-[#c7b39d] bg-[#fff8ef] px-5 py-2 text-[17px] font-black text-[#6c5849] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#eadbc9]"
            >
              전체 보관함 보기
            </button>
          ) : null}
          {selectableIds.length > 0 ? (
            <button
              type="button"
              onClick={toggleAll}
              className="min-h-12 rounded-full border-2 border-[#91bdaa] bg-[#eef8f3] px-5 py-2 text-[17px] font-black text-[#3f725f] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c7e4d8]"
            >
              {allSelected ? "전체 선택 해제" : "☑️ 전체 선택"}
            </button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div
          role="status"
          className="rounded-2xl border-2 border-[#91c7b2] bg-[#e6f6ef] px-5 py-4 text-[17px] font-black leading-7 text-[#356b57]"
        >
          ✅ {notice}
          <span className="mt-1 block font-bold">
            접수 상품은 관리자 발송 대기열로 이동했습니다.
          </span>
        </div>
      ) : null}

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-2xl bg-[#ffe9e4] px-5 py-4 text-[17px] font-extrabold text-[#a84d42]"
        >
          {errorMessage}
        </p>
      ) : null}

      {sortedItems.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-[#d9cbbb] bg-[#fffaf3] px-6 py-12 text-center">
          <p className="text-4xl" aria-hidden="true">
            📭
          </p>
          <p className="mt-3 text-[17px] font-extrabold text-[#59483b]">
            현재 보관 중인 상품이 없습니다.
          </p>
          <p className="mt-1 text-[17px] font-semibold text-[#807267]">
            낙찰 상품의 결제가 완료되면 이곳으로 이동합니다.
          </p>
        </div>
      ) : (
        <>
          <ul
            className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
            aria-label="보관 상품 미리보기"
          >
            {previewItems.map((item) => (
              <KeepItemCard
                key={item.id}
                item={item}
                checked={effectiveSelectedIds.has(item.id)}
                now={now}
                onToggle={toggleItem}
              />
            ))}
          </ul>
          {sortedItems.length > KEEP_PREVIEW_LIMIT ? (
            <p className="text-center text-[17px] font-bold text-[#76685e]">
              나머지 {sortedItems.length - KEEP_PREVIEW_LIMIT}벌은 ‘전체 보관함 보기’에서 확인할 수 있습니다.
            </p>
          ) : null}
        </>
      )}

      {sortedItems.length > 0 ? (
        <div className="sticky bottom-20 z-20 rounded-[1.75rem] border-2 border-[#d7c8b8] bg-[#fffaf3]/95 p-4 shadow-[0_18px_45px_rgba(78,58,42,0.18)] backdrop-blur sm:bottom-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-[17px] font-extrabold text-[#59483b]">
              선택 {effectiveSelectedIds.size}벌 · 접수 후 택배 가능 횟수{" "}
              <strong className="text-[#c65f4f]">
                {Math.max(
                  0,
                  shippingCount - (effectiveSelectedIds.size > 0 ? 1 : 0),
                )}
                회
              </strong>
              <p className="mt-1 font-bold text-[#8b5c49]">
                배송 하루 전 추가 낙찰품은 이번 합배송에 포함할 수 없습니다.
              </p>
            </div>
            <Button
              size="lg"
              disabled={effectiveSelectedIds.size === 0}
              onClick={openAddressSelection}
              className="shrink-0"
            >
              선택 상품 택배 접수하기 (전체 선택 가능)
            </Button>
          </div>
        </div>
      ) : null}

      <KeepAllModal
        open={allOpen}
        items={sortedItems}
        selectedIds={effectiveSelectedIds}
        selectableIds={selectableIds}
        now={now}
        onToggleItem={toggleItem}
        onToggleAll={toggleAll}
        onRequestShipping={openAddressSelection}
        onClose={() => setAllOpen(false)}
      />

      <ShippingAddressSelectModal
        open={addressOpen}
        addresses={addresses}
        selectedAddressId={selectedAddress?.id ?? null}
        selectedItemCount={effectiveSelectedIds.size}
        isSubmitting={isSubmitting}
        onSelect={setSelectedAddressId}
        onConfirm={() => void handleAddressConfirm()}
        onClose={() => setAddressOpen(false)}
      />

      <Modal
        open={shortageOpen}
        title="택배 가능 횟수가 부족합니다"
        size="sm"
        onClose={() => setShortageOpen(false)}
      >
        <div className="space-y-5 p-5 text-[17px] leading-7 text-[#51453d] sm:p-6">
          <p className="rounded-2xl bg-[#ffe9e4] p-4 font-extrabold text-[#a54e42]">
            택배 가능 횟수가 부족합니다. 택배비 선결제를 진행해 주세요.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button variant="ghost" size="lg" onClick={() => setShortageOpen(false)}>
              닫기
            </Button>
            <Button
              size="lg"
              onClick={() => {
                setShortageOpen(false);
                onOpenRecharge();
              }}
            >
              택배비 선결제
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
