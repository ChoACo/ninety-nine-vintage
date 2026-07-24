"use client";

import { FileSpreadsheet, X } from "lucide-react";
import {
  useId,
  useCallback,
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
  parseAuctionWorkbook,
  type BatchAuctionIssue,
  type BatchAuctionPreview,
  type BatchAuctionProgressPhase,
  type BatchAuctionProgressReporter,
  type ParsedAuctionWorkbook,
} from "@/lib/import/batchAuction";
import {
  PRODUCT_IMAGE_FORMAT_LABEL,
  PRODUCT_IMAGE_HEIC_CONVERSION_NOTE,
  PRODUCT_IMAGE_INPUT_ACCEPT,
} from "@/lib/supabase/productImagePolicy";
import { formatKRW, getNextAuctionPublishAt } from "@/utils/formatters";

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
  open: boolean;
  stores: readonly StoreOption[];
  onClose: () => void;
  onSubmit: (
    preview: BatchAuctionPreview,
    storeId: string,
    onProgress: BatchAuctionProgressReporter,
  ) => Promise<number>;
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
    : "border-amber-300 bg-amber-50 text-amber-900";
}

function progressPercentage(progress: SubmitProgress | null) {
  if (!progress || progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((progress.completed / progress.total) * 100)));
}

function resetInput(input: HTMLInputElement | null) {
  if (input) input.value = "";
}

