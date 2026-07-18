"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import Button from "@/src/components/common/Button";
import {
  getShippingWorkPage,
  saveShippingTrackingBatch,
  type ShippingWork,
} from "@/src/lib/supabase/operations";
import { normalizeShippingAddressSnapshot } from "@/src/lib/shipping/excel";
import {
  downloadShippingRequestsWorkbook,
  parseTrackingWorkbook,
  type ParsedTrackingWorkbook,
} from "@/src/lib/shipping/workbook";

const DEFAULT_COURIER = "한진택배";
const PAGE_SIZE = 100;

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAddressSnapshot(snapshot: unknown): string {
  const address = normalizeShippingAddressSnapshot(snapshot);
  const fullAddress = [address.postalCode, address.address]
    .filter(Boolean)
    .join(" ");
  return [address.recipientName, address.phone, fullAddress]
    .filter(Boolean)
    .join(" · ") || "배송지 정보를 확인할 수 없습니다.";
}

export function ShippingWorkPanel({
  canAccessCompleted = false,
}: {
  canAccessCompleted?: boolean;
}) {
  const [items, setItems] = useState<ShippingWork[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [courierById, setCourierById] = useState<Record<string, string>>({});
  const [trackingById, setTrackingById] = useState<Record<string, string>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isApplyingImport, setIsApplyingImport] = useState(false);
  const [exportPaymentTerm, setExportPaymentTerm] =
    useState<"선불" | "착불" | "신용">("선불");
  const [bulkCourier, setBulkCourier] = useState(DEFAULT_COURIER);
  const [trackingPreview, setTrackingPreview] =
    useState<ParsedTrackingWorkbook | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const trackingFileRef = useRef<HTMLInputElement>(null);
  const dirtyTrackingIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const page = await getShippingWorkPage({
        includeShipped: canAccessCompleted,
        limit: PAGE_SIZE,
        offset: pageOffset,
      });
      const nextItems = page.items;
      setTotalCount(page.totalCount);
      if (nextItems.length === 0 && page.totalCount > 0 && pageOffset > 0) {
        setPageOffset(Math.max(0, pageOffset - PAGE_SIZE));
        return;
      }
      const visibleIds = new Set(nextItems.map((item) => item.requestId));
      dirtyTrackingIdsRef.current = new Set(
        [...dirtyTrackingIdsRef.current].filter((requestId) =>
          visibleIds.has(requestId),
        ),
      );
      const currentIds = new Set(
        nextItems
          .filter((item) => item.status === "requested")
          .map((item) => item.requestId),
      );
      setItems(nextItems);
      setSelectedIds((current) =>
        new Set([...current].filter((requestId) => currentIds.has(requestId))),
      );
      setCourierById((current) =>
        Object.fromEntries(
          nextItems.map((item) => [
            item.requestId,
            dirtyTrackingIdsRef.current.has(item.requestId)
              ? current[item.requestId] ?? item.courier ?? DEFAULT_COURIER
              : item.courier ?? DEFAULT_COURIER,
          ]),
        ),
      );
      setTrackingById((current) =>
        Object.fromEntries(
          nextItems.map((item) => [
            item.requestId,
            dirtyTrackingIdsRef.current.has(item.requestId)
              ? current[item.requestId] ?? item.trackingNumber ?? ""
              : item.trackingNumber ?? "",
          ]),
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "배송 업무 목록을 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [canAccessCompleted, pageOffset]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectableItems = useMemo(
    () => items.filter((item) => item.status === "requested"),
    [items],
  );
  const allSelected =
    selectableItems.length > 0 && selectedIds.size === selectableItems.length;
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selectedIds.size > 0 && selectedIds.size < selectableItems.length;
    }
  }, [selectableItems.length, selectedIds]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.requestId)),
    [items, selectedIds],
  );
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.requestId, item])),
    [items],
  );
  const pageStart = totalCount === 0 ? 0 : pageOffset + 1;
  const pageEnd = Math.min(pageOffset + items.length, totalCount);
  const hasPreviousPage = pageOffset > 0;
  const hasNextPage = pageOffset + items.length < totalCount;
  const isBusy =
    processingId !== null || isExporting || isImporting || isApplyingImport;

  const toggleAll = () => {
    setSelectedIds(
      allSelected
        ? new Set()
        : new Set(selectableItems.map((item) => item.requestId)),
    );
  };

  const toggleOne = (requestId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });
  };

  const saveTracking = async (item: ShippingWork) => {
    const courier = courierById[item.requestId]?.trim() ?? "";
    const trackingNumber = trackingById[item.requestId]?.trim() ?? "";
    if (!courier || !trackingNumber) {
      setError("택배사와 운송장 번호를 모두 입력해 주세요.");
      return;
    }
    setProcessingId(item.requestId);
    setError("");
    setNotice("");
    try {
      await saveShippingTrackingBatch([
        {
          requestId: item.requestId,
          courier,
          trackingNumber,
          expectedUpdatedAt: item.updatedAt,
        },
      ]);
      dirtyTrackingIdsRef.current.delete(item.requestId);
      await load();
      setNotice(
        item.status === "shipped"
          ? "운송장 정보를 수정했습니다."
          : "운송장을 등록하고 발송 완료로 처리했습니다.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "운송장 정보를 저장하지 못했습니다.",
      );
    } finally {
      setProcessingId(null);
    }
  };

  const exportSelected = async () => {
    setIsExporting(true);
    setError("");
    setNotice("");
    try {
      await downloadShippingRequestsWorkbook(selectedItems, {
        paymentTerm: exportPaymentTerm,
      });
      setNotice(
        `선택한 배송 신청 ${selectedItems.length.toLocaleString("ko-KR")}건을 Excel로 만들었습니다. 파일은 서버에 업로드되지 않았습니다.`,
      );
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "배송 신청 Excel을 만들지 못했습니다.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const selectTrackingWorkbook = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    setTrackingPreview(null);
    setError("");
    setNotice("");
    if (!file) return;

    setIsImporting(true);
    try {
      setTrackingPreview(await parseTrackingWorkbook(file, items));
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? parseError.message
          : "송장 Excel을 읽지 못했습니다.",
      );
    } finally {
      setIsImporting(false);
    }
  };

  const clearTrackingPreview = () => {
    setTrackingPreview(null);
    if (trackingFileRef.current) trackingFileRef.current.value = "";
  };

  const applyTrackingWorkbook = async () => {
    const courier = bulkCourier.trim();
    const matched = trackingPreview?.matches.matched ?? [];
    if (!courier) {
      setError("Excel 운송장에 적용할 택배사를 입력해 주세요.");
      return;
    }
    if (matched.length === 0) {
      setError("안전하게 연결된 운송장 내역이 없습니다.");
      return;
    }

    setIsApplyingImport(true);
    setError("");
    setNotice("");
    try {
      await saveShippingTrackingBatch(
        matched.map((entry) => {
          const item = itemsById.get(entry.requestId);
          if (!item) {
            throw new Error(
              `Excel ${entry.row.rowNumber}행의 배송 신청이 현재 페이지에 없습니다. 파일을 다시 확인해 주세요.`,
            );
          }
          return {
            requestId: entry.requestId,
            courier,
            trackingNumber: entry.trackingNumber,
            expectedUpdatedAt: item.updatedAt,
          };
        }),
      );
      const savedCount = matched.length;
      matched.forEach((entry) =>
        dirtyTrackingIdsRef.current.delete(entry.requestId),
      );
      clearTrackingPreview();
      await load();
      setNotice(
        `안전하게 연결된 운송장 ${savedCount.toLocaleString("ko-KR")}건을 등록했습니다. 기존 운송장은 새 값으로 수정되었습니다.`,
      );
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "Excel 운송장을 등록하지 못했습니다.",
      );
    } finally {
      setIsApplyingImport(false);
    }
  };

  const importProblemCount = trackingPreview
    ? trackingPreview.matches.ambiguous.length +
      trackingPreview.matches.unmatched.length +
      trackingPreview.parsed.skippedRows.length
    : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[var(--text-strong)]">
            택배 신청·운송장 업무
          </p>
          <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-muted)]">
            전체 {totalCount.toLocaleString("ko-KR")}건 중 {pageStart.toLocaleString("ko-KR")}~{pageEnd.toLocaleString("ko-KR")}건을 표시합니다. 운송장 파일은 브라우저에서만 읽고 고객 주소를 서버에 별도 업로드하지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="배송 내역 페이지 이동">
          <Button
            size="sm"
            variant="ghost"
            disabled={!hasPreviousPage || isBusy}
            onClick={() => setPageOffset((current) => Math.max(0, current - PAGE_SIZE))}
          >
            이전 100건
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!hasNextPage || isBusy}
            onClick={() => setPageOffset((current) => current + PAGE_SIZE)}
          >
            다음 100건
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void load()} isLoading={isLoading}>
            새로고침
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-2xl border border-[var(--danger-text)]/25 bg-[var(--danger-surface)] px-4 py-3 text-sm font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 rounded-2xl border border-[var(--success-text)]/25 bg-[var(--success-surface)] px-4 py-3 text-sm font-bold text-[var(--success-text)]">
          {notice}
        </p>
      ) : null}

      <section className="mt-4 rounded-[1.4rem] border border-[var(--border)] bg-[var(--surface-muted)] p-4" aria-label="배송 신청 Excel 내보내기">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-black text-[var(--text-strong)]">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={selectableItems.length === 0 || isBusy}
              className="h-5 w-5 rounded accent-[var(--accent)]"
            />
            현재 페이지 배송 대기 전체 선택 ({selectedIds.size.toLocaleString("ko-KR")}/{selectableItems.length.toLocaleString("ko-KR")})
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-black text-[var(--text-muted)]">
              지불조건(J열)
              <select
                value={exportPaymentTerm}
                onChange={(event) =>
                  setExportPaymentTerm(
                    event.target.value as "선불" | "착불" | "신용",
                  )
                }
                disabled={isBusy}
                className="mt-1 block min-h-10 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm font-bold text-[var(--foreground)]"
              >
                <option value="선불">선불</option>
                <option value="착불">착불</option>
                <option value="신용">신용</option>
              </select>
            </label>
            <Button
              size="sm"
              variant="secondary"
              isLoading={isExporting}
              disabled={selectedItems.length === 0 || isBusy}
              onClick={() => void exportSelected()}
            >
              선택 신청 Excel 내보내기
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs font-semibold leading-5 text-[var(--text-muted)]">
          받는 분·연락처·5자리 우편번호·주소가 모두 있는 배송 대기 항목만 A~P 택배 양식으로 만듭니다. 발송 완료 건은 중복 발송 방지를 위해 선택에서 제외되며, 수량은 1, 품목은 의류로 기록됩니다.
        </p>
      </section>

      <section className="mt-4 rounded-[1.4rem] border border-[var(--border)] bg-[var(--surface)] p-4" aria-label="송장 Excel 등록">
        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-end">
          <label className="text-sm font-black text-[var(--text-strong)]">
            적용 택배사
            <input
              value={bulkCourier}
              onChange={(event) => setBulkCourier(event.target.value)}
              maxLength={80}
              disabled={isBusy}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm font-semibold text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="text-sm font-black text-[var(--text-strong)]">
            송장 Excel (.xlsx)
            <input
              ref={trackingFileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => void selectTrackingWorkbook(event)}
              disabled={isBusy || items.length === 0}
              className="mt-2 block w-full text-sm font-semibold text-[var(--text-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--info-surface)] file:px-4 file:py-2.5 file:text-sm file:font-black file:text-[var(--info-text)] disabled:opacity-60"
            />
          </label>
        </div>
        <p className="mt-2 text-xs font-semibold leading-5 text-[var(--text-muted)]">
          현재 페이지 내역과만 대조하며 순번으로 추측하지 않습니다. 받는 분과 연락처를 반드시 대조하고, 입력된 경우 우편번호·주소까지 같은 신청만 자동 연결합니다.
        </p>
        {isImporting ? (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm font-black text-[var(--info-text)]">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
            송장 Excel을 브라우저에서 확인하는 중…
          </p>
        ) : null}

        {trackingPreview ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="break-all text-sm font-black text-[var(--text-strong)]">
                  {trackingPreview.fileName} · {trackingPreview.sheetName}
                </p>
                <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">
                  연결 성공 {trackingPreview.matches.matched.length.toLocaleString("ko-KR")}건 · 확인 필요 {importProblemCount.toLocaleString("ko-KR")}건
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={clearTrackingPreview} disabled={isApplyingImport}>
                파일 취소
              </Button>
            </div>

            <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]">
              <table className="min-w-[720px] w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-[var(--surface-muted)] text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2 font-black">행</th>
                    <th className="px-3 py-2 font-black">받는 분</th>
                    <th className="px-3 py-2 font-black">연락처</th>
                    <th className="px-3 py-2 font-black">운송장번호</th>
                    <th className="px-3 py-2 font-black">연결 결과</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-[var(--foreground)]">
                  {trackingPreview.matches.matched.map((entry) => (
                    <tr key={`matched-${entry.row.rowNumber}`}>
                      <td className="px-3 py-2 font-bold">{entry.row.rowNumber}</td>
                      <td className="px-3 py-2 font-bold">{entry.row.recipientName}</td>
                      <td className="px-3 py-2">{entry.row.phone || entry.row.mobile}</td>
                      <td className="px-3 py-2 font-bold">{entry.trackingNumber}</td>
                      <td className="px-3 py-2 font-black text-[var(--success-text)]">연결됨</td>
                    </tr>
                  ))}
                  {trackingPreview.matches.ambiguous.map((entry) => (
                    <tr key={`ambiguous-${entry.row.rowNumber}`}>
                      <td className="px-3 py-2 font-bold">{entry.row.rowNumber}</td>
                      <td className="px-3 py-2 font-bold">{entry.row.recipientName}</td>
                      <td className="px-3 py-2">{entry.row.phone || entry.row.mobile}</td>
                      <td className="px-3 py-2 font-bold">{entry.row.trackingNumber}</td>
                      <td className="px-3 py-2 font-bold text-[var(--warning-text)]">{entry.reason}</td>
                    </tr>
                  ))}
                  {trackingPreview.matches.unmatched.map((entry) => (
                    <tr key={`unmatched-${entry.row.rowNumber}`}>
                      <td className="px-3 py-2 font-bold">{entry.row.rowNumber}</td>
                      <td className="px-3 py-2 font-bold">{entry.row.recipientName}</td>
                      <td className="px-3 py-2">{entry.row.phone || entry.row.mobile}</td>
                      <td className="px-3 py-2 font-bold">{entry.row.trackingNumber}</td>
                      <td className="px-3 py-2 font-bold text-[var(--danger-text)]">{entry.reason}</td>
                    </tr>
                  ))}
                  {trackingPreview.parsed.skippedRows.map((entry) => (
                    <tr key={`skipped-${entry.rowNumber}`}>
                      <td className="px-3 py-2 font-bold">{entry.rowNumber}</td>
                      <td className="px-3 py-2" colSpan={3}>읽지 않음</td>
                      <td className="px-3 py-2 font-bold text-[var(--danger-text)]">{entry.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold leading-5 text-[var(--text-muted)]">
                모호하거나 일치하지 않는 행은 저장하지 않으며 개별 입력으로 확인할 수 있습니다.
              </p>
              <Button
                size="sm"
                isLoading={isApplyingImport}
                disabled={trackingPreview.matches.matched.length === 0 || !bulkCourier.trim()}
                onClick={() => void applyTrackingWorkbook()}
              >
                연결된 {trackingPreview.matches.matched.length.toLocaleString("ko-KR")}건 확정 등록
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {isLoading && items.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-[var(--surface-raised)] px-4 py-8 text-center text-sm font-bold text-[var(--text-muted)]">
          배송 업무 목록을 불러오는 중입니다…
        </p>
      ) : items.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-raised)] px-4 py-8 text-center text-sm font-bold text-[var(--text-muted)]">
          현재 배송 신청 내역이 없습니다.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.requestId} className="rounded-[1.4rem] border border-[var(--border)] bg-[var(--surface-raised)] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`${formatAddressSnapshot(item.addressSnapshot)} 배송 신청 선택`}
                    checked={selectedIds.has(item.requestId)}
                    onChange={() => toggleOne(item.requestId)}
                    disabled={isBusy || item.status === "shipped"}
                    className="mt-1 h-5 w-5 shrink-0 rounded accent-[var(--accent)]"
                  />
                  <div className="min-w-0">
                    <p className="font-black text-[var(--text-strong)]">상품 {item.itemCount}건 배송 접수</p>
                    <p className="mt-1 text-xs font-bold text-[var(--text-muted)]">{formatDateTime(item.requestedAt)}</p>
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${item.status === "shipped" ? "bg-[var(--success-surface)] text-[var(--success-text)]" : "bg-[var(--warning-surface)] text-[var(--warning-text)]"}`}>
                  {item.status === "shipped" ? "발송 완료" : "배송 대기"}
                </span>
              </div>
              <p className="mt-3 break-words rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-sm font-bold leading-6 text-[var(--foreground)]">
                {formatAddressSnapshot(item.addressSnapshot)}
              </p>
              <p className="mt-2 break-all text-xs font-semibold text-[var(--text-muted)]">
                상품 ID: {item.productIds.join(", ")}
              </p>
              {item.shippedAt ? (
                <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">
                  발송 처리 {formatDateTime(item.shippedAt)} · 등록 후에도 아래에서 수정할 수 있습니다.
                </p>
              ) : null}
              <div className="mt-4 grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
                <input
                  aria-label={`택배사 · ${formatAddressSnapshot(item.addressSnapshot)}`}
                  value={courierById[item.requestId] ?? ""}
                  onChange={(event) => {
                    dirtyTrackingIdsRef.current.add(item.requestId);
                    setCourierById((current) => ({ ...current, [item.requestId]: event.target.value }));
                  }}
                  placeholder="택배사"
                  maxLength={80}
                  disabled={isBusy}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm font-semibold text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                />
                <input
                  aria-label={`운송장 번호 · ${formatAddressSnapshot(item.addressSnapshot)}`}
                  value={trackingById[item.requestId] ?? ""}
                  onChange={(event) => {
                    dirtyTrackingIdsRef.current.add(item.requestId);
                    setTrackingById((current) => ({ ...current, [item.requestId]: event.target.value }));
                  }}
                  placeholder="운송장 번호"
                  maxLength={120}
                  disabled={isBusy}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm font-semibold text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                />
                <Button
                  size="sm"
                  variant={item.status === "shipped" ? "secondary" : "primary"}
                  isLoading={processingId === item.requestId}
                  disabled={isBusy && processingId !== item.requestId}
                  onClick={() => void saveTracking(item)}
                >
                  {item.status === "shipped" ? "운송장 수정" : "운송장 등록"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
