"use client";

import { FileSpreadsheet, Trash2, X } from "lucide-react";
import Image from "next/image";
import {
  useId,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type InputHTMLAttributes,
} from "react";
import { Button } from "@/components/ui/Button";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { inferBrandFromTitle } from "@/lib/catalog/brand";
import {
  buildBatchAuctionPreview,
  filterDirectSelectedDirectoryFiles,
  inferBatchStorageClass,
  parseAuctionWorkbook,
  type BatchAuctionIssue,
  type BatchAuctionPreview,
  type BatchAuctionProgressPhase,
  type BatchAuctionProgressReporter,
  type ParsedAuctionWorkbook,
} from "@/lib/import/batchAuction";
import { getBatchClothingCategory } from "@/lib/import/categoryIds";
import {
  isAiEnhancementApplied,
  processExcelWithAI,
  type ProductEnhancement,
} from "@/lib/ai/productEnhancement";
import {
  PRODUCT_IMAGE_FORMAT_LABEL,
  PRODUCT_IMAGE_HEIC_CONVERSION_NOTE,
  isSupportedProductImageMimeType,
} from "@/lib/supabase/productImagePolicy";
import { formatKRW } from "@/utils/formatters";

interface StoreOption {
  id: string;
  name: string;
  canPublish: boolean;
}

interface SubmitProgress {
  completed: number;
  total: number;
  phase: BatchAuctionProgressPhase;
}

export interface OperatorXlsxImportModalProps {
  accessToken: string;
  activeStoreId: string | null;
  open: boolean;
  stores: readonly StoreOption[];
  onClose: () => void;
  onSubmit: (
    preview: BatchAuctionPreview,
    storeId: string,
    options: XlsxRegistrationOptions,
    onProgress: BatchAuctionProgressReporter,
  ) => Promise<number>;
}

export interface XlsxRegistrationOptions {
  publicationMode: "now" | "scheduled";
  publishAt: string;
  saleType: "auction" | "fixed";
}

const PREVIEW_PUBLISH_AT = "2030-01-01T01:00:00.000Z";
const directoryPickerAttributes = {
  webkitdirectory: "",
  directory: "",
} as InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory: string;
  directory: string;
};

function issueClasses(issue: BatchAuctionIssue) {
  return issue.severity === "error"
    ? "border-red-300 bg-red-50 text-red-800"
    : "border-amber-300 bg-amber-500/10 text-amber-900";
}

function progressPercentage(progress: SubmitProgress | null) {
  if (!progress || progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((progress.completed / progress.total) * 100)));
}

function resetInput(input: HTMLInputElement | null) {
  if (input) input.value = "";
}

function isWorkbookFile(file: File) {
  const name = file.name.trim().toLowerCase();
  return name.endsWith(".xlsx") && !name.startsWith("~$");
}

function selectedDirectoryName(files: readonly File[]) {
  const relativePath = (files[0] as File & { webkitRelativePath?: string } | undefined)
    ?.webkitRelativePath;
  return relativePath?.split("/")[0] ?? "선택한 폴더";
}

function nextDayTenKstInput() {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  kstNow.setUTCDate(kstNow.getUTCDate() + 1);
  const date = kstNow.toISOString().slice(0, 10);
  return `${date}T10:00`;
}

function kstInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function MatchedImageThumbnail({ file }: Readonly<{ file: File }>) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    let active = true;
    queueMicrotask(() => {
      if (active) setSrc(objectUrl);
    });
    return () => {
      active = false;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  return src ? (
    <Image
      alt={file.name}
      className="size-12 shrink-0 border border-line object-cover"
      height={48}
      src={src}
      unoptimized
      width={48}
    />
  ) : null;
}

