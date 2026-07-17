"use client";

import { useId, useState, type FormEvent } from "react";
import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import { formatKRW } from "@/src/utils/formatters";

export interface NewAuctionDraft {
  title: string;
  category: string;
  description: string;
  startingPrice: number;
  bidIncrement: number;
  imageUrls: string[];
}

export interface NewAuctionModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: NewAuctionDraft) => void | Promise<void>;
}

const initialForm = {
  category: "여성 상의",
  description: "",
  startingPrice: "10000",
  imageUrls: "",
};

export default function NewAuctionModal({
  open,
  onClose,
  onSubmit,
}: NewAuctionModalProps) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const categoryId = useId();
  const descriptionId = useId();
  const startingPriceId = useId();
  const imagesId = useId();

  const resetForm = () => {
    setForm(initialForm);
    setError("");
    setIsSubmitting(false);
  };

  const resetAndClose = () => {
    resetForm();
    onClose();
  };

  const updateField = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const startingPrice = Number(form.startingPrice);
    const bidIncrement = 1_000;
    const imageUrls = form.imageUrls
      .split("\n")
      .map((url) => url.trim())
      .filter(Boolean);

    if (!form.description.trim()) {
      setError("상품 설명을 입력해 주세요.");
      return;
    }
    if (!Number.isInteger(startingPrice) || startingPrice <= 0) {
      setError("시작 가격을 1원 이상의 정수로 입력해 주세요.");
      return;
    }
    if (imageUrls.length === 0) {
      setError("상품 사진 URL을 하나 이상 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      // TODO: DB 연동 필요 - 실제 경매 게시물 생성 API 호출로 교체합니다.
      await onSubmit({
        // 내부 식별·사진 대체 텍스트용 이름도 본문 첫 줄에서 자동 생성합니다.
        title: form.description.trim().split(/\r?\n/)[0].trim(),
        category: form.category,
        description: form.description.trim(),
        startingPrice,
        bidIncrement,
        imageUrls,
      });
      resetAndClose();
    } catch {
      setError("경매글을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClasses =
    "mt-2 w-full rounded-2xl border border-[#decdbf] bg-white px-4 py-3 text-sm text-[#463a34] outline-none transition placeholder:text-[#b7aaa1] focus:border-[#ec7866] focus:ring-4 focus:ring-[#ec7866]/10";

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="새 경매글 작성"
      description="본문 첫 줄이 카드의 굵은 대표 문구로 표시되며, 판매 완료 전까지 계속 입찰할 수 있습니다."
      size="lg"
      closeOnBackdrop={!isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
        <label htmlFor={categoryId} className="block text-sm font-bold text-[#4c4039]">
          카테고리
          <select
            id={categoryId}
            value={form.category}
            onChange={(event) => updateField("category", event.target.value)}
            className={inputClasses}
          >
            {["여성 상의", "아우터", "원피스", "남성 의류", "공용", "잡화"].map(
              (category) => (
                <option key={category}>{category}</option>
              ),
            )}
          </select>
        </label>

        <label htmlFor={descriptionId} className="block text-sm font-bold text-[#4c4039]">
          상품 설명
          <textarea
            id={descriptionId}
            value={form.description}
            onChange={(event) => updateField("description", event.target.value)}
            placeholder={"첫 줄: 버버리 트렌치코트 · 여성 66~77\n둘째 줄부터: 실측, 사용감·오염·수선 여부를 자세히 적어 주세요."}
            rows={4}
            className={`${inputClasses} resize-y`}
            autoFocus
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label htmlFor={startingPriceId} className="text-sm font-bold text-[#4c4039]">
            시작 가격
            <input
              id={startingPriceId}
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={form.startingPrice}
              onChange={(event) => updateField("startingPrice", event.target.value)}
              className={inputClasses}
            />
            <span className="mt-1.5 block text-xs font-medium text-[#8a786c]">
              {formatKRW(Number(form.startingPrice) || 0)}
            </span>
          </label>
          <div className="rounded-2xl border border-[#cfe1e5] bg-[#edf7f9] px-4 py-3">
            <p className="text-sm font-black text-[#466c75]">1회 입찰 단위</p>
            <p className="mt-1 text-xl font-black text-[#294f58]">1,000원 고정</p>
            <p className="mt-1 text-sm font-semibold leading-5 text-[#617c82]">
              모든 상품에 같은 입찰 단위가 적용됩니다.
            </p>
          </div>
        </div>

        <label htmlFor={imagesId} className="block text-sm font-bold text-[#4c4039]">
          사진 URL
          <textarea
            id={imagesId}
            value={form.imageUrls}
            onChange={(event) => updateField("imageUrls", event.target.value)}
            placeholder={"https://example.com/photo-1.jpg\nhttps://example.com/photo-2.jpg"}
            rows={3}
            className={`${inputClasses} resize-y font-mono text-xs`}
          />
          <span className="mt-1.5 block text-xs font-medium leading-5 text-[#8a786c]">
            여러 장은 한 줄에 URL 하나씩 입력하세요. 첫 사진이 메인으로 보여요.
          </span>
        </label>

        {error ? (
          <p role="alert" className="rounded-2xl bg-[#fff0ea] px-4 py-3 text-sm font-bold text-[#b14c3f]">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-[#eee0d5] pt-5 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={resetAndClose}
            disabled={isSubmitting}
          >
            취소
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {isSubmitting ? "등록 중…" : "경매글 등록"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