export function OperatorXlsxImportModal({
  open,
  stores,
  onClose,
  onSubmit,
}: Readonly<OperatorXlsxImportModalProps>) {
  const [workbookFileName, setWorkbookFileName] = useState("");
  const [parsedWorkbook, setParsedWorkbook] = useState<ParsedAuctionWorkbook | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [storeId, setStoreId] = useState("");
  const [bidIncrement, setBidIncrement] = useState("1000");
  const [confirmed, setConfirmed] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<SubmitProgress | null>(null);
  const parseRequestRef = useRef(0);
  const workbookInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const multipleInputRef = useRef<HTMLInputElement>(null);
  const workbookId = useId();
  const directoryId = useId();
  const multipleImagesId = useId();

  const preview = useMemo(() => {
    if (!parsedWorkbook) return null;
    return buildBatchAuctionPreview(parsedWorkbook, imageFiles, {
      publishAt: PREVIEW_PUBLISH_AT,
      bidIncrement: Number(bidIncrement),
    });
  }, [bidIncrement, imageFiles, parsedWorkbook]);
  const selectedStoreId = stores.some((store) => store.id === storeId)
    ? storeId
    : stores[0]?.id ?? "";
  const selectedStoreCanPublish = stores.find((store) => store.id === selectedStoreId)?.canPublish === true;
  const resetResult = useCallback(() => {
    setConfirmed(false);
    setSubmittedCount(0);
    setError("");
    setProgress(null);
  }, []);

  const reset = useCallback(() => {
    parseRequestRef.current += 1;
    setWorkbookFileName("");
    setParsedWorkbook(null);
    setImageFiles([]);
    setStoreId(stores[0]?.id ?? "");
    setBidIncrement("1000");
    setConfirmed(false);
    setIsParsing(false);
    setIsSubmitting(false);
    setSubmittedCount(0);
    setError("");
    setProgress(null);
    resetInput(workbookInputRef.current);
    resetInput(directoryInputRef.current);
    resetInput(multipleInputRef.current);
  }, [stores]);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    reset();
    onClose();
  }, [isSubmitting, onClose, reset]);

  const handleWorkbookSelection = async (event: ChangeEvent<HTMLInputElement>) => {
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
      if (requestId === parseRequestRef.current) setParsedWorkbook(parsed);
    } catch (parseError) {
      if (requestId === parseRequestRef.current) {
        setError(parseError instanceof Error ? parseError.message : "엑셀 파일을 읽지 못했습니다.");
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
    resetInput(source === "directory" ? multipleInputRef.current : directoryInputRef.current);
    resetResult();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!confirmed) {
      setError("검증 결과와 저장 대상을 확인했다는 항목에 체크해 주세요.");
      return;
    }
    if (!selectedStoreId || !stores.some((store) => store.id === selectedStoreId)) {
      setError("등록 권한이 있는 숍을 선택해 주세요.");
      return;
    }
    if (!parsedWorkbook) {
      setError("엑셀 파일을 먼저 선택해 주세요.");
      return;
    }

    const finalPreview = buildBatchAuctionPreview(parsedWorkbook, imageFiles, {
      publishAt: getNextAuctionPublishAt(new Date()).toISOString(),
      bidIncrement: Number(bidIncrement),
    });
    if (!finalPreview.canSubmit || finalPreview.drafts.length === 0) {
      setConfirmed(false);
      setError("오류가 있는 행과 이미지 연결을 모두 확인해 주세요.");
      return;
    }

    const totalImages = finalPreview.drafts.reduce(
      (total, draft) => total + draft.imageFiles.length,
      0,
    );
    setIsSubmitting(true);
    setSubmittedCount(0);
    setError("");
    setProgress({ completed: 0, total: Math.max(1, totalImages), phase: "uploading" });
    try {
      const count = await onSubmit(
        finalPreview,
        selectedStoreId,
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

  const rowErrorCount = preview?.rows.filter((row) =>
    row.issues.some((issue) => issue.severity === "error"),
  ).length ?? 0;
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
          <section aria-label="일괄 등록 파일 선택" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="border border-line bg-surface p-4">
              <label className="text-sm font-bold" htmlFor={workbookId}>1. 엑셀 파일</label>
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
                기존 고정 양식만 사용합니다. 1~5행은 안내로 제외하고 6행부터 A열 상품명,
                D열 여성·남성 의류, E열 여성·남성 하의, F열 스포츠·등산복 사이즈,
                W열 상태점수, X열 원문, Y열 시작가, AH열 이미지명을 읽습니다. 행 안의
                등록된 여성·남성 의류 카테고리 ID는 성별·대분류·세부 품목으로 자동 변환합니다.
              </p>
              {isParsing && <p className="mt-3 text-xs font-bold" role="status">엑셀 파일을 분석하는 중…</p>}
              {workbookFileName && !isParsing && <p className="mt-3 truncate bg-paper px-3 py-2 text-xs font-bold">{workbookFileName}</p>}
            </div>

            <div className="border border-line bg-surface p-4">
              <p className="text-sm font-bold">2. 상품 사진</p>
              <label className="mt-3 block text-xs font-bold" htmlFor={directoryId}>사진 폴더 선택</label>
              <input
                {...directoryPickerAttributes}
                accept={PRODUCT_IMAGE_INPUT_ACCEPT}
                className="mt-2 block w-full text-xs file:mr-3 file:border file:border-ink file:bg-paper file:px-3 file:py-2 file:text-xs file:font-bold"
                disabled={isSubmitting || completed}
                id={directoryId}
                multiple
                onChange={(event) => handleImageSelection(event, "directory")}
                ref={directoryInputRef}
                type="file"
              />
              <label className="mt-3 block text-xs font-bold" htmlFor={multipleImagesId}>또는 여러 사진 선택</label>
              <input
                accept={PRODUCT_IMAGE_INPUT_ACCEPT}
                className="mt-2 block w-full text-xs file:mr-3 file:border file:border-ink file:bg-paper file:px-3 file:py-2 file:text-xs file:font-bold"
                disabled={isSubmitting || completed}
                id={multipleImagesId}
                multiple
                onChange={(event) => handleImageSelection(event, "multiple")}
                ref={multipleInputRef}
                type="file"
              />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                {imageFiles.length.toLocaleString("ko-KR")}개 선택 · {PRODUCT_IMAGE_FORMAT_LABEL}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-amber-800">
                {PRODUCT_IMAGE_HEIC_CONVERSION_NOTE}
              </p>
            </div>
          </section>

          <section aria-label="일괄 등록 옵션" className="border border-line p-4">
            <h3 className="text-sm font-bold">3. 등록 옵션</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs font-bold">
                저장할 숍
                <select
                  className="mt-2 block w-full border border-line bg-paper px-3 py-3 text-xs"
                  disabled={isSubmitting || completed}
                  onChange={(event) => { setStoreId(event.target.value); resetResult(); }}
                  required
                  value={selectedStoreId}
                >
                  <option value="">권한이 있는 숍 선택</option>
                  {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold">
                전체 입찰 단위
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
            </div>
            <p className="mt-3 border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
              {selectedStoreCanPublish
                ? "등록이 끝난 상품은 즉시 공개됩니다."
                : "공개 권한이 없으면 상품은 초안으로 저장됩니다."} 숍 선택지는 현재 계정의 서버 검증 권한 범위만 표시됩니다.
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

          {preview && (
            <section aria-label="상품 행별 검증 미리보기">
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <h3 className="text-sm font-bold">4. 행별 검증 미리보기</h3>
                  <p className="mt-1 text-xs text-muted">
                    총 {preview.rows.length.toLocaleString("ko-KR")}행 · 오류 {rowErrorCount.toLocaleString("ko-KR")}행 · 미사용 사진 {preview.unusedImageFiles.length.toLocaleString("ko-KR")}개
                  </p>
                </div>
                <span className={`border px-3 py-2 text-xs font-bold ${preview.canSubmit ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800"}`}>
                  {preview.canSubmit ? "등록 준비 완료" : "오류 확인 필요"}
                </span>
              </div>

              {preview.globalIssues.length > 0 && (
                <ul className="mt-3 space-y-2" role="alert">
                  {preview.globalIssues.map((issue, index) => (
                    <li className={`border px-4 py-3 text-xs font-bold ${issueClasses(issue)}`} key={`${issue.code}-${index}`}>
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 max-h-[430px] overflow-auto border border-line">
                <table className="w-full min-w-[900px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 border-b border-line bg-surface">
                    <tr>
                      <th className="px-3 py-3">행</th>
                      <th className="px-3 py-3">상품</th>
                      <th className="px-3 py-3">확인 브랜드</th>
                      <th className="px-3 py-3">카테고리 ID</th>
                      <th className="px-3 py-3">시작가</th>
                      <th className="px-3 py-3">연결 사진</th>
                      <th className="px-3 py-3">검증 결과</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.rows.map((row) => {
                      const hasRowError = row.issues.some((issue) => issue.severity === "error");
                      return (
                        <tr aria-invalid={hasRowError} className={hasRowError ? "bg-red-50" : "bg-paper"} key={row.rowNumber}>
                          <td className="px-3 py-3 align-top font-bold">{row.rowNumber}</td>
                          <td className="max-w-[320px] px-3 py-3 align-top">
                            <p className="font-bold">{row.title || "상품명 없음"}</p>
                            <p className="mt-1 whitespace-pre-line leading-5 text-muted">{row.description || "설명 없음"}</p>
                          </td>
                          <td className="px-3 py-3 align-top font-bold">{inferBrandFromTitle(row.title).brand}</td>
                          <td className="whitespace-nowrap px-3 py-3 align-top">
                            <p className="font-mono font-bold">{row.category?.id ?? "미인식"}</p>
                            <p className="mt-1 text-[10px] text-muted">{row.category?.label ?? "기타"}</p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 align-top font-mono font-bold">
                            {row.startingPrice === null ? "확인 필요" : formatKRW(row.startingPrice)}
                          </td>
                          <td className="px-3 py-3 align-top">
                            {row.imageMatches.length.toLocaleString("ko-KR")}장
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
            <label className={`flex items-start gap-3 border px-4 py-3 text-xs font-bold ${preview?.canSubmit ? "border-ink" : "border-line text-muted"}`}>
              <input
                checked={confirmed}
                disabled={!preview?.canSubmit || isParsing || isSubmitting || !selectedStoreId}
                onChange={(event) => { setConfirmed(event.target.checked); setError(""); }}
                type="checkbox"
              />
              검증 결과, 자동 추출 브랜드, 저장할 숍과 {preview?.rows.length ?? 0}개 경매 상품을 모두 확인했습니다. 이제 데이터베이스 저장을 허용합니다.
            </label>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-5">
            <Button disabled={isSubmitting} onClick={handleClose} type="button">{completed ? "닫기" : "취소"}</Button>
            {!completed && (
              <Button className="inline-flex items-center gap-2" disabled={!confirmed || !preview?.canSubmit || isParsing || isSubmitting || !selectedStoreId} type="submit" variant="primary">
                <FileSpreadsheet size={14} />
                {isSubmitting ? "등록 중…" : `${preview?.rows.length ?? 0}개 검증 완료 상품 저장`}
              </Button>
            )}
          </div>
        </form>
    </PremiumDialog>
  );
}
