"use client";

import { Download, LoaderCircle, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface AuditActivityRow {
  log_key: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  subject_user_id: string | null;
  subject_display_name: string | null;
  category: string;
  event_type: string;
  action: string;
  source: string;
  entity_type: string | null;
  entity_id: string | null;
  severity: string;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
}

const LIST_LIMIT = 100;
const EXPORT_PAGE_LIMIT = 200;
const EXPORT_MAX_ROWS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORY_PATTERN = /^[a-z][a-z0-9_.:-]{1,63}$/;

const CATEGORY_SUGGESTIONS = [
  "auction",
  "commerce",
  "member",
  "operator",
  "owner",
  "payment",
  "privacy",
  "refund",
  "security",
  "session",
  "shipping",
  "store",
];

const severityLabels: Record<string, string> = {
  info: "정보",
  notice: "알림",
  warning: "경고",
  critical: "치명",
};

function severityClass(severity: string) {
  if (severity === "critical") return "border-red-500 bg-red-50 text-red-700";
  if (severity === "warning") return "border-amber-300 bg-amber-500/10 text-amber-800";
  if (severity === "notice") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-line text-muted";
}

function formatAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}.${part("month")}.${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function relativeAt(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (!Number.isFinite(seconds) || seconds < 60) return "방금 전";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function actionClass(row: AuditActivityRow) {
  const action = `${row.event_type} ${row.action}`.toUpperCase();
  if (action.includes("AUTH_LOGIN")) return "border-blue-500/40 bg-blue-500/10 text-blue-700";
  if (action.includes("SETTLEMENT_APPROVED")) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
  if (action.includes("ITEM_DELETED")) return "border-red-500/40 bg-red-500/10 text-red-700";
  if (action.includes("CONFIG_CHANGED")) return "border-violet-500/40 bg-violet-500/10 text-violet-700";
  return "border-line bg-paper text-muted";
}

type QuickCategory = "all" | "auth" | "settlement" | "config";

function quickCategoryMatch(row: AuditActivityRow, category: QuickCategory) {
  if (category === "all") return true;
  const value = `${row.category} ${row.event_type} ${row.action}`.toLowerCase();
  if (category === "auth") return /auth|login|session|security/.test(value);
  if (category === "settlement") return /settlement|payment|payout/.test(value);
  return /config|setting|platform/.test(value);
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvFilename(): string {
  const now = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `audit-logs-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.csv`;
}

export function OwnerAuditLogConsole() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [reason, setReason] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [categoryInput, setCategoryInput] = useState("");
  const [userIdInput, setUserIdInput] = useState("");
  const [quickQuery, setQuickQuery] = useState("");
  const [quickCategory, setQuickCategory] = useState<QuickCategory>("all");
  const [rows, setRows] = useState<AuditActivityRow[]>([]);
  const [loadedSignature, setLoadedSignature] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");

  const normalizedReason = reason.trim();

  const buildPayload = useCallback((nextOffset: number, limit: number) => {
    const category = categoryInput.trim().toLowerCase();
    const userId = userIdInput.trim();
    if (category && !CATEGORY_PATTERN.test(category)) {
      throw new Error("액션 유형(카테고리)은 소문자 영문자로 시작하는 2~64자여야 합니다.");
    }
    if (userId && !UUID_PATTERN.test(userId)) {
      throw new Error("작업자 필터에는 회원 UUID를 입력해 주세요.");
    }
    return {
      action: "list",
      reason: normalizedReason,
      category: category || null,
      userId: userId || null,
      from: fromDate ? `${fromDate}T00:00:00` : null,
      to: toDate ? `${toDate}T23:59:59` : null,
      limit,
      offset: nextOffset,
    };
  }, [categoryInput, fromDate, normalizedReason, toDate, userIdInput]);

  const fetchPage = useCallback(async (nextOffset: number, limit: number): Promise<AuditActivityRow[]> => {
    if (!token) return [];
    const response = await fetch("/api/admin/owner/security/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(buildPayload(nextOffset, limit)),
    });
    const payload = await response.json().catch(() => null) as { items?: AuditActivityRow[]; error?: string; message?: string } | null;
    if (!response.ok || !Array.isArray(payload?.items)) {
      throw new Error(payload?.message ?? payload?.error ?? "감사 로그를 불러오지 못했습니다.");
    }
    return payload.items;
  }, [buildPayload, token]);

  const load = useCallback(async (nextOffset: number) => {
    if (!token) return;
    if (normalizedReason.length < 10) {
      setNotice("열람 사유를 10자 이상 입력해 주세요. 열람 기록은 감사 로그에 남깁니다.");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      const items = await fetchPage(nextOffset, LIST_LIMIT);
      setRows(items);
      setLoadedSignature(`${fromDate}\n${toDate}\n${categoryInput}\n${userIdInput}`);
      setOffset(nextOffset);
      setHasMore(items.length === LIST_LIMIT);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "감사 로그를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [categoryInput, fetchPage, fromDate, normalizedReason.length, toDate, token, userIdInput]);

  const filterSignature = `${fromDate}\n${toDate}\n${categoryInput}\n${userIdInput}`;
  const resultsStale = loadedSignature !== filterSignature;

  const exportCsv = async () => {
    if (!token || exporting) return;
    if (normalizedReason.length < 10) {
      setNotice("CSV 내보내기에도 열람 사유 10자 이상이 필요합니다.");
      return;
    }
    setExporting(true);
    setNotice("");
    try {
      const collected: AuditActivityRow[] = [];
      let nextOffset = 0;
      while (collected.length < EXPORT_MAX_ROWS) {
        const items = await fetchPage(nextOffset, EXPORT_PAGE_LIMIT);
        collected.push(...items);
        if (items.length < EXPORT_PAGE_LIMIT) break;
        nextOffset += EXPORT_PAGE_LIMIT;
      }
      if (collected.length === 0) {
        setNotice("내보낼 감사 로그가 없습니다.");
        return;
      }
      const header = ["occurred_at", "severity", "category", "event_type", "action", "actor_display_name", "actor_user_id", "subject_display_name", "subject_user_id", "source", "entity_type", "entity_id", "ip_address", "user_agent", "metadata"];
      const lines = [header.map(csvCell).join(",")];
      for (const row of collected) {
        lines.push([
          row.occurred_at,
          row.severity,
          row.category,
          row.event_type,
          row.action,
          row.actor_display_name,
          row.actor_user_id,
          row.subject_display_name,
          row.subject_user_id,
          row.source,
          row.entity_type,
          row.entity_id,
          row.ip_address,
          row.user_agent,
          JSON.stringify(row.metadata ?? {}),
        ].map(csvCell).join(","));
      }
      const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = csvFilename();
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(`${collected.length}건을 CSV로 내보냈습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "CSV 내보내기에 실패했습니다.");
    } finally {
      setExporting(false);
    }
  };

  const visibleRows = useMemo(() => {
    if (resultsStale) return [];
    const query = quickQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (!quickCategoryMatch(row, quickCategory)) return false;
      if (!query) return true;
      return [
        row.actor_display_name,
        row.actor_user_id,
        row.subject_display_name,
        row.subject_user_id,
        row.event_type,
        row.action,
        row.entity_id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [quickCategory, quickQuery, resultsStale, rows]);

  return (
    <section className="border border-line bg-surface p-5">
      <div className="border-b border-line pb-5">
        <p className="eyebrow text-muted">보안 · 감사</p>
        <h2 className="mt-2 text-xl font-black">감사 로그 조회</h2>
        <p className="mt-2 text-xs leading-5 text-muted">
          권한 변경, 환불 승인 등 플랫폼 활동 기록을 일자·작업자·액션 유형으로 조회합니다. 원문 열람 시도는 모두 감사 기록에 남습니다.
        </p>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <label className="grid gap-2 text-[10px] font-bold">
          열람 사유 (필수 · 10~500자)
          <textarea
            className="min-h-16 border border-line bg-paper p-3 text-xs font-normal"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="예: 8월 환불 처리 이력 정기 감사"
            value={reason}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-2 text-[10px] font-bold">
            조회 시작일
            <input className="h-10 border border-line bg-paper px-3 text-xs font-normal" onChange={(event) => setFromDate(event.target.value)} type="date" value={fromDate} />
          </label>
          <label className="grid gap-2 text-[10px] font-bold">
            조회 종료일
            <input className="h-10 border border-line bg-paper px-3 text-xs font-normal" onChange={(event) => setToDate(event.target.value)} type="date" value={toDate} />
          </label>
          <label className="grid gap-2 text-[10px] font-bold">
            액션 유형 (카테고리)
            <input
              className="h-10 border border-line bg-paper px-3 text-xs font-normal"
              list="audit-category-suggestions"
              onChange={(event) => setCategoryInput(event.target.value)}
              placeholder="전체"
              value={categoryInput}
            />
            <datalist id="audit-category-suggestions">
              {CATEGORY_SUGGESTIONS.map((suggestion) => <option key={suggestion} value={suggestion} />)}
            </datalist>
          </label>
          <label className="grid gap-2 text-[10px] font-bold">
            작업자/대상 회원 UUID
            <input className="h-10 border border-line bg-paper px-3 font-mono text-xs font-normal" onChange={(event) => setUserIdInput(event.target.value)} placeholder="전체" value={userIdInput} />
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          className="inline-flex h-10 items-center gap-2 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40"
          disabled={loading || exporting || !token || normalizedReason.length < 10}
          onClick={() => void load(0)}
          type="button"
        >
          {loading ? <LoaderCircle className="animate-spin" size={13} /> : <Search size={13} />} {loading ? "조회 중..." : "조회"}
        </button>
        <button
          className="inline-flex h-10 items-center gap-2 border border-line px-4 text-xs font-bold disabled:opacity-40"
          disabled={loading || exporting || !token || normalizedReason.length < 10}
          onClick={() => void exportCsv()}
          type="button"
        >
          {exporting ? <LoaderCircle className="animate-spin" size={13} /> : <Download size={13} />} {exporting ? "내보내는 중..." : "CSV 다운로드"}
        </button>
        <label className="ml-auto flex min-w-0 flex-1 items-center gap-2 border border-line bg-paper px-3 sm:max-w-xs">
          <Search className="shrink-0 text-muted" size={13} />
          <span className="sr-only">현재 페이지 결과 내 검색</span>
          <input
            className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none"
            onChange={(event) => setQuickQuery(event.target.value)}
            placeholder="이름·액션 빠른 검색"
            type="search"
            value={quickQuery}
          />
        </label>
      </div>

      <div aria-label="감사 로그 빠른 필터" className="mt-4 flex gap-2 overflow-x-auto pb-1" role="group">
        {([['all','전체'],['auth','인증'],['settlement','정산'],['config','설정']] as const).map(([value, label]) => (
          <button aria-pressed={quickCategory === value} className={`min-h-11 shrink-0 rounded-full border px-4 text-xs font-black ${quickCategory === value ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`} key={value} onClick={() => setQuickCategory(value)} type="button">{label}</button>
        ))}
      </div>

      {notice && <p aria-live="polite" className="mt-4 border border-line bg-paper px-4 py-3 text-xs">{notice}</p>}

      <div className="mt-4 flex flex-col gap-3 md:hidden">
        {visibleRows.map((row) => (
          <article className="min-w-0 border border-line bg-paper p-4" key={row.log_key}>
            <div className="flex items-start justify-between gap-3"><div><time className="font-mono text-[11px]" dateTime={row.occurred_at}>{formatAt(row.occurred_at)}</time><span className="ml-2 text-[10px] text-muted">{relativeAt(row.occurred_at)}</span></div><span className={`shrink-0 border px-2 py-1 text-[10px] font-bold ${severityClass(row.severity)}`}>{severityLabels[row.severity] ?? row.severity}</span></div>
            <div className="mt-3 flex flex-wrap gap-2"><span className={`border px-2 py-1 font-mono text-[10px] font-bold ${actionClass(row)}`}>{row.action}</span><span className="border border-line px-2 py-1 font-mono text-[10px]">{row.category}</span></div>
            <p className="mt-3 break-words text-xs font-bold">{row.event_type}</p>
            <dl className="mt-3 grid gap-2 text-[11px]"><div><dt className="text-muted">작업자</dt><dd className="break-all">{row.actor_display_name ?? "-"} · {row.actor_user_id ?? "-"}</dd></div><div><dt className="text-muted">대상</dt><dd className="break-all">{row.subject_display_name ?? "-"} · {row.subject_user_id ?? "-"}</dd></div><div><dt className="text-muted">출처</dt><dd className="break-all font-mono">{row.source} · {row.ip_address ?? "-"}</dd></div></dl>
          </article>
        ))}
        {!loading && visibleRows.length === 0 ? (
          <p className="border border-dashed border-line py-10 text-center text-xs text-muted">
            {resultsStale ? "조회 조건이 변경되었습니다. 다시 조회해 주세요." : rows.length === 0 ? "조회 조건에 맞는 감사 로그가 없습니다." : "빠른 필터 조건에 맞는 결과가 없습니다."}
          </p>
        ) : null}
      </div>

      <div className="mt-4 hidden overflow-x-auto border border-line md:block">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="border-b border-line bg-paper text-[10px] tracking-[.12em] text-muted">
            <tr>
              <th className="px-3 py-3">일시</th>
              <th className="px-3 py-3">심각도</th>
              <th className="px-3 py-3">액션 유형</th>
              <th className="px-3 py-3">이벤트 / 액션</th>
              <th className="px-3 py-3">작업자</th>
              <th className="px-3 py-3">대상</th>
              <th className="px-3 py-3">출처 / IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visibleRows.map((row) => (
              <tr key={row.log_key}>
                <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px]"><time dateTime={row.occurred_at}>{formatAt(row.occurred_at)}</time><span className="mt-1 block text-[10px] text-muted">{relativeAt(row.occurred_at)}</span></td>
                <td className="px-3 py-3"><span className={`inline-block border px-2 py-1 text-[10px] font-bold ${severityClass(row.severity)}`}>{severityLabels[row.severity] ?? row.severity}</span></td>
                <td className="px-3 py-3 font-mono text-[11px]">{row.category}</td>
                <td className="px-3 py-3 font-mono text-[11px]" title={[row.entity_type ? `${row.entity_type}:${row.entity_id ?? ""}` : "", row.user_agent ?? ""].filter(Boolean).join(" · ")}>{row.event_type}<br /><span className={`mt-1 inline-block border px-2 py-1 text-[10px] ${actionClass(row)}`}>{row.action}</span></td>
                <td className="px-3 py-3">{row.actor_display_name ?? "-"}<br /><span className="font-mono text-[10px] text-muted">{row.actor_user_id ?? "-"}</span></td>
                <td className="px-3 py-3">{row.subject_display_name ?? "-"}<br /><span className="font-mono text-[10px] text-muted">{row.subject_user_id ?? "-"}</span></td>
                <td className="px-3 py-3 font-mono text-[11px]">{row.source}<br /><span className="text-muted">{row.ip_address ?? "-"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && visibleRows.length === 0 && (
          <p className="py-12 text-center text-xs text-muted">
            {resultsStale
              ? "조회 조건이 변경되었습니다. 다시 조회해 주세요."
              : rows.length === 0
                ? "조회 조건에 맞는 감사 로그가 없습니다."
                : "빠른 검색 조건에 맞는 결과가 없습니다."}
          </p>
        )}
      </div>

      {rows.length > 0 && !resultsStale && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <button
            className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40"
            disabled={loading || offset === 0}
            onClick={() => void load(Math.max(0, offset - LIST_LIMIT))}
            type="button"
          >
            이전
          </button>
          <p className="font-mono text-[11px] text-muted">{offset + 1}–{offset + rows.length}건 표시 중</p>
          <button
            className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40"
            disabled={loading || !hasMore}
            onClick={() => void load(offset + LIST_LIMIT)}
            type="button"
          >
            다음
          </button>
        </div>
      )}
    </section>
  );
}
