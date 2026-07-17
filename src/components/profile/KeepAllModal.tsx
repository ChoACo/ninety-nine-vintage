"use client";

import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import type { WonAuction } from "@/src/types/auction";

import { KeepItemCard } from "./KeepItemCard";

interface KeepAllModalProps {
  open: boolean;
  items: readonly WonAuction[];
  selectedIds: ReadonlySet<string>;
  selectableIds: readonly string[];
  now: Date;
  onToggleItem: (itemId: string) => void;
  onToggleAll: () => void;
  onRequestShipping: () => void;
  onClose: () => void;
}

export function KeepAllModal({
  open,
  items,
  selectedIds,
  selectableIds,
  now,
  onToggleItem,
  onToggleAll,
  onRequestShipping,
  onClose,
}: KeepAllModalProps) {
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((itemId) => selectedIds.has(itemId));

  return (
    <Modal
      open={open}
      title="📦 전체 보관함 보기"
      size="lg"
      className="h-[min(90dvh,56rem)]"
      onClose={onClose}
    >
      <div className="flex min-h-full flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eadfd3] bg-[#fff8ef] px-5 py-4 sm:px-6">
          <div className="text-[17px] leading-7 text-[#59483b]">
            <p className="font-black">
              총 {items.length}벌 · 선택 {selectedIds.size}벌
            </p>
            <p className="font-semibold text-[#76685e]">
              보관 만료가 가장 촉박한 상품부터 정렬했습니다.
            </p>
          </div>
          {selectableIds.length > 0 ? (
            <button
              type="button"
              onClick={onToggleAll}
              className="min-h-12 rounded-full border-2 border-[#91bdaa] bg-[#eef8f3] px-5 py-2 text-[17px] font-black text-[#3f725f] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c7e4d8]"
            >
              {allSelected ? "전체 선택 해제" : "☑️ 전체 선택"}
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 p-5 sm:p-6">
          <ul
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
            aria-label="전체 보관 상품 목록"
          >
            {items.map((item) => (
              <KeepItemCard
                key={item.id}
                item={item}
                checked={selectedIds.has(item.id)}
                now={now}
                onToggle={onToggleItem}
              />
            ))}
          </ul>
        </div>

        <div className="sticky bottom-0 border-t border-[#eadfd3] bg-[#fffaf3]/95 p-4 backdrop-blur sm:p-5">
          <Button
            size="lg"
            fullWidth
            disabled={selectedIds.size === 0}
            onClick={onRequestShipping}
          >
            선택 상품 택배 접수하기 ({selectedIds.size}벌)
          </Button>
        </div>
      </div>
    </Modal>
  );
}