export function OperatorXlsxImportModal({
  accessToken,
  activeStoreId,
  open,
  stores,
  onClose,
  onSubmit,
}: Readonly<OperatorXlsxImportModalProps>) {
  const [workbookFileName, setWorkbookFileName] = useState("");
  const [directoryName, setDirectoryName] = useState("");
  const [parsedWorkbook, setParsedWorkbook] = useState<ParsedAuctionWorkbook | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [ignoredNestedImageCount, setIgnoredNestedImageCount] = useState(0);
  const [bidIncrement, setBidIncrement] = useState("1000");
  const [publicationMode, setPublicationMode] =
    useState<XlsxRegistrationOptions["publicationMode"]>("now");
  const [saleType, setSaleType] =
    useState<XlsxRegistrationOptions["saleType"]>("auction");
  const [scheduledPublishAt, setScheduledPublishAt] = useState(
    nextDayTenKstInput,
  );
  const [referenceNow, setReferenceNow] = useState(Date.now);
  const [excludedRowNumbers, setExcludedRowNumbers] = useState<Set<number>>(
    new Set(),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<SubmitProgress | null>(null);
  const [aiEnhancements, setAiEnhancements] = useState<Map<number, ProductEnhancement>>(new Map());
  const [aiProgress, setAiProgress] = useState<{ completed: number; total: number } | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const parseRequestRef = useRef(0);
  const workbookInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const workbookId = useId();
  const directoryId = useId();

  const selectedStoreId = stores.some((store) => store.id === activeStoreId)
    ? activeStoreId ?? ""
    : stores.length === 1
      ? stores[0].id
      : "";
  const selectedStore = stores.find((store) => store.id === selectedStoreId);
  const selectedStoreCanPublish = selectedStore?.canPublish === true;
  const scheduledPublishAtIso = kstInputToIso(scheduledPublishAt);
  const scheduledTimeInvalid =
    publicationMode === "scheduled" &&
    (!scheduledPublishAtIso || Date.parse(scheduledPublishAtIso) <= referenceNow);

  const preview = useMemo(() => {
    if (!parsedWorkbook) return null;
    const built = buildBatchAuctionPreview(parsedWorkbook, imageFiles, {
      publishAt:
        publicationMode === "scheduled" && scheduledPublishAtIso
          ? scheduledPublishAtIso
          : PREVIEW_PUBLISH_AT,
      bidIncrement: Number(bidIncrement),
      excludedRowNumbers: [...excludedRowNumbers],
      saleType,
    });
    const optionIssues: BatchAuctionIssue[] = [];
    if (!selectedStoreId) {
      optionIssues.push({
        code: "missing_active_store",
        message: "현재 로그인 세션의 활성 숍을 확인할 수 없습니다.",
        severity: "error",
      });
    } else if (!selectedStoreCanPublish) {
      optionIssues.push({
        code: "publish_permission_required",
        message: "활성 숍의 상품 공개 권한이 필요합니다.",
        severity: "error",
      });
    }
    if (scheduledTimeInvalid) {
      optionIssues.push({
        code: "invalid_scheduled_publish_at",
        message: "예약 공개 시각은 현재보다 이후의 KST 날짜·시간이어야 합니다.",
        severity: "error",
      });
    }
    if (optionIssues.length === 0) return built;
    return {
      ...built,
      globalIssues: [...built.globalIssues, ...optionIssues],
      drafts: [],
      canSubmit: false,
    };
  }, [bidIncrement, excludedRowNumbers, imageFiles, parsedWorkbook, publicationMode, saleType, scheduledPublishAtIso, scheduledTimeInvalid, selectedStoreCanPublish, selectedStoreId]);
  const enhancedPreview = useMemo(() => {
    if (!preview || aiEnhancements.size === 0) return preview;
    const rows = preview.rows.map((row) => {
      const enhancement = aiEnhancements.get(row.rowNumber);
      if (!enhancement) return row;
      const category = getBatchClothingCategory(enhancement.categoryId) ?? row.category;
      return {
        ...row,
        title: enhancement.enhancedTitle || row.title,
        description: enhancement.refinedDescription || row.description,
        category,
        storageClass: inferBatchStorageClass(
          enhancement.enhancedTitle || row.title,
          category,
        ),
        draft: row.draft ? {
          ...row.draft,
          title: enhancement.enhancedTitle || row.draft.title,
          description: enhancement.refinedDescription || row.draft.description,
        } : null,
      };
    });
    return {
      ...preview,
      rows,
      drafts: preview.canSubmit
        ? rows.flatMap((row) => row.draft ? [row.draft] : [])
        : [],
    };
  }, [aiEnhancements, preview]);
  const resetResult = useCallback(() => {
    setConfirmed(false);
    setSubmittedCount(0);
    setError("");
    setProgress(null);
    setAiEnhancements(new Map());
    setAiProgress(null);
    setIsEnhancing(false);
  }, []);

  const reset = useCallback(() => {
    parseRequestRef.current += 1;
    setWorkbookFileName("");
    setDirectoryName("");
    setParsedWorkbook(null);
    setImageFiles([]);
    setIgnoredNestedImageCount(0);
    setBidIncrement("1000");
    setPublicationMode("now");
    setSaleType("auction");
    setScheduledPublishAt(nextDayTenKstInput());
    setExcludedRowNumbers(new Set());
    setConfirmed(false);
    setIsParsing(false);
    setIsSubmitting(false);
    setSubmittedCount(0);
    setError("");
    setProgress(null);
    resetInput(workbookInputRef.current);
    resetInput(directoryInputRef.current);
  }, []);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    reset();
    onClose();
  }, [isSubmitting, onClose, reset]);

  const handleWorkbookSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    const file = selectedFiles[0];
    const requestId = ++parseRequestRef.current;
    setParsedWorkbook(null);
    setExcludedRowNumbers(new Set());
    setWorkbookFileName(file?.name ?? "");
    setDirectoryName("");
    setImageFiles([]);
    setIgnoredNestedImageCount(0);
    resetInput(directoryInputRef.current);
    resetResult();
    if (!file) {
      setIsParsing(false);
      return;
    }
    if (selectedFiles.length !== 1 || !isWorkbookFile(file)) {
      setIsParsing(false);
      setError("등록용 .xlsx 엑셀 파일 1개를 선택해 주세요.");
      return;
    }

    setIsParsing(true);
    try {
      const parsed = await parseAuctionWorkbook(file);
      if (requestId === parseRequestRef.current) setParsedWorkbook(parsed);
    } catch (parseError) {
      if (requestId === parseRequestRef.current) {
        setError(parseError instanceof Error ? parseError.message : "엑셀 파일을 읽지 못했습니다.");
      }
    } finally {
      if (requestId === parseRequestRef.current) setIsParsing(false);
    }
  };

  const handleDirectorySelection = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    const supportedImages = selectedFiles.filter((file) =>
      isSupportedProductImageMimeType(file.type),
    );
    const selectedImages = filterDirectSelectedDirectoryFiles(supportedImages);
    setDirectoryName(
      selectedFiles.length > 0 ? selectedDirectoryName(selectedFiles) : "",
    );
    setImageFiles(selectedImages);
    setIgnoredNestedImageCount(supportedImages.length - selectedImages.length);
    resetResult();
    if (selectedFiles.length > 0 && selectedImages.length === 0) {
      setError("선택한 폴더의 바로 아래에서 지원하는 상품 이미지를 찾지 못했습니다.");
    }
  };

  const handleAiEnhancement = async () => {
    if (!preview || !accessToken || !selectedStoreId || isEnhancing) return;
    const candidates = preview.rows.flatMap((row) => row.imageMatches.length > 0 ? [{
      rowNumber: row.rowNumber,
      images: row.imageMatches.map((match) => match.file),
      source: {
        title: row.title,
        description: row.sourceDescription || row.description,
        condition: row.condition,
        categoryId: row.category?.id ?? null,
        sizeLabel: row.size || null,
      },
    }] : []);
    if (candidates.length === 0) {
      setError("사진이 연결된 상품이 없어 AI 분석을 시작할 수 없습니다.");
      return;
    }
    setIsEnhancing(true);
    setError("");
    setAiEnhancements(new Map());
    setAiProgress({ completed: 0, total: candidates.length });
    try {
      const results = await processExcelWithAI(candidates, accessToken, selectedStoreId, {
        concurrency: 5,
        onProgress: (completed, total) => setAiProgress({ completed, total }),
      });
      const next = new Map<number, ProductEnhancement>();
      let notAppliedCount = 0;
      results.forEach(({ rowNumber, status, enhancement }) => {
        if (isAiEnhancementApplied(status) && enhancement) {
          next.set(rowNumber, enhancement);
        } else {
          notAppliedCount += 1;
        }
      });
      setAiEnhancements(next);
      if (next.size === 0) {
        setError("AI 분석을 완료하지 못해 모든 기존 입력값을 유지했습니다. 잠시 후 다시 시도해 주세요.");
      } else {
        setConfirmed(false);
        if (notAppliedCount > 0) {
          setError(`${notAppliedCount}개 상품은 AI 분석을 완료하지 못해 기존 입력값을 유지했습니다.`);
        }
      }
    } finally {
      setIsEnhancing(false);
      setAiProgress(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!confirmed) {
      setError("검증 결과와 저장 대상을 확인했다는 항목에 체크해 주세요.");
      return;
    }
    if (!selectedStoreId || !stores.some((store) => store.id === selectedStoreId)) {
      setError("현재 활성 숍의 상품 등록 권한을 확인해 주세요.");
      return;
    }
    if (!parsedWorkbook) {
      setError("엑셀 파일을 먼저 선택해 주세요.");
      return;
    }

    const finalPublishAt =
      publicationMode === "scheduled" ? scheduledPublishAtIso : new Date().toISOString();
    if (!finalPublishAt || scheduledTimeInvalid) {
      setError("예약 공개 시각은 현재보다 이후의 KST 날짜·시간이어야 합니다.");
      return;
    }
    const finalPreview = buildBatchAuctionPreview(parsedWorkbook, imageFiles, {
      publishAt: finalPublishAt,
      bidIncrement: Number(bidIncrement),
      excludedRowNumbers: [...excludedRowNumbers],
      saleType,
    });
    const finalRows = finalPreview.rows.map((row) => {
      const enhancement = aiEnhancements.get(row.rowNumber);
      if (!enhancement) return row;
      return {
        ...row,
        category: getBatchClothingCategory(enhancement.categoryId) ?? row.category,
        title: enhancement.enhancedTitle || row.title,
        description: enhancement.refinedDescription || row.description,
        storageClass: inferBatchStorageClass(
          enhancement.enhancedTitle || row.title,
          getBatchClothingCategory(enhancement.categoryId) ?? row.category,
        ),
        draft: row.draft ? {
          ...row.draft,
          title: enhancement.enhancedTitle || row.draft.title,
          description: enhancement.refinedDescription || row.draft.description,
        } : null,
      };
    });
    const finalPreviewWithAI = {
      ...finalPreview,
      rows: finalRows,
      drafts: finalPreview.canSubmit
        ? finalRows.flatMap((row) => row.draft ? [row.draft] : [])
        : [],
    };
    if (!finalPreviewWithAI.canSubmit || finalPreviewWithAI.drafts.length === 0) {
      setConfirmed(false);
      setError("오류가 있는 상품과 이미지 연결을 모두 확인해 주세요.");
      return;
    }

    const totalImages = finalPreviewWithAI.drafts.reduce(
      (total, draft) => total + draft.imageFiles.length,
      0,
    );
    setIsSubmitting(true);
    setSubmittedCount(0);
    setError("");
    setProgress({ completed: 0, total: Math.max(1, totalImages), phase: "uploading" });
    try {
      const count = await onSubmit(
        finalPreviewWithAI,
        selectedStoreId,
        { publicationMode, publishAt: finalPublishAt, saleType },
        (completed, total, phase) => {
          setProgress({
            completed: Math.min(Math.max(0, completed), Math.max(1, total)),
            total: Math.max(1, total),
            phase,
          });
        },
      );
      setSubmittedCount(count);
      setProgress({ completed: Math.max(1, totalImages), total: Math.max(1, totalImages), phase: "saving" });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "상품 일괄 등록을 완료하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const rowErrorCount = enhancedPreview?.rows.filter((row) =>
    row.issues.some((issue) => issue.severity === "error"),
  ).length ?? 0;
  const validationErrors = enhancedPreview?.rows.flatMap((row, index) =>
    row.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => `${index + 1}번 상품(엑셀 ${row.rowNumber}행): ${issue.message}`),
  ) ?? [];
  const progressValue = progressPercentage(progress);
  const completed = submittedCount > 0;

  return (
    <PremiumDialog
      ariaLabel="엑셀 상품 일괄 등록"
      closeDisabled={isSubmitting}
      onClose={handleClose}
      open={open}
      panelClassName="max-w-[1180px]"
      panelViewportClassName="max-h-[calc(100dvh-2rem)]"
      zIndexClassName="z-[100]"
    >
        <header className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-line bg-paper px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <p className="eyebrow text-muted">운영자 / 엑셀 일괄 등록</p>
            <h2 className="mt-2 text-xl font-black sm:text-2xl">엑셀 상품 일괄 등록</h2>
            <p className="mt-2 text-xs leading-5 text-muted">
              브라우저에서 파일을 분석하고 오류를 표시합니다. 확인 체크 전에는 서버에 상품을 저장하지 않습니다.
            </p>
          </div>
          <button
            aria-label="엑셀 일괄 등록 닫기"
            className="rounded-xl border border-line p-2 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95 disabled:opacity-40"
            disabled={isSubmitting}
            onClick={handleClose}
            type="button"
          >
            <X size={17} />
          </button>
        </header>

        <form className="space-y-6 p-4 sm:p-6" onSubmit={handleSubmit}>
          <section aria-label="엑셀 파일 선택" className="border border-line bg-surface p-4">
              <label className="text-sm font-bold" htmlFor={workbookId}>1. 번개장터 표준 엑셀</label>
              <input
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="mt-3 block w-full text-xs file:mr-3 file:border file:border-ink file:bg-paper file:px-3 file:py-2 file:text-xs file:font-bold"
                disabled={isParsing || isSubmitting || completed}
                id={workbookId}
                onChange={handleWorkbookSelection}
                ref={workbookInputRef}
                type="file"
              />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                1~5행은 안내로 건너뛰고 6행부터 첫 빈 행 전까지 읽습니다.
              </p>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                기존 고정 양식만 사용합니다. A 상품명 · B 카테고리 ID · D~H 사이즈 ·
                W 상태 · X 설명 · Y 가격 · AG 태그 · AH 이미지명 · AI 수량을 읽으며,
                빈티지 단품 수량은 항상 1개로 처리합니다.
              </p>
              {isParsing && <p className="mt-3 text-xs font-bold" role="status">엑셀 파일을 분석하는 중…</p>}
              {workbookFileName && !isParsing && (
                <div className="mt-3 bg-paper px-3 py-2 text-xs font-bold">
                  <p className="truncate">{workbookFileName}</p>
                </div>
              )}
          </section>

          {parsedWorkbook && (
            <section aria-label="일괄 등록 폴더 선택" className="border border-line bg-surface p-4">
              <label className="text-sm font-bold" htmlFor={directoryId}>2. 이미지 폴더 선택</label>
              <input
                {...directoryPickerAttributes}
                className="mt-3 block w-full text-xs file:mr-3 file:border file:border-ink file:bg-paper file:px-3 file:py-2 file:text-xs file:font-bold"
                disabled={isSubmitting || completed}
                id={directoryId}
                multiple
                onChange={handleDirectorySelection}
                ref={directoryInputRef}
                type="file"
              />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                선택한 폴더 바로 아래의 지원 이미지만 AH열 파일명과 대소문자 구분 없이 1:1로 연결합니다. 하위 폴더는 읽지 않습니다.
                {directoryName ? ` ${directoryName}에서 ${imageFiles.length.toLocaleString("ko-KR")}개를 읽었습니다.` : ""}
              </p>
              {ignoredNestedImageCount > 0 && (
                <p className="mt-1 text-[11px] leading-5 text-muted">
                  하위 폴더의 이미지 {ignoredNestedImageCount.toLocaleString("ko-KR")}개는 제외했습니다.
                </p>
              )}
              <p className="mt-1 text-[11px] leading-5 text-muted">지원 형식: {PRODUCT_IMAGE_FORMAT_LABEL}</p>
              <p className="mt-1 text-[11px] leading-5 text-amber-800">
                {PRODUCT_IMAGE_HEIC_CONVERSION_NOTE}
              </p>
            </section>
          )}

          <section aria-label="일괄 등록 옵션" className="border border-line p-4">
            <h3 className="text-sm font-bold">3. 등록 옵션</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs font-bold">
                활성 숍 자동 귀속
                <span className="mt-2 block min-h-11 border border-line bg-paper px-3 py-3 text-xs font-bold">
                  {selectedStore?.name ?? "활성 숍을 확인할 수 없음"}
                </span>
              </label>
              <label className="text-xs font-bold">
                {saleType === "auction" ? "전체 입찰 단위" : "가격 단위"}
                <input
                  className="mt-2 block w-full border border-line bg-paper px-3 py-3 text-xs disabled:opacity-40"
                  disabled={isSubmitting || completed}
                  max="100000000"
                  min="1"
                  onChange={(event) => { setBidIncrement(event.target.value); resetResult(); }}
                  step="1"
                  type="number"
                  value={bidIncrement}
                />
              </label>
              <label className="text-xs font-bold">
                판매 방식
                <select
                  className="mt-2 block w-full border border-line bg-paper px-3 py-3 text-xs"
                  disabled={isSubmitting || completed}
                  onChange={(event) => {
                    const nextSaleType = event.target.value as XlsxRegistrationOptions["saleType"];
                    setSaleType(nextSaleType);
                    if (nextSaleType === "auction") {
                      setScheduledPublishAt(nextDayTenKstInput());
                    }
                    setReferenceNow(Date.now());
                    resetResult();
                  }}
                  value={saleType}
                >
                  <option value="fixed">아카이브숍 (즉시구매)</option>
                  <option value="auction">라이브 옥션 (경매)</option>
                </select>
              </label>
              <label className="text-xs font-bold">
                공개 시점
                <select
                  className="mt-2 block w-full border border-line bg-paper px-3 py-3 text-xs"
                  disabled={isSubmitting || completed}
                  onChange={(event) => {
                    const nextMode = event.target.value as XlsxRegistrationOptions["publicationMode"];
                    setPublicationMode(nextMode);
                    if (nextMode === "scheduled" && saleType === "auction") {
                      setScheduledPublishAt(nextDayTenKstInput());
                    }
                    setReferenceNow(Date.now());
                    resetResult();
                  }}
                  value={publicationMode}
                >
                  <option value="now">즉시 공개</option>
                  <option value="scheduled">예약 공개</option>
                </select>
              </label>
              {publicationMode === "scheduled" && (
                <label className="text-xs font-bold">
                  예약 공개 시각 (KST)
                  <input
                    className="mt-2 block w-full border border-line bg-paper px-3 py-3 text-xs"
                    disabled={isSubmitting || completed}
                    min={new Date(referenceNow + 9 * 60 * 60 * 1000).toISOString().slice(0, 16)}
                    onChange={(event) => {
                      setScheduledPublishAt(event.target.value);
                      setReferenceNow(Date.now());
                      resetResult();
                    }}
                    required
                    type="datetime-local"
                    value={scheduledPublishAt}
                  />
                </label>
              )}
            </div>
            <p className="mt-3 border border-amber-200 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-900">
              {selectedStoreCanPublish
                ? publicationMode === "now"
                  ? "등록이 끝난 상품은 즉시 공개됩니다."
                  : `${scheduledPublishAt.replace("T", " ")} KST에 일괄 공개됩니다.`
                : "공개 권한이 없으면 상품은 등록 대기로 저장됩니다."} 현재 로그인 세션의 활성 숍에만 귀속되며 서버에서 다시 검증합니다.
            </p>
          </section>

          {parsedWorkbook?.detectedHeaders && (
            <section aria-label="자동 탐지 결과" className="border border-line bg-surface p-4">
              <h3 className="text-sm font-bold">자동 탐지 결과</h3>
              <p className="mt-2 text-xs text-muted">
                {parsedWorkbook.detectedHeaders.sheetName} 시트 · {parsedWorkbook.detectedHeaders.headerRowNumber}행 헤더
              </p>
            </section>
          )}

          {enhancedPreview && (
            <section aria-label="상품별 검증 미리보기">
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <h3 className="text-sm font-bold">4. 상품별 검증 미리보기</h3>
                  <p className="mt-1 text-xs text-muted">
                    총 {enhancedPreview.rows.length.toLocaleString("ko-KR")}개 상품 · 오류 {rowErrorCount.toLocaleString("ko-KR")}개 상품 · 미사용 사진 {enhancedPreview.unusedImageFiles.length.toLocaleString("ko-KR")}개
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!accessToken || isEnhancing || isSubmitting || enhancedPreview.rows.length === 0} onClick={() => void handleAiEnhancement()} size="compact" type="button">
                    {isEnhancing ? `AI 보정 중 ${aiProgress?.completed ?? 0}/${aiProgress?.total ?? 0}` : "Gemini AI 자동 보정"}
                  </Button>
                  <span className={`border px-3 py-2 text-xs font-bold ${enhancedPreview.canSubmit ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800"}`}>
                    {enhancedPreview.canSubmit ? "등록 준비 완료" : "오류 확인 필요"}
                  </span>
                </div>
              </div>

              {validationErrors.length > 0 && (
                <div className="mt-4 border border-red-300 bg-red-50 p-4 text-red-900" role="alert">
                  <p className="text-xs font-black">등록을 막는 오류 {validationErrors.length.toLocaleString("ko-KR")}건</p>
                  <ul className="mt-2 max-h-36 list-disc space-y-1 overflow-auto pl-5 text-[11px] leading-5">
                    {validationErrors.map((message) => <li key={message}>{message}</li>)}
                  </ul>
                </div>
              )}

              {enhancedPreview.globalIssues.length > 0 && (
                <ul className="mt-3 space-y-2" role="alert">
                  {enhancedPreview.globalIssues.map((issue, index) => (
                    <li className={`border px-4 py-3 text-xs font-bold ${issueClasses(issue)}`} key={`${issue.code}-${index}`}>
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 max-h-[430px] overflow-auto border border-line">
                <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 border-b border-line bg-surface">
                    <tr>
                      <th className="px-3 py-3">상품 순번</th>
                      <th className="px-3 py-3">상품</th>
                      <th className="px-3 py-3">카테고리</th>
                      <th className="px-3 py-3">사이즈</th>
                      <th className="px-3 py-3">등급</th>
                      <th className="px-3 py-3">가격</th>
                      <th className="px-3 py-3">보관</th>
                      <th className="px-3 py-3">필요/연결 이미지</th>
                      <th className="px-3 py-3">검증 결과</th>
                      <th className="px-3 py-3">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {enhancedPreview.rows.map((row, productIndex) => {
                      const hasRowError = row.issues.some((issue) => issue.severity === "error");
                      const aiApplied = aiEnhancements.has(row.rowNumber);
                      return (
                        <tr aria-invalid={hasRowError} className={hasRowError ? "bg-red-50" : "bg-paper"} key={row.rowNumber}>
                          <td className="px-3 py-3 align-top font-bold">{productIndex + 1}번째</td>
                          <td className="max-w-[320px] px-3 py-3 align-top">
                            <p className="font-bold">{row.title || "상품명 없음"}</p>
                            <p className="mt-1 text-[10px] text-muted">브랜드 {inferBrandFromTitle(row.title).brand}</p>
                            {aiApplied && <p className="mt-1 text-[10px] font-bold text-violet-700">AI 보정 적용 · 등록 전 확인 필요</p>}
                            <p className="mt-1 whitespace-pre-line leading-5 text-muted">{row.description || "설명 없음"}</p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 align-top">
                            <p className="font-mono font-bold">{row.category?.id ?? "미인식"}</p>
                            <p className="mt-1 text-[10px] text-muted">{row.category?.label ?? "기타"}</p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 align-top font-bold">{row.size || "미입력"}</td>
                          <td className="px-3 py-3 align-top font-black">{row.condition ?? "오류"}</td>
                          <td className="whitespace-nowrap px-3 py-3 align-top font-mono font-bold">
                            {row.startingPrice === null ? "확인 필요" : formatKRW(row.startingPrice)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 align-top font-bold">
                            {row.storageClass === "large" ? "Large · 7일" : "Small · 14일"}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <p className="font-bold">{row.imageNames.length.toLocaleString("ko-KR")} / {row.imageMatches.length.toLocaleString("ko-KR")}장</p>
                            {row.imageMatches.length > 0 && (
                              <div className="mt-2 flex max-w-[220px] gap-1 overflow-x-auto">
                                {row.imageMatches.slice(0, 4).map((match) => (
                                  <MatchedImageThumbnail file={match.file} key={`${match.reference}-${match.file.name}`} />
                                ))}
                              </div>
                            )}
                            <p className="mt-1 max-w-[240px] break-all text-[10px] text-muted">{row.imageNames.join(", ") || "이미지명 없음"}</p>
                          </td>
                          <td className="px-3 py-3 align-top">
                            {row.issues.length === 0 ? (
                              <span className="font-bold text-emerald-700">정상</span>
                            ) : (
                              <ul className="space-y-1" role={hasRowError ? "alert" : undefined}>
                                {row.issues.map((issue, index) => (
                                  <li className={issue.severity === "error" ? "font-bold text-red-800" : "font-bold text-amber-800"} key={`${issue.code}-${index}`}>
                                    {issue.message}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <button
                              aria-label={`${productIndex + 1}번째 상품 삭제`}
                              className="inline-flex items-center gap-1 whitespace-nowrap border border-red-200 px-3 py-2 font-bold text-red-700"
                              disabled={isSubmitting || completed || isEnhancing}
                              onClick={() => {
                                setExcludedRowNumbers((current) => {
                                  const next = new Set(current);
                                  next.add(row.rowNumber);
                                  return next;
                                });
                                resetResult();
                              }}
                              type="button"
                            >
                              <Trash2 size={13} /> 상품 삭제
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {progress && (
            <section aria-live="polite" className="border border-line bg-surface p-4">
              <div className="flex items-center justify-between text-xs font-bold">
                <span>{completed ? `${submittedCount.toLocaleString("ko-KR")}개 상품 저장 완료` : progress.phase === "uploading" ? "상품 사진 압축·업로드 중…" : "검증된 상품을 저장하는 중…"}</span>
                <span>{progress.completed.toLocaleString("ko-KR")} / {progress.total.toLocaleString("ko-KR")}</span>
              </div>
              <div aria-label="상품 일괄 등록 진행률" aria-valuemax={100} aria-valuemin={0} aria-valuenow={progressValue} className="mt-3 h-2 overflow-hidden bg-paper" role="progressbar">
                <div className="h-full bg-ink transition-[width]" style={{ width: `${progressValue}%` }} />
              </div>
            </section>
          )}

          {error && <p className="border border-red-300 bg-red-50 px-4 py-3 text-xs font-bold text-red-800" role="alert">{error}</p>}

          {!completed && (
            <label className={`flex items-start gap-3 border px-4 py-3 text-xs font-bold ${enhancedPreview?.canSubmit ? "border-ink" : "border-line text-muted"}`}>
              <input
                checked={confirmed}
                disabled={!enhancedPreview?.canSubmit || isParsing || isSubmitting || isEnhancing || !selectedStoreId}
                onChange={(event) => { setConfirmed(event.target.checked); setError(""); }}
                type="checkbox"
              />
              검증 결과, 이미지 연결, 자동 보관 규격, 활성 숍 귀속과 {enhancedPreview?.rows.length ?? 0}개 {saleType === "auction" ? "경매" : "즉시 구매"} 상품을 모두 확인했습니다. 이제 데이터베이스 저장을 허용합니다.
            </label>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-5">
            <Button disabled={isSubmitting} onClick={handleClose} type="button">{completed ? "닫기" : "취소"}</Button>
            {!completed && (
              <Button className="inline-flex items-center gap-2" disabled={!confirmed || !enhancedPreview?.canSubmit || isParsing || isSubmitting || isEnhancing || !selectedStoreId} type="submit" variant="primary">
                <FileSpreadsheet size={14} />
                {isSubmitting ? "등록 중…" : `총 ${enhancedPreview?.rows.length ?? 0}개 상품 일괄 등록`}
              </Button>
            )}
          </div>
        </form>
    </PremiumDialog>
  );
}
