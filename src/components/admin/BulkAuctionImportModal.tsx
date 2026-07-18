"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type InputHTMLAttributes,
} from "react";
import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import type { NewAuctionDraft } from "@/src/components/feed/NewAuctionModal";
import {
  buildBatchAuctionPreview,
  parseAuctionWorkbook,
  type BatchAuctionProgressPhase,
  type BatchAuctionProgressReporter,
  type BatchAuctionIssue,
  type BatchAuctionPreview,
  type ParsedAuctionWorkbook,
} from "@/src/lib/import/batchAuction";
import { PRODUCT_IMAGE_FORMAT_LABEL } from "@/src/lib/supabase/productImagePolicy";
import { formatKRW, getNextAuctionPublishAt } from "@/src/utils/formatters";

interface BatchAuctionSubmitProgress {
  completed: number;
  total: number;
  phase: BatchAuctionProgressPhase;
}

export type {
  BatchAuctionProgressPhase,
  BatchAuctionProgressReporter,
} from "@/src/lib/import/batchAuction";

export interface BulkAuctionImportModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    drafts: NewAuctionDraft[],
    onProgress: BatchAuctionProgressReporter,
  ) => void | Promise<void>;
}

const PREVIEW_PUBLISH_AT = "2030-01-01T01:00:00.000Z";

const directoryPickerAttributes = {
  webkitdirectory: "",
  directory: "",
} as InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory: string;
  directory: string;
};

function progressPercentage(progress: BatchAuctionSubmitProgress | null): number {
  if (!progress || progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((progress.completed / progress.total) * 100)));
}

function issueClasses(issue: BatchAuctionIssue): string {
  return issue.severity === "error"
    ? "border-[#efc6bc] bg-[#fff0eb] text-[#a64c3f]"
    : "border-[#ead9ad] bg-[#fff8df] text-[#7f6628]";
}

function resetInput(input: HTMLInputElement | null) {
  if (input) input.value = "";
}

