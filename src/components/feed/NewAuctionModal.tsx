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
    "mt-2 w-full rounded-2xl border border-[#decdbf] bg-white px-4 py-3 text-sm text-[#463a34] outline-none transition placeholder:text-[#b7aaa1] focus:border-[#ec7866] focus:ring-4 focus:ring-[#ec7866]/10";

  return (
    <Modal
      open={open}
      onClose={isSubmitting ? () => undefined : resetAndClose}
      title="새 경매글 작성"
      description="상품 설명과 사진을 등록한 뒤, 오전 10시 예약 또는 즉시 공개를 선택해 주세요."
      size="lg"
      closeOnBackdrop={!isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
        <label
          htmlFor={descriptionId}
          className="block text-sm font-bold text-[#4c4039]"
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
            className="text-sm font-bold text-[#4c4039]"
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
            <span className="mt-1.5 block text-xs font-medium text-[#8a786c]">
              {formatKRW(Number(form.startingPrice) || 0)}
            </span>
          </label>
          <div className="rounded-2xl border border-[#cfe1e5] bg-[#edf7f9] px-4 py-3">
            <p className="text-sm font-black text-[#466c75]">1회 입찰 단위</p>
            <p className="mt-1 text-xl font-black text-[#294f58]">
              1,000원 고정
            </p>
            <p className="mt-1 text-sm font-semibold leading-5 text-[#617c82]">
              모든 상품에 같은 입찰 단위가 적용됩니다.
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor={imagesId}
            className="block text-sm font-bold text-[#4c4039]"
          >
            상품 사진
          </label>
          <div className="mt-2 rounded-[1.4rem] border border-dashed border-[#d8bda9] bg-[#fffaf4] p-4 transition focus-within:border-[#ec7866] focus-within:ring-4 focus-within:ring-[#ec7866]/10">
            <input
              ref={fileInputRef}
              id={imagesId}
              type="file"
              multiple
              accept="image/*"
              aria-describedby={imagesHelpId}
              onChange={handleImageSelection}
              disabled={isSubmitting}
              className="block w-full text-sm font-semibold text-[#6e5b50] file:mr-3 file:rounded-full file:border-0 file:bg-[#e87462] file:px-4 file:py-2.5 file:text-sm file:font-black file:text-white hover:file:bg-[#d96352] disabled:opacity-60"
            />
            <p
              id={imagesHelpId}
              className="mt-2 text-xs font-medium leading-5 text-[#8a786c]"
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
                  className="group relative overflow-hidden rounded-2xl border border-[#ead9cc] bg-white shadow-[0_8px_22px_rgba(89,65,49,0.08)]"
                >
                  <div className="aspect-square overflow-hidden bg-[#f1e7de]">
                    <img
                      src={image.previewUrl}
                      alt={`${index + 1}번째 선택 사진 미리보기`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  {index === 0 ? (
                    <span className="absolute left-2 top-2 rounded-full bg-[#4f4038]/85 px-2.5 py-1 text-[11px] font-black text-white backdrop-blur">
                      대표 사진
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeImage(image.id)}
                    disabled={isSubmitting}
                    aria-label={`${image.file.name} 사진 삭제`}
                    className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full border border-white/80 bg-[#fffaf4]/95 text-lg font-black text-[#a04438] shadow-md transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec7866] disabled:opacity-50"
                  >
                    ×
                  </button>
                  <p className="truncate px-3 py-2 text-xs font-bold text-[#756359]">
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
            className="rounded-2xl bg-[#fff0ea] px-4 py-3 text-sm font-bold text-[#b14c3f]"
          >
            {error}
          </p>
        ) : null}

        <div className="space-y-4 border-t border-[#eee0d5] pt-5">
          <fieldset>
            <legend className="text-sm font-black text-[#4c4039]">
              오픈 시간
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 transition ${
                  publishMode === "scheduled"
                    ? "border-[#df7462] bg-[#fff0e9] ring-2 ring-[#df7462]/15"
                    : "border-[#dfd0c4] bg-white hover:border-[#d8a18f]"
                }`}
              >
                <input
                  type="radio"
                  name={publishModeName}
                  value="scheduled"
                  checked={publishMode === "scheduled"}
                  onChange={() => setPublishMode("scheduled")}
                  disabled={isSubmitting}
                  className="mt-1 h-4 w-4 accent-[#df6254]"
                />
                <span>
                  <strong className="block text-sm font-black text-[#493b34]">
                    가장 가까운 오전 10시 예약 등록
                  </strong>
                  <span className="mt-1 block text-xs font-semibold leading-5 text-[#8a7468]">
                    오전 10시 전에는 당일, 이후에는 다음 날 10시에 자동 공개돼요.
                  </span>
                </span>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 transition ${
                  publishMode === "immediate"
                    ? "border-[#5d8790] bg-[#edf7f9] ring-2 ring-[#5d8790]/15"
                    : "border-[#dfd0c4] bg-white hover:border-[#a9c8ce]"
                }`}
              >
                <input
                  type="radio"
                  name={publishModeName}
                  value="immediate"
                  checked={publishMode === "immediate"}
                  onChange={() => setPublishMode("immediate")}
                  disabled={isSubmitting}
                  className="mt-1 h-4 w-4 accent-[#4e7b84]"
                />
                <span>
                  <strong className="block text-sm font-black text-[#493b34]">
                    즉시 올리기
                  </strong>
                  <span className="mt-1 block text-xs font-semibold leading-5 text-[#8a7468]">
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
            >
              취소
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
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
