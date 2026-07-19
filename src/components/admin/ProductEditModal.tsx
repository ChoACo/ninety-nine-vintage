"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage 원격 상품 이미지를 표시합니다. */
import { type FormEvent, useId, useState } from "react";

import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import type { ManagedProduct } from "@/src/lib/supabase/products";
import type { AuctionStatus } from "@/src/types/auction";
import {
  formatKoreanDate,
  formatKoreanTime,
  formatKRW,
} from "@/src/utils/formatters";

export interface ProductEditValues {
  title: string;
  description: string;
  status: AuctionStatus;
  publishAt: string;
  startingPrice: number;
}

export interface ProductEditModalProps {
  product: ManagedProduct | null;
  open: boolean;
  onClose: () => void;
  onSave: (
    productId: string,
    values: ProductEditValues,
  ) => void | Promise<void>;
}

interface ProductEditForm {
  title: string;
  description: string;
  status: AuctionStatus;
  publishAt: string;
  startingPrice: string;
}

function toLocalDateTimeInput(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return localDate.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function productToForm(product: ManagedProduct): ProductEditForm {
  return {
    title: product.title,
    description: product.description,
    status: product.status,
    publishAt: toLocalDateTimeInput(product.publish_at ?? product.createdAt),
    startingPrice: String(
      product.saleType === "fixed"
        ? (product.fixedPrice ?? product.startingPrice)
        : product.startingPrice,
    ),
  };
}

export function ProductEditModal({
  product,
  open,
  onClose,
  onSave,
}: ProductEditModalProps) {
  if (!open || !product) return null;

  return (
    <ProductEditDialog
      key={`${product.id}:${product.updatedAt}`}
      product={product}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

function ProductEditDialog({
  product,
  onClose,
  onSave,
}: Omit<ProductEditModalProps, "product" | "open"> & {
  product: ManagedProduct;
}) {
  const [form, setForm] = useState<ProductEditForm>(() =>
    productToForm(product),
  );
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const statusId = useId();
  const publishAtId = useId();
  const startingPriceId = useId();

  const hasBidActivity = Boolean(
    product.participantCount > 0 ||
    product.bidHistory.length > 0 ||
    product.bidLockedAt,
  );
  const isActive = product.status === "active";
  const isClosed = product.status === "closed";
  const isFixedPrice = product.saleType === "fixed";

  const updateField = <Key extends keyof ProductEditForm>(
    key: Key,
    value: ProductEditForm[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const title = form.title.trim();
    const description = form.description.trim();
    const publishAt = fromLocalDateTimeInput(form.publishAt);
    const startingPrice = Number(form.startingPrice);

    if (!title || !description) {
      setError("상품명과 설명을 모두 입력해 주세요.");
      return;
    }
    if (!publishAt) {
      setError("공개 시각을 올바르게 입력해 주세요.");
      return;
    }
    if (!Number.isInteger(startingPrice) || startingPrice <= 0) {
      setError(
        `${isFixedPrice ? "판매 정가" : "시작가"}는 1원 이상의 정수여야 합니다.`,
      );
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await onSave(product.id, {
        title,
        description,
        status: form.status,
        publishAt,
        startingPrice,
      });
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "상품을 수정하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const inputClasses =
    "mt-2 w-full rounded-2xl border border-[#decdbf] bg-white px-4 py-3 text-sm font-semibold text-[#463a34] outline-none transition placeholder:text-[#b7aaa1] focus:border-[#ec7866] focus:ring-4 focus:ring-[#ec7866]/10 disabled:cursor-not-allowed disabled:bg-[#eee9e4] disabled:text-[#8d8179]";

  return (
    <Modal
      open
      onClose={isSaving ? () => undefined : onClose}
      closeOnBackdrop={!isSaving}
      title={`${isFixedPrice ? "정가" : "경매"} 상품 수정`}
      description={
        isFixedPrice
          ? "공개 정보와 판매 정가를 확인합니다. 완료된 구매 원장은 변경되지 않습니다."
          : "공개 정보만 수정할 수 있습니다. 입찰 원장과 현재가는 변경되지 않습니다."
      }
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
        {product.imageUrls.length > 0 ? (
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            aria-label="현재 상품 사진"
          >
            {product.imageUrls.slice(0, 6).map((imageUrl, index) => (
              <img
                key={`${imageUrl}-${index}`}
                src={product.thumbnailUrls[index] || imageUrl}
                alt={`${product.title} ${index + 1}번째 사진`}
                className="h-24 w-24 shrink-0 rounded-2xl border border-[#e6d8cd] object-cover"
              />
            ))}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label
            htmlFor={titleId}
            className="text-sm font-black text-[#4c4039]"
          >
            상품명
            <input
              id={titleId}
              value={form.title}
              onChange={(event) => updateField("title", event.target.value)}
              className={inputClasses}
              disabled={isSaving || hasBidActivity || isClosed}
              autoFocus
            />
          </label>
          <label
            htmlFor={statusId}
            className="text-sm font-black text-[#4c4039]"
          >
            공개 상태
            <select
              id={statusId}
              value={form.status}
              onChange={(event) =>
                updateField("status", event.target.value as AuctionStatus)
              }
              className={inputClasses}
              disabled={isSaving || isActive || isClosed}
            >
              <option value="pending" disabled={hasBidActivity}>
                {isFixedPrice ? "판매 대기" : "공개 대기"}
              </option>
              <option
                value="active"
                disabled={hasBidActivity && product.status === "closed"}
              >
                {isFixedPrice ? "판매 중" : "진행 중"}
              </option>
              {isClosed ? (
                <option value="closed">
                  {isFixedPrice ? "구매 확정" : "판매 완료"}
                </option>
              ) : null}
            </select>
          </label>
        </div>

        <label
          htmlFor={descriptionId}
          className="block text-sm font-black text-[#4c4039]"
        >
          상품 설명
          <textarea
            id={descriptionId}
            value={form.description}
            onChange={(event) => updateField("description", event.target.value)}
            rows={6}
            className={`${inputClasses} resize-y`}
            disabled={isSaving || hasBidActivity || isClosed}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label
            htmlFor={publishAtId}
            className="text-sm font-black text-[#4c4039]"
          >
            공개 시각
            <input
              id={publishAtId}
              type="datetime-local"
              value={form.publishAt}
              onChange={(event) => updateField("publishAt", event.target.value)}
              className={inputClasses}
              disabled={isSaving || hasBidActivity || isActive || isClosed}
            />
          </label>
          {isFixedPrice ? (
            <div className="rounded-2xl border border-[#d7e3e5] bg-[#edf6f7] px-4 py-3">
              <p className="text-sm font-black text-[#496b72]">판매 방식</p>
              <p className="mt-2 text-sm font-bold text-[#38565d]">
                상시 바로구매 · 자동 마감 없음
              </p>
              <p className="mt-1 text-xs font-semibold text-[#6c858a]">
                구매자가 구매를 확정하면 상점에서 내려가고 결제 대기로 전환됩니다.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#d7e3e5] bg-[#edf6f7] px-4 py-3">
              <p className="text-sm font-black text-[#496b72]">마감 시각</p>
              <p className="mt-2 text-sm font-bold text-[#38565d]">
                {formatKoreanDate(product.closesAt)}{" "}
                {formatKoreanTime(product.closesAt)}
              </p>
              <p className="mt-1 text-xs font-semibold text-[#6c858a]">
                마감 시각은 경매 규칙에 따라 서버에서 관리합니다.
              </p>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label
            htmlFor={startingPriceId}
            className="text-sm font-black text-[#4c4039]"
          >
            {isFixedPrice ? "판매 정가" : "시작가"}
            <input
              id={startingPriceId}
              type="number"
              min="1"
              step="1"
              value={form.startingPrice}
              onChange={(event) =>
                updateField("startingPrice", event.target.value)
              }
              className={inputClasses}
              disabled={isSaving || hasBidActivity || isActive || isClosed}
            />
            <span className="mt-1.5 block text-xs font-semibold text-[#8a786c]">
              {formatKRW(Number(form.startingPrice) || 0)}
            </span>
          </label>
          {isFixedPrice ? (
            <div className="rounded-2xl border border-[#d7e3e5] bg-[#edf6f7] px-4 py-3">
              <p className="text-sm font-black text-[#496b72]">구매 방식</p>
              <p className="mt-2 text-xl font-black text-[#38565d]">
                즉시 구매
              </p>
              <p className="mt-1 text-xs font-semibold text-[#6c858a]">
                입찰 없이 표시된 판매 정가로 한 명만 구매할 수 있습니다.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#d7e3e5] bg-[#edf6f7] px-4 py-3">
              <p className="text-sm font-black text-[#496b72]">입찰 단위</p>
              <p className="mt-2 text-xl font-black text-[#38565d]">
                {formatKRW(product.bidIncrement)}
              </p>
              <p className="mt-1 text-xs font-semibold text-[#6c858a]">
                입찰 단위는 경매 중 변경할 수 없습니다.
              </p>
            </div>
          )}
        </div>

        {isClosed ? (
          <p className="rounded-2xl border border-[#d7e3e5] bg-[#edf6f7] px-4 py-3 text-sm font-bold leading-6 text-[#496b72]">
            {isFixedPrice
              ? "구매가 확정된 정가 상품의 구매 원장과 판매 정가는 수정할 수 없습니다. 결제 완료 여부는 입금 확인에서 확인해 주세요."
              : "판매 완료 상품의 낙찰 원장과 마감 시각은 수정할 수 없습니다."}
          </p>
        ) : hasBidActivity ? (
          <p className="rounded-2xl border border-[#ecd6ae] bg-[#fff8e8] px-4 py-3 text-sm font-bold leading-6 text-[#80643a]">
            {isFixedPrice
              ? "이미 구매가 시작된 상품은 구매 신뢰 보호를 위해 제목·설명·공개 시각·판매 정가·진행 상태를 변경할 수 없습니다."
              : "이미 입찰이 시작된 상품은 입찰 신뢰 보호를 위해 제목·설명·공개 시각·가격·진행 상태를 변경할 수 없습니다. 마감은 자동 정산 또는 총책임자 테스트 도구에서만 처리됩니다."}
          </p>
        ) : isActive ? (
          <p className="rounded-2xl border border-[#ecd6ae] bg-[#fff8e8] px-4 py-3 text-sm font-bold leading-6 text-[#80643a]">
            {isFixedPrice
              ? "판매 중인 정가 상품은 상품명과 설명만 수정할 수 있습니다. 판매 정가는 판매 대기 상태에서 확인해 주세요."
              : "진행 중인 경매는 상품명과 설명만 수정할 수 있습니다. 시작가는 감사 기록이 남는 총책임자 전용 가격 조정 도구를 사용해 주세요."}
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-2xl bg-[#fff0ea] px-4 py-3 text-sm font-bold text-[#b14c3f]"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-[#eee0d5] pt-5 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSaving}
          >
            취소
          </Button>
          <Button type="submit" isLoading={isSaving} disabled={isClosed}>
            {isSaving ? "저장 중..." : "변경사항 저장"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