export default function BulkAuctionImportModal({
  open,
  onClose,
  onSubmit,
}: BulkAuctionImportModalProps) {
  const [workbookFileName, setWorkbookFileName] = useState("");
  const [parsedWorkbook, setParsedWorkbook] =
    useState<ParsedAuctionWorkbook | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [bidIncrement, setBidIncrement] = useState("1000");
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] =
    useState<BatchAuctionSubmitProgress | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const parseRequestRef = useRef(0);
  const workbookInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const multipleInputRef = useRef<HTMLInputElement>(null);
  const workbookId = useId();
  const directoryId = useId();
  const multipleImagesId = useId();
  const bidIncrementId = useId();

  const numericBidIncrement = Number(bidIncrement);
  const preview = useMemo<BatchAuctionPreview | null>(() => {
    if (!parsedWorkbook) return null;
    return buildBatchAuctionPreview(parsedWorkbook, imageFiles, {
      publishAt: PREVIEW_PUBLISH_AT,
      bidIncrement: numericBidIncrement,
    });
  }, [imageFiles, numericBidIncrement, parsedWorkbook]);

  const reset = () => {
    parseRequestRef.current += 1;
    setWorkbookFileName("");
    setParsedWorkbook(null);
    setImageFiles([]);
    setBidIncrement("1000");
    setIsParsing(false);
    setIsSubmitting(false);
    setError("");
    setProgress(null);
    setIsComplete(false);
    resetInput(workbookInputRef.current);
    resetInput(directoryInputRef.current);
    resetInput(multipleInputRef.current);
  };

  const resetResult = () => {
    setError("");
    setProgress(null);
    setIsComplete(false);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    reset();
    onClose();
  };

  const handleWorkbookSelection = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    const requestId = ++parseRequestRef.current;
    setParsedWorkbook(null);
    setWorkbookFileName(file?.name ?? "");
    resetResult();

    if (!file) {
      setIsParsing(false);
      return;
    }

    setIsParsing(true);
    try {
      const parsed = await parseAuctionWorkbook(file);
      if (requestId === parseRequestRef.current) {
        setParsedWorkbook(parsed);
      }
    } catch (parseError) {
      if (requestId === parseRequestRef.current) {
        setError(
          parseError instanceof Error
            ? parseError.message
            : "Excel 파일을 읽지 못했습니다.",
        );
      }
    } finally {
      if (requestId === parseRequestRef.current) setIsParsing(false);
    }
  };

  const handleImageSelection = (
    event: ChangeEvent<HTMLInputElement>,
    source: "directory" | "multiple",
  ) => {
    setImageFiles(Array.from(event.currentTarget.files ?? []));
    resetInput(
      source === "directory"
        ? multipleInputRef.current
        : directoryInputRef.current,
    );
    resetResult();
  };

  const buildFinalPreview = (): BatchAuctionPreview | null => {
    if (!parsedWorkbook) return null;
    const now = new Date();
    return buildBatchAuctionPreview(parsedWorkbook, imageFiles, {
      publishAt: getNextAuctionPublishAt(now).toISOString(),
      bidIncrement: Number(bidIncrement),
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    const finalPreview = buildFinalPreview();
    if (!finalPreview?.canSubmit || finalPreview.drafts.length === 0) {
      setError("오류가 있는 행과 이미지 매칭을 모두 확인해 주세요.");
      return;
    }

    const total = finalPreview.drafts.length;
    setIsSubmitting(true);
    setIsComplete(false);
    setError("");
    setProgress({ completed: 0, total, phase: "uploading" });

    try {
      await onSubmit(finalPreview.drafts, (completed, progressTotal, phase) => {
        const safeTotal = Math.max(1, Number(progressTotal) || total);
        const safeCompleted = Math.min(
          safeTotal,
          Math.max(0, Number(completed) || 0),
        );
        setProgress({
          completed: safeCompleted,
          total: safeTotal,
          phase,
        });
      });
      setProgress({
        completed: total,
        total,
        phase: "saving",
      });
      setIsComplete(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "상품 일괄 등록을 완료하지 못했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const detected = parsedWorkbook?.detectedHeaders;
  const progressValue = progressPercentage(progress);
  const rowErrorCount =
    preview?.rows.filter((row) =>
      row.issues.some((issue) => issue.severity === "error"),
    ).length ?? 0;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Excel 경매 일괄 등록"
      description="Excel의 1~5행은 양식 안내로 제외하고 6행부터 상품을 읽습니다. 선택한 사진 폴더의 이미지명을 연결한 뒤 대기열에 등록합니다."
      size="gallery"
      closeOnBackdrop={!isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-6 p-5 sm:p-6">
        <section className="grid gap-4 lg:grid-cols-2" aria-label="일괄 등록 파일 선택">
          <div className="rounded-3xl border border-[#e6d7ca] bg-white/80 p-4">
            <label htmlFor={workbookId} className="text-sm font-black text-[#4b3f38]">
              1. Excel 파일
            </label>
            <input
              ref={workbookInputRef}
              id={workbookId}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleWorkbookSelection}
              disabled={isParsing || isSubmitting}
              className="mt-3 block w-full text-sm font-semibold text-[#6e5b50] file:mr-3 file:rounded-full file:border-0 file:bg-[#e87462] file:px-4 file:py-2.5 file:text-sm file:font-black file:text-white disabled:opacity-60"
            />
            <p className="mt-2 text-xs font-semibold leading-5 text-[#89786d]">
              .xlsx 파일의 A열 상품명, X열 상품 설명, Y열 시작가, AH열 이미지명을 읽으며 1~5행은 등록하지 않습니다.
            </p>
            {isParsing ? (
              <p className="mt-3 flex items-center gap-2 text-sm font-black text-[#b55f50]" role="status">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                Excel을 분석하는 중…
              </p>
            ) : workbookFileName ? (
              <p className="mt-3 truncate rounded-xl bg-[#fff3ea] px-3 py-2 text-sm font-bold text-[#7e5c4f]">
                {workbookFileName}
              </p>
            ) : null}
          </div>

          <div className="rounded-3xl border border-[#d6e2e5] bg-[#f4fafb] p-4">
            <p className="text-sm font-black text-[#3f626a]">2. 상품 사진</p>
            <label htmlFor={directoryId} className="mt-3 block text-sm font-bold text-[#526d73]">
              사진 폴더 선택
            </label>
            <input
              {...directoryPickerAttributes}
              ref={directoryInputRef}
              id={directoryId}
              type="file"
              multiple
              accept="image/*"
              onChange={(event) => handleImageSelection(event, "directory")}
              disabled={isSubmitting}
              className="mt-2 block w-full text-sm font-semibold text-[#557078] file:mr-3 file:rounded-full file:border-0 file:bg-[#56818b] file:px-4 file:py-2.5 file:text-sm file:font-black file:text-white disabled:opacity-60"
            />
            <div className="my-3 flex items-center gap-3 text-xs font-black text-[#91a1a5]" aria-hidden="true">
              <span className="h-px flex-1 bg-[#d5e2e5]" />또는<span className="h-px flex-1 bg-[#d5e2e5]" />
            </div>
            <label htmlFor={multipleImagesId} className="block text-sm font-bold text-[#526d73]">
              여러 사진 직접 선택
            </label>
            <input
              ref={multipleInputRef}
              id={multipleImagesId}
              type="file"
              multiple
              accept="image/*"
              onChange={(event) => handleImageSelection(event, "multiple")}
              disabled={isSubmitting}
              className="mt-2 block w-full text-sm font-semibold text-[#557078] file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2.5 file:text-sm file:font-black file:text-[#4f737c] disabled:opacity-60"
            />
            <p className="mt-3 text-xs font-semibold leading-5 text-[#71878c]">
              {imageFiles.length.toLocaleString("ko-KR")}개 선택 · 지원 형식: {PRODUCT_IMAGE_FORMAT_LABEL}. 다른 방식을 선택하면 기존 선택을 교체합니다.
            </p>
          </div>
        </section>

        {detected ? (
          <section className="rounded-3xl border border-[#ead8ca] bg-[#fffaf4] p-4" aria-label="자동 탐지 결과">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-black text-[#493c35]">자동 탐지 결과</h3>
                <p className="mt-1 text-sm font-semibold text-[#816f64]">
                  {detected.sheetName} 시트 · {detected.headerRowNumber}행을 헤더로 판단했습니다.
                </p>
              </div>
              <span className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-[#8b6c5e] shadow-sm">
                양식 자동 인식
              </span>
            </div>
            <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <DetectedColumn label="상품 설명" value={detected.description?.header} fallback="미탐지" />
              <DetectedColumn label="상품명" value={detected.title?.header} fallback="미탐지 · 설명 첫 줄 사용" />
              <DetectedColumn label="시작가" value={detected.startingPrice?.header} fallback="미탐지" />
              <DetectedColumn
                label="이미지명"
                value={detected.imageNames.map((column) => column.header).join(", ")}
                fallback="미탐지"
              />
            </dl>
            {detected.unusedHeaders.length > 0 ? (
              <p className="mt-3 break-words text-xs font-semibold leading-5 text-[#948278]">
                등록에 사용하지 않는 열: {detected.unusedHeaders.map((column) => column.header).join(", ")}
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="rounded-3xl border border-[#d9ded5] bg-white/80 p-4" aria-label="전체 상품 대기열 등록 옵션">
          <h3 className="text-base font-black text-[#493f38]">3. 대기열 등록 옵션</h3>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
            <div className="rounded-2xl border border-[#ead5a9] bg-[#fff7df] px-4 py-3">
              <p className="text-sm font-black text-[#735b31]">공개 대기 · 가장 가까운 오전 10시 예약</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-[#8a7040]">
                오전 10시 전 등록분은 당일 10시, 이후 등록분은 다음 날 10시로 예약됩니다. 공개 전에 대기열에서 수정하거나 삭제할 수 있습니다.
              </p>
            </div>
            <label htmlFor={bidIncrementId} className="text-sm font-black text-[#5a4c44]">
              전체 입찰 단위
              <input
                id={bidIncrementId}
                type="number"
                inputMode="numeric"
                min="1"
                max="100000000"
                step="1"
                value={bidIncrement}
                onChange={(event) => {
                  setBidIncrement(event.target.value);
                  resetResult();
                }}
                disabled={isSubmitting}
                className="mt-2 w-full rounded-2xl border border-[#d8cec4] bg-white px-4 py-3 text-base font-bold text-[#493e37] outline-none focus:border-[#df806f] focus:ring-4 focus:ring-[#f4ddd7] disabled:opacity-60"
              />
              <span className="mt-1.5 block text-xs font-semibold text-[#8b7b71]">
                {formatKRW(Number.isFinite(numericBidIncrement) ? numericBidIncrement : 0)}
              </span>
            </label>
          </div>
        </section>

        {preview ? (
          <section aria-label="상품 행별 미리보기">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-[#493c35]">4. 행별 미리보기</h3>
                <p className="mt-1 text-sm font-semibold text-[#827167]">
                  총 {preview.rows.length.toLocaleString("ko-KR")}행 · 오류 {rowErrorCount.toLocaleString("ko-KR")}행 · 미사용 사진 {preview.unusedImageFiles.length.toLocaleString("ko-KR")}개
                </p>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-xs font-black ${preview.canSubmit ? "bg-[#e4f2e9] text-[#477457]" : "bg-[#fff0eb] text-[#a65042]"}`}>
                {preview.canSubmit ? "등록 준비 완료" : "확인 필요"}
              </span>
            </div>

            {preview.globalIssues.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {preview.globalIssues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`} className={`rounded-2xl border px-4 py-2.5 text-sm font-bold ${issueClasses(issue)}`}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 max-h-[430px] overflow-auto rounded-2xl border border-[#e5d9cf] bg-white">
              <table className="min-w-[900px] w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-[#f7eee6] text-[#66564c] shadow-sm">
                  <tr>
                    <th className="px-3 py-3 font-black">행</th>
                    <th className="px-3 py-3 font-black">상품</th>
                    <th className="px-3 py-3 font-black">시작가</th>
                    <th className="px-3 py-3 font-black">매칭 사진</th>
                    <th className="px-3 py-3 font-black">검증</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eee3da]">
                  {preview.rows.map((row) => {
                    const hasRowError = row.issues.some((issue) => issue.severity === "error");
                    return (
                      <tr key={row.rowNumber} className={hasRowError ? "bg-[#fff8f5]" : "bg-white"}>
                        <td className="whitespace-nowrap px-3 py-3 font-black text-[#8d776a]">{row.rowNumber}</td>
                        <td className="max-w-[300px] px-3 py-3 align-top">
                          <p className="truncate font-black text-[#4d4038]">{row.title || "상품명 없음"}</p>
                          <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-[#86756b]">{row.description || "설명 없음"}</p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 align-top font-black text-[#5c4b42]">
                          {row.startingPrice === null ? "확인 필요" : formatKRW(row.startingPrice)}
                        </td>
                        <td className="max-w-[310px] px-3 py-3 align-top">
                          {row.imageMatches.length > 0 ? (
                            <ol className="space-y-1 text-xs font-semibold text-[#5c7176]">
                              {row.imageMatches.map((match, index) => (
                                <li key={`${match.reference}-${index}`} className="truncate" title={match.file.webkitRelativePath || match.file.name}>
                                  {index + 1}. {match.file.name}
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <span className="font-bold text-[#a25346]">매칭 없음</span>
                          )}
                        </td>
                        <td className="max-w-[330px] px-3 py-3 align-top">
                          {row.issues.length === 0 ? (
                            <span className="font-black text-[#4d7d5d]">정상</span>
                          ) : (
                            <ul className="space-y-1">
                              {row.issues.map((issue, index) => (
                                <li key={`${issue.code}-${index}`} className={issue.severity === "error" ? "font-bold text-[#a44d40]" : "font-semibold text-[#806929]"}>
                                  {issue.message}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {progress ? (
          <section className={`rounded-3xl border p-4 ${isComplete ? "border-[#bed8c7] bg-[#edf8f1]" : "border-[#d5e1e4] bg-[#f2f9fa]"}`} aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-sm font-black text-[#49636a]">
              <span>
                {isComplete
                  ? `${progress.total.toLocaleString("ko-KR")}개 상품 등록 완료`
                  : progress.phase === "uploading"
                    ? "상품 사진 업로드 중…"
                    : "상품 데이터 저장 중…"}
              </span>
              <span>{progress.completed.toLocaleString("ko-KR")} / {progress.total.toLocaleString("ko-KR")}</span>
            </div>
            <div
              role="progressbar"
              aria-label="상품 일괄 등록 진행률"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValue}
              className="mt-3 h-3 overflow-hidden rounded-full bg-white"
            >
              <div className="h-full rounded-full bg-[#5b8d86] transition-[width]" style={{ width: `${progressValue}%` }} />
            </div>
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-2xl border border-[#efc3b9] bg-[#fff0eb] px-4 py-3 text-sm font-black text-[#a54c3e]">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-[#eadfd5] pt-5 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            {isComplete ? "닫기" : "취소"}
          </Button>
          {!isComplete ? (
            <Button
              type="submit"
              isLoading={isSubmitting}
              disabled={!preview?.canSubmit || isParsing}
            >
              {isSubmitting ? "대기열 등록 중…" : `${preview?.rows.length ?? 0}개 대기열 등록`}
            </Button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

function DetectedColumn({
  label,
  value,
  fallback,
}: {
  label: string;
  value?: string;
  fallback: string;
}) {
  const detected = Boolean(value?.trim());
  return (
    <div className={`rounded-2xl border px-3 py-2.5 ${detected ? "border-[#d8e3d8] bg-[#f3faf4]" : "border-[#efc9bf] bg-[#fff3ef]"}`}>
      <dt className="text-xs font-black text-[#8c7a6e]">{label}</dt>
      <dd className={`mt-1 break-words text-sm font-black ${detected ? "text-[#486b51]" : "text-[#a65344]"}`}>
        {detected ? value : fallback}
      </dd>
    </div>
  );
}
