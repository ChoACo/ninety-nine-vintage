"use client";

/* eslint-disable @next/next/no-img-element -- 로컬 파일 미리보기는 Object URL을 직접 표시합니다. */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import type { AuctionStatus, ISODateString } from "@/src/types/auction";
import {
  isSupportedProductImageMimeType,
  PRODUCT_IMAGE_FORMAT_LABEL,
} from "@/src/lib/supabase/productImagePolicy";
import {
  formatKRW,
  getNextAuctionPublishAt,
} from "@/src/utils/formatters";

type PublishMode = "scheduled" | "immediate";

interface SelectedImage {
  id: string;
  file: File;
  previewUrl: string;
}

export interface NewAuctionDraft {
  title: string;
  description: string;
  startingPrice: number;
  bidIncrement: number;
  imageFiles: File[];
  status: Exclude<AuctionStatus, "closed">;
  publish_at: ISODateString;
}

export interface NewAuctionModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: NewAuctionDraft) => void | Promise<void>;
}

const initialForm = {
  description: "",
  startingPrice: "10000",
};

function getImageId(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function revokePreviews(images: readonly SelectedImage[]) {
  images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
}

export default function NewAuctionModal({
  open,
  onClose,
  onSubmit,
}: NewAuctionModalProps) {
  const [form, setForm] = useState(initialForm);
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [publishMode, setPublishMode] =
    useState<PublishMode>("scheduled");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedImagesRef = useRef<SelectedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const descriptionId = useId();
  const startingPriceId = useId();
  const imagesId = useId();
  const imagesHelpId = useId();
  const publishModeName = useId();

  useEffect(() => {
    selectedImagesRef.current = selectedImages;
  }, [selectedImages]);

  useEffect(
    () => () => {
      revokePreviews(selectedImagesRef.current);
    },
    [],
  );

  const resetForm = () => {
    revokePreviews(selectedImagesRef.current);
    selectedImagesRef.current = [];
    setSelectedImages([]);
    setForm(initialForm);
    setPublishMode("scheduled");
    setError("");
    setIsSubmitting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetAndClose = () => {
    resetForm();
    onClose();
  };

  const updateField = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const handleImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    const imageFiles = files.filter((file) =>
      isSupportedProductImageMimeType(file.type),
    );

    if (imageFiles.length !== files.length) {
      setError(`${PRODUCT_IMAGE_FORMAT_LABEL} 사진만 선택할 수 있어요.`);
    } else {
      setError("");
    }

    const existingIds = new Set(
      selectedImagesRef.current.map((image) => image.id),
    );
    const additions = imageFiles.flatMap((file) => {
      const id = getImageId(file);
      if (existingIds.has(id)) return [];
      existingIds.add(id);
      return [{ id, file, previewUrl: URL.createObjectURL(file) }];
    });
    const next = [...selectedImagesRef.current, ...additions];
    selectedImagesRef.current = next;
    setSelectedImages(next);

    // 삭제한 파일을 같은 세션에서 다시 선택해도 change 이벤트가 발생하게 합니다.
    input.value = "";
  };

  const removeImage = (imageId: string) => {
    const removed = selectedImagesRef.current.find(
      (image) => image.id === imageId,
    );
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    const next = selectedImagesRef.current.filter(
      (image) => image.id !== imageId,
    );
    selectedImagesRef.current = next;
    setSelectedImages(next);
    setError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const startingPrice = Number(form.startingPrice);
    const bidIncrement = 1_000;

    if (!form.description.trim()) {
      setError("상품 설명을 입력해 주세요.");
      return;
    }
    if (!Number.isInteger(startingPrice) || startingPrice <= 0) {
      setError("시작 가격을 1원 이상의 정수로 입력해 주세요.");
      return;
    }
    if (selectedImages.length === 0) {
      setError("상품 사진을 하나 이상 선택해 주세요.");
      return;
    }

    const now = new Date();
    const isScheduled = publishMode === "scheduled";

    setIsSubmitting(true);
    setError("");

    try {
      await onSubmit({
        // 내부 식별·사진 대체 텍스트용 이름도 본문 첫 줄에서 자동 생성합니다.
        title: form.description.trim().split(/\r?\n/)[0].trim(),
        description: form.description.trim(),
        startingPrice,
        bidIncrement,
        imageFiles: selectedImages.map((image) => image.file),
        status: isScheduled ? "pending" : "active",
        publish_at: isScheduled
          ? getNextAuctionPublishAt(now).toISOString()
          : now.toISOString(),
      });
      resetAndClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "경매글을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClasses =
    "mt-2 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--input-surface)] px-4 py-3 text-sm text-[var(--text-strong)] outline-none transition-all duration-200 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15";

  return (
    <Modal
      open={open}
      onClose={isSubmitting ? () => undefined : resetAndClose}
      title="새 경매글 작성"
      description="상품 설명과 사진을 등록한 뒤, 오전 10시 예약 또는 즉시 공개를 선택해 주세요."
      size="lg"
      closeOnBackdrop={!isSubmitting}
      className="max-sm:absolute max-sm:bottom-0 max-sm:max-h-[94dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
    >
      <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
        <label
          htmlFor={descriptionId}
          className="block text-sm font-bold text-[var(--text-strong)]"
        >
          상품 설명
          <textarea
            id={descriptionId}
            value={form.description}
            onChange={(event) =>
              updateField("description", event.target.value)
            }
            placeholder={
              "첫 줄: 상품명 · 표기 사이즈\n둘째 줄부터: 실측, 사용감·오염·수선 여부를 자세히 적어 주세요."
            }
            rows={5}
            className={`${inputClasses} resize-y`}
            autoFocus
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label
            htmlFor={startingPriceId}
            className="text-sm font-bold text-[var(--text-strong)]"
          >
            시작 가격
            <input
              id={startingPriceId}
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={form.startingPrice}
              onChange={(event) =>
                updateField("startingPrice", event.target.value)
              }
              className={inputClasses}
            />
            <span className="mt-1.5 block font-mono text-xs font-medium tabular-nums tracking-tight text-[var(--text-muted)]">
              {formatKRW(Number(form.startingPrice) || 0)}
            </span>
          </label>
          <div className="border-y border-[var(--info-border)] bg-[var(--info-surface)] px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--info-text)]">1회 입찰 단위</p>
            <p className="mt-1 font-mono text-lg font-black tabular-nums tracking-tight text-[var(--info-text)]">
              1,000원 고정
            </p>
            <p className="mt-1 text-xs font-medium leading-5 text-[var(--info-text)] opacity-80">
              모든 상품에 같은 입찰 단위가 적용됩니다.
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor={imagesId}
            className="block text-sm font-bold text-[var(--text-strong)]"
          >
            상품 사진
          </label>
          <div className="mt-2 border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] p-4 transition-all duration-200 focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/15">
            <input
              ref={fileInputRef}
              id={imagesId}
              type="file"
              multiple
              accept="image/*"
              aria-describedby={imagesHelpId}
              onChange={handleImageSelection}
              disabled={isSubmitting}
              className="block w-full text-sm font-medium text-[var(--text-muted)] file:mr-3 file:rounded-md file:border file:border-[var(--border-strong)] file:bg-[var(--surface-raised)] file:px-4 file:py-2.5 file:text-sm file:font-black file:text-[var(--text-strong)] hover:file:border-[var(--text-strong)] hover:file:shadow-sm disabled:opacity-60"
            />
            <p
              id={imagesHelpId}
              className="mt-2 text-xs font-medium leading-5 text-[var(--text-muted)]"
            >
              여러 장을 한 번에 선택할 수 있어요. 첫 번째 사진이 대표
              사진으로 표시됩니다. 지원 형식: {PRODUCT_IMAGE_FORMAT_LABEL}.
            </p>
          </div>

          {selectedImages.length > 0 ? (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {selectedImages.map((image, index) => (
                <li
                  key={image.id}
                  className="group relative overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)] transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md"
                >
                  <div className="aspect-square overflow-hidden bg-[var(--surface-muted)]">
                    <img
                      src={image.previewUrl}
                      alt={`${index + 1}번째 선택 사진 미리보기`}
                      className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.035]"
                    />
                  </div>
                  {index === 0 ? (
                    <span className="absolute left-2 top-2 border border-white/20 bg-black/75 px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white backdrop-blur">
                      대표 사진
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeImage(image.id)}
                    disabled={isSubmitting}
                    aria-label={`${image.file.name} 사진 삭제`}
                    className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md border border-white/30 bg-black/70 text-base font-black text-white shadow-md backdrop-blur transition-all duration-200 ease-out hover:scale-105 hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
                  >
                    ×
                  </button>
                  <p className="truncate px-3 py-2 text-xs font-medium text-[var(--text-muted)]">
                    {image.file.name}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="border-l-2 border-[var(--danger-text)] bg-[var(--danger-surface)] px-4 py-3 text-sm font-bold text-[var(--danger-text)]"
          >
            {error}
          </p>
        ) : null}

        <div className="space-y-4 border-t border-[var(--border)] pt-5">
          <fieldset>
            <legend className="text-sm font-black text-[var(--text-strong)]">
              오픈 시간
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3.5 transition-all duration-200 ease-out hover:scale-[1.01] ${
                  publishMode === "scheduled"
                    ? "border-[var(--accent-text)] bg-[var(--accent-surface)] ring-2 ring-[var(--accent-text)]/10"
                    : "border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)]"
                }`}
              >
                <input
                  type="radio"
                  name={publishModeName}
                  value="scheduled"
                  checked={publishMode === "scheduled"}
                  onChange={() => setPublishMode("scheduled")}
                  disabled={isSubmitting}
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                />
                <span>
                  <strong className="block text-sm font-black text-[var(--text-strong)]">
                    가장 가까운 오전 10시 예약 등록
                  </strong>
                  <span className="mt-1 block text-xs font-medium leading-5 text-[var(--text-muted)]">
                    오전 10시 전에는 당일, 이후에는 다음 날 10시에 자동 공개돼요.
                  </span>
                </span>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3.5 transition-all duration-200 ease-out hover:scale-[1.01] ${
                  publishMode === "immediate"
                    ? "border-[var(--info-text)] bg-[var(--info-surface)] ring-2 ring-[var(--info-text)]/10"
                    : "border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)]"
                }`}
              >
                <input
                  type="radio"
                  name={publishModeName}
                  value="immediate"
                  checked={publishMode === "immediate"}
                  onChange={() => setPublishMode("immediate")}
                  disabled={isSubmitting}
                  className="mt-1 h-4 w-4 accent-[var(--info-text)]"
                />
                <span>
                  <strong className="block text-sm font-black text-[var(--text-strong)]">
                    즉시 올리기
                  </strong>
                  <span className="mt-1 block text-xs font-medium leading-5 text-[var(--text-muted)]">
                    등록과 동시에 피드에서 경매를 시작해요.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={resetAndClose}
              disabled={isSubmitting}
              className="rounded-lg transition-all duration-200 ease-out hover:scale-[1.02]"
            >
              취소
            </Button>
            <Button
              type="submit"
              isLoading={isSubmitting}
              className="rounded-lg transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-lg"
            >
              {isSubmitting
                ? "사진 업로드 중..."
                : publishMode === "scheduled"
                  ? "오전 10시 예약 등록"
                  : "지금 바로 등록"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
