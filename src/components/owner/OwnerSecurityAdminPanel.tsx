"use client";

import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/src/components/common";
import { OwnerDangerConfirmModal } from "@/src/components/owner/OwnerDangerConfirmModal";
import {
  createOwnerIpBlockRule,
  decideOwnerSecurityLogRequest,
  listOwnerIpBlockRules,
  listOwnerSecurityActivity,
  listOwnerSecurityLogRequests,
  listOwnerSecuritySessionHistory,
  listOwnerSecuritySessions,
  revokeOwnerSecurityLogAccess,
  updateOwnerIpBlockRule,
  type OwnerIpBlockRule,
  type OwnerActivityFilters,
  type OwnerSecurityActivity,
  type OwnerSecurityLogAccessRequest,
  type OwnerSecuritySession,
  type OwnerSecuritySessionIpHistory,
  type OwnerSessionFilters,
  type SecurityLogRequestStatus,
} from "@/src/lib/securityAudit/client";

interface OwnerSecurityAdminPanelProps {
  accessToken: string;
  supportReview?: ReactNode;
}

type SecurityWorkspaceId = "activity" | "requests" | "sessions" | "blocks" | "support";

const securityWorkspaces: Array<{
  id: SecurityWorkspaceId;
  index: string;
  label: string;
  description: string;
}> = [
  { id: "activity", index: "A1", label: "원문 활동 로그", description: "ID·기간·분류 감사 조회" },
  { id: "requests", index: "A2", label: "로그 요청 승인", description: "동의·마스킹 범위 검토" },
  { id: "sessions", index: "A3", label: "세션 / IP", description: "접속 이력·기기 추적" },
  { id: "blocks", index: "A4", label: "IP / CIDR 차단", description: "차단·해제·변경 이력" },
  { id: "support", index: "A5", label: "상담 감사", description: "운영자별 상담 읽기 전용" },
];

type Notice = { tone: "success" | "error"; text: string } | null;
const OWNER_LOG_PAGE_SIZE = 200;

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});

const requestStatusLabel: Record<SecurityLogRequestStatus, string> = {
  awaiting_subject_consent: "정보 주체 동의 대기",
  awaiting_owner_approval: "총책임자 검토 대기",
  approved: "승인됨",
  denied: "거절됨",
  revoked: "열람 종료",
  expired: "기간 만료",
};

function formatDateTime(value: string | null): string {
  if (!value) return "없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : dateTimeFormatter.format(date);
}

function toDateTimeLocal(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function initialAuditRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return { from: toDateTimeLocal(from), to: toDateTimeLocal(to) };
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const copy: Record<string, string> = {
    invalid_user_id: "사용자 ID 형식을 확인해 주세요.",
    owner_reason_required: "원문 열람 사유를 구체적으로 입력해 주세요.",
    invalid_network: "IP 또는 CIDR 형식을 확인해 주세요. 예: 203.0.113.7/32",
    duplicate_network: "이미 등록된 IP/CIDR 차단 규칙입니다.",
    invalid_expiry: "만료 시각은 현재보다 뒤여야 합니다.",
    security_request_not_pending: "이미 처리되었거나 만료된 요청입니다.",
  };
  return copy[error.message] ?? fallback;
}

function severityTone(severity: OwnerSecurityActivity["severity"]): string {
  if (severity === "critical" || severity === "warning") {
    return "bg-[var(--danger-surface)] text-[var(--danger-text)]";
  }
  if (severity === "notice") {
    return "bg-[var(--warning-surface)] text-[var(--warning-text)]";
  }
  return "bg-[var(--info-surface)] text-[var(--info-text)]";
}

export function OwnerSecurityAdminPanel({
  accessToken,
  supportReview,
}: OwnerSecurityAdminPanelProps) {
  const availableWorkspaces = supportReview
    ? securityWorkspaces
    : securityWorkspaces.filter((workspace) => workspace.id !== "support");
  const [activeWorkspace, setActiveWorkspace] = useState<SecurityWorkspaceId>("activity");
  const [visitedWorkspaces, setVisitedWorkspaces] = useState<Set<SecurityWorkspaceId>>(
    () => new Set(["activity"]),
  );

  const selectWorkspace = (workspace: SecurityWorkspaceId) => {
    setActiveWorkspace(workspace);
    setVisitedWorkspaces((current) => new Set(current).add(workspace));
  };

  return (
    <section className="min-w-0" aria-labelledby="owner-security-admin-title">
      <div className="rounded-xl border border-amber-400/25 bg-gradient-to-br from-amber-400/10 via-[var(--surface)] to-[var(--surface)] p-4 sm:p-5">
        <p className="font-mono text-[10px] font-black tracking-[0.18em] text-[var(--warning-text)]">AUDITED SECURITY ACCESS</p>
        <h2 id="owner-security-admin-title" className="mt-1 text-xl font-black tracking-tight text-[var(--text-strong)] sm:text-2xl">보안·감사 통합 워크벤치</h2>
        <p className="mt-2 max-w-4xl break-keep text-xs font-semibold leading-5 text-[var(--text-muted)] sm:text-sm sm:leading-6">
          원문 열람 권한은 서비스 오남용·계정 탈취·장애 조사와 개인정보 권리 요청 처리에만 사용합니다. 조회 대상·기간·사유와 승인·차단 변경은 삭제할 수 없는 감사 기록으로 남으며, 회원에게는 승인된 범위의 마스킹 사본만 제공합니다.
        </p>
      </div>

      <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-[190px_minmax(0,1fr)] xl:items-start">
        <nav
          role="tablist"
          aria-label="보안 감사 데이터셋"
          className="flex touch-pan-x snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain scroll-smooth rounded-xl border border-zinc-800/80 bg-zinc-950/20 p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:sticky xl:top-3 xl:block xl:space-y-1 xl:overflow-visible xl:snap-none"
        >
          {availableWorkspaces.map((workspace) => {
            const isActive = activeWorkspace === workspace.id;
            return (
              <button
                key={workspace.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`security-panel-${workspace.id}`}
                onClick={() => selectWorkspace(workspace.id)}
                className={`min-h-12 min-w-[10.5rem] shrink-0 snap-start rounded-lg border-l-2 px-3 py-2.5 text-left transition-all duration-200 xl:min-w-0 xl:w-full ${isActive ? "border-l-white bg-zinc-800/70 text-[var(--text-strong)]" : "border-l-transparent text-[var(--text-muted)] hover:bg-zinc-800/30 hover:text-[var(--text-strong)]"}`}
              >
                <span className="font-mono text-[9px] font-black tabular-nums opacity-60">{workspace.index}</span>
                <span className="mt-0.5 block text-xs font-black">{workspace.label}</span>
                <span className="mt-1 hidden text-[10px] font-semibold leading-4 opacity-60 xl:block">{workspace.description}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {visitedWorkspaces.has("activity") ? <div id="security-panel-activity" role="tabpanel" hidden={activeWorkspace !== "activity"}><ActivityAuditSection accessToken={accessToken} /></div> : null}
          {visitedWorkspaces.has("requests") ? <div id="security-panel-requests" role="tabpanel" hidden={activeWorkspace !== "requests"}><LogRequestReviewSection accessToken={accessToken} /></div> : null}
          {visitedWorkspaces.has("sessions") ? <div id="security-panel-sessions" role="tabpanel" hidden={activeWorkspace !== "sessions"}><SessionHistorySection accessToken={accessToken} /></div> : null}
          {visitedWorkspaces.has("blocks") ? <div id="security-panel-blocks" role="tabpanel" hidden={activeWorkspace !== "blocks"}><IpBlockRulesSection accessToken={accessToken} /></div> : null}
          {supportReview && visitedWorkspaces.has("support") ? <div id="security-panel-support" role="tabpanel" hidden={activeWorkspace !== "support"}>{supportReview}</div> : null}
        </div>
      </div>
    </section>
  );
}

function ActivityAuditSection({ accessToken }: OwnerSecurityAdminPanelProps) {
  const initial = useMemo(() => initialAuditRange(), []);
  const [userId, setUserId] = useState("");
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [items, setItems] = useState<OwnerSecurityActivity[]>([]);
  const [lastFilters, setLastFilters] = useState<OwnerActivityFilters | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const sortedItems = useMemo(
    () => [...items].sort((left, right) =>
      sortDirection === "desc"
        ? right.occurredAt.localeCompare(left.occurredAt)
        : left.occurredAt.localeCompare(right.occurredAt),
    ),
    [items, sortDirection],
  );

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    if (!userId.trim()) {
      setNotice({ tone: "error", text: "조회할 회원 또는 운영자의 사용자 ID를 입력해 주세요." });
      return;
    }
    if (reason.trim().length < 10) {
      setNotice({ tone: "error", text: "원문 조회 사유를 10자 이상 구체적으로 입력해 주세요." });
      return;
    }
    if (!from || !to || new Date(from) > new Date(to)) {
      setNotice({ tone: "error", text: "조회 시작과 종료 시각을 확인해 주세요." });
      return;
    }

    setIsLoading(true);
    setItems([]);
    try {
      const filters: OwnerActivityFilters = {
        userId: userId.trim(),
        category: category.trim() || undefined,
        from: toIso(from),
        to: toIso(to),
        limit: OWNER_LOG_PAGE_SIZE,
        reason: reason.trim(),
      };
      const logs = await listOwnerSecurityActivity(accessToken, filters);
      setItems(logs);
      setLastFilters(filters);
      setHasMore(logs.length === OWNER_LOG_PAGE_SIZE);
      setNotice({ tone: "success", text: `감사 기록을 남기고 원문 로그 ${logs.length}건을 조회했습니다.` });
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "원문 활동 로그를 조회하지 못했습니다.") });
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    if (!lastFilters || isLoading) return;
    setIsLoading(true);
    try {
      const next = await listOwnerSecurityActivity(accessToken, {
        ...lastFilters,
        offset: items.length,
      });
      setItems((current) => [...current, ...next]);
      setHasMore(next.length === OWNER_LOG_PAGE_SIZE);
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "다음 원문 로그를 불러오지 못했습니다.") });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-[var(--surface)] p-4 sm:p-5" aria-labelledby="owner-activity-audit-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div><p className="font-mono text-[9px] font-black tracking-[0.16em] text-[var(--accent-text)]">RAW ACTIVITY DATASET</p><h3 id="owner-activity-audit-title" className="mt-1 text-lg font-black text-[var(--text-strong)]">ID별 원문 활동 로그</h3><p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">대상·기간·사유를 지정한 조회만 허용됩니다.</p></div>
        <button type="button" onClick={() => setSortDirection((current) => current === "desc" ? "asc" : "desc")} className="rounded-full border border-zinc-800 bg-zinc-950/30 px-2.5 py-1 font-mono text-[9px] font-black tabular-nums text-[var(--text-muted)] transition-colors hover:border-zinc-700">TIME {sortDirection === "desc" ? "DESC ↓" : "ASC ↑"}</button>
      </div>
      <form onSubmit={search} className="mt-5 rounded-2xl bg-[var(--surface-muted)] p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="text-sm font-black text-[var(--text-strong)]">대상 사용자 ID<input value={userId} onChange={(event) => setUserId(event.target.value)} autoComplete="off" required placeholder="정확한 사용자 ID" className="mt-2 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-4 font-bold" /></label>
          <label className="text-sm font-black text-[var(--text-strong)]">분류 필터 (선택)<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="예: auth, auction, payment" className="mt-2 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-4 font-bold" /></label>
          <label className="text-sm font-black text-[var(--text-strong)]">조회 시작<input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} required className="mt-2 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-4 font-bold" /></label>
          <label className="text-sm font-black text-[var(--text-strong)]">조회 종료<input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} required className="mt-2 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-4 font-bold" /></label>
        </div>
        <label className="mt-4 block text-sm font-black text-[var(--text-strong)]">원문 열람 사유<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={500} rows={2} required placeholder="오남용 조사, 회원 요청 처리 등 구체적인 업무 사유" className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-4 py-3 font-bold" /></label>
        <div className="mt-4 flex justify-end"><Button type="submit" isLoading={isLoading} disabled={reason.trim().length < 10}>{isLoading ? "감사 기록 후 조회 중…" : "원문 로그 조회"}</Button></div>
      </form>
      <InlineNotice notice={notice} />
      {items.length > 0 ? <>
        <div className="mt-4 overflow-auto rounded-xl border border-zinc-800/80 md:max-h-[40rem]">
          <table className="w-full min-w-[1040px] table-fixed border-collapse text-left">
            <thead className="sticky top-0 z-10 border-b border-zinc-800 bg-[var(--surface-muted)] font-mono text-[9px] font-black uppercase tracking-[0.13em] text-[var(--text-muted)]">
              <tr><th className="w-[14%] px-3 py-2.5">Timestamp</th><th className="w-[24%] px-3 py-2.5">Event</th><th className="w-[18%] px-3 py-2.5">Actor</th><th className="w-[18%] px-3 py-2.5">Subject</th><th className="w-[16%] px-3 py-2.5">IP / Entity</th><th className="w-[10%] px-3 py-2.5 text-right">Severity</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {sortedItems.map((item) => (
                <tr key={item.logKey} className="align-top transition-colors hover:bg-zinc-800/30">
                  <td className="px-3 py-3 font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">{formatDateTime(item.occurredAt)}</td>
                  <td className="px-3 py-3"><p className="truncate text-xs font-black text-[var(--text-strong)]" title={`${item.eventType} · ${item.action}`}>{item.eventType} · {item.action}</p><p className="mt-1 truncate font-mono text-[9px] font-bold text-[var(--text-muted)]">{item.category} / {item.source}</p>{Object.keys(item.metadata).length > 0 ? <details className="mt-2"><summary className="cursor-pointer text-[10px] font-black text-[var(--accent-text)]">메타데이터</summary><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-950/30 p-2 font-mono text-[9px] text-[var(--text-muted)]">{JSON.stringify(item.metadata, null, 2)}</pre></details> : null}</td>
                  <td className="px-3 py-3"><p className="truncate text-xs font-bold text-[var(--text-strong)]">{item.actorDisplayName ?? "시스템"}</p><p className="mt-1 truncate font-mono text-[9px] font-semibold text-[var(--text-muted)]" title={item.actorUserId ?? ""}>{item.actorUserId ?? "-"}</p></td>
                  <td className="px-3 py-3"><p className="truncate text-xs font-bold text-[var(--text-strong)]">{item.subjectDisplayName ?? "-"}</p><p className="mt-1 truncate font-mono text-[9px] font-semibold text-[var(--text-muted)]" title={item.subjectUserId ?? ""}>{item.subjectUserId ?? "-"}</p></td>
                  <td className="px-3 py-3"><p className="truncate font-mono text-[10px] font-bold tabular-nums text-[var(--text-strong)]" title={item.ipAddress ?? ""}>{item.ipAddress ?? "기록 없음"}</p><p className="mt-1 truncate font-mono text-[9px] font-semibold text-[var(--text-muted)]" title={item.entityId ?? ""}>{item.entityType ?? "-"} · {item.entityId ?? "-"}</p>{item.userAgent ? <details className="mt-2"><summary className="cursor-pointer text-[10px] font-black text-[var(--accent-text)]">기기 정보</summary><p className="mt-1 break-all text-[9px] font-semibold leading-4 text-[var(--text-muted)]">{item.userAgent}</p></details> : null}</td>
                  <td className="px-3 py-3 text-right"><span className={`inline-flex rounded-full px-2 py-1 font-mono text-[9px] font-black uppercase ${severityTone(item.severity)}`}>{item.severity}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasMore ? <div className="mt-3 flex justify-center"><Button size="sm" variant="ghost" isLoading={isLoading} onClick={() => void loadMore()}>다음 200건 불러오기</Button></div> : <p className="mt-3 text-center font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">조회 조건의 원문 로그 {items.length}건을 모두 불러왔습니다.</p>}
      </> : null}
    </section>
  );
}

function LogRequestReviewSection({ accessToken }: OwnerSecurityAdminPanelProps) {
  const [pending, setPending] = useState<OwnerSecurityLogAccessRequest[]>([]);
  const [active, setActive] = useState<OwnerSecurityLogAccessRequest[]>([]);
  const [pendingHasMore, setPendingHasMore] = useState(false);
  const [activeHasMore, setActiveHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const [processingId, setProcessingId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [revocationReasons, setRevocationReasons] = useState<Record<string, string>>({});
  const [hours, setHours] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    if (reviewReason.trim().length < 10) {
      setNotice({ tone: "error", text: "승인함 열람 사유를 10자 이상 입력해 주세요." });
      return;
    }
    setIsLoading(true);
    try {
      const [pendingRequests, activeRequests] = await Promise.all([
        listOwnerSecurityLogRequests(accessToken, {
          reason: reviewReason.trim(),
          status: "awaiting_owner_approval",
          limit: 100,
        }),
        listOwnerSecurityLogRequests(accessToken, {
          reason: reviewReason.trim(),
          status: "approved",
          limit: 100,
        }),
      ]);
      setPending(pendingRequests);
      setActive(activeRequests);
      setPendingHasMore(pendingRequests.length === 100);
      setActiveHasMore(activeRequests.length === 100);
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "회원 로그 요청함을 불러오지 못했습니다.") });
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, reviewReason]);

  const loadMore = async (status: "awaiting_owner_approval" | "approved") => {
    if (reviewReason.trim().length < 10 || isLoading) return;
    const current = status === "awaiting_owner_approval" ? pending : active;
    setIsLoading(true);
    try {
      const next = await listOwnerSecurityLogRequests(accessToken, {
        reason: reviewReason.trim(),
        status,
        limit: 100,
        offset: current.length,
      });
      if (status === "awaiting_owner_approval") {
        setPending((items) => [...items, ...next]);
        setPendingHasMore(next.length === 100);
      } else {
        setActive((items) => [...items, ...next]);
        setActiveHasMore(next.length === 100);
      }
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "다음 회원 로그 요청을 불러오지 못했습니다.") });
    } finally {
      setIsLoading(false);
    }
  };

  const decide = async (request: OwnerSecurityLogAccessRequest, approved: boolean) => {
    const note = notes[request.requestId]?.trim() ?? "";
    const accessHours = hours[request.requestId] ?? 24;
    if (note.length < 10) {
      setNotice({ tone: "error", text: "승인 또는 거절 근거를 10자 이상 구체적으로 입력해 주세요." });
      return;
    }
    if (approved && (!Number.isInteger(accessHours) || accessHours < 1 || accessHours > 24)) {
      setNotice({ tone: "error", text: "승인 열람 시간은 1시간부터 24시간 사이로 입력해 주세요." });
      return;
    }
    setProcessingId(request.requestId);
    setNotice(null);
    try {
      await decideOwnerSecurityLogRequest(accessToken, request.requestId, approved, note, accessHours);
      setNotice({ tone: "success", text: approved ? "마스킹 로그의 기간 제한 열람을 승인했습니다." : "요청을 거절하고 근거를 감사 기록에 남겼습니다." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "요청을 처리하지 못했습니다.") });
    } finally {
      setProcessingId("");
    }
  };

  const revoke = async (request: OwnerSecurityLogAccessRequest) => {
    const note = revocationReasons[request.requestId]?.trim() ?? "";
    if (note.length < 10) {
      setNotice({ tone: "error", text: "추가 열람 중단 사유를 10자 이상 입력해 주세요." });
      return;
    }
    setProcessingId(request.requestId);
    try {
      await revokeOwnerSecurityLogAccess(accessToken, request.requestId, note);
      setNotice({ tone: "success", text: "승인된 로그의 추가 열람을 즉시 중단하고 이력을 남겼습니다." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "로그 열람을 중단하지 못했습니다.") });
    } finally {
      setProcessingId("");
    }
  };

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-[var(--surface)] p-4 sm:p-5" aria-labelledby="owner-log-request-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800/80 pb-4"><div><p className="font-mono text-[9px] font-black tracking-[0.16em] text-[var(--accent-text)]">CONSENT REVIEW QUEUE</p><h3 id="owner-log-request-title" className="mt-1 text-lg font-black text-[var(--text-strong)]">회원 로그 요청 승인함</h3><p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">정보 주체 동의 여부와 요청 목적·범위를 검토합니다.</p></div><span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 font-mono text-[10px] font-black tabular-nums text-[var(--warning-text)]">PENDING {pending.length}</span></div>
      <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-[var(--surface-muted)] p-4 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-xs font-black text-[var(--text-strong)]">승인함 열람 사유<input value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} minLength={10} maxLength={500} placeholder="회원 개인정보 권리 요청 검토 등 구체적인 사유" className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-3 font-bold" /></label><Button size="sm" variant="ghost" onClick={() => void load()} isLoading={isLoading} disabled={reviewReason.trim().length < 10}>승인함 조회</Button></div>
      <InlineNotice notice={notice} />
      {isLoading && pending.length === 0 && active.length === 0 ? <p role="status" className="mt-4 font-bold text-[var(--text-muted)]">요청을 불러오는 중…</p> : pending.length === 0 ? <p className="mt-4 rounded-2xl bg-[var(--surface-muted)] p-4 font-bold text-[var(--text-muted)]">현재 승인 대기 요청이 없습니다.</p> : <div className="mt-4 space-y-3">{pending.map((request) => <article key={request.requestId} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="flex flex-wrap justify-between gap-2"><p className="font-black text-[var(--text-strong)]">{request.requesterDisplayName} → {request.subjectDisplayName}</p><span className="rounded-full bg-[var(--warning-surface)] px-3 py-1 text-xs font-black text-[var(--warning-text)]">{requestStatusLabel[request.status]}</span></div><p className="mt-2 break-all text-xs font-bold leading-5 text-[var(--text-muted)]">요청자 ID {request.requesterUserId}<br />대상 ID {request.subjectUserId}<br />조회 기간 {formatDateTime(request.requestedFrom)} ~ {formatDateTime(request.requestedTo)}<br />사유: {request.reason}</p><p className="mt-2 rounded-xl bg-[var(--info-surface)] px-3 py-2 text-xs font-black text-[var(--info-text)]">정보 주체 동의: {request.subjectDecision === "not_required" ? "본인 요청으로 불필요" : request.subjectDecision === "approved" ? "동의 완료" : "확인 필요"}</p><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_10rem]"><label className="text-xs font-black text-[var(--text-strong)]">결정 근거<input value={notes[request.requestId] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [request.requestId]: event.target.value }))} minLength={10} maxLength={500} placeholder="승인 범위 또는 거절 근거 (10자 이상)" className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-3 font-bold" /></label><label className="text-xs font-black text-[var(--text-strong)]">승인 열람 시간<input type="number" min={1} max={24} value={hours[request.requestId] ?? 24} onChange={(event) => setHours((current) => ({ ...current, [request.requestId]: Number(event.target.value) }))} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-3 font-bold" /></label></div><div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="ghost" isLoading={processingId === request.requestId} onClick={() => void decide(request, false)}>거절</Button><Button size="sm" isLoading={processingId === request.requestId} onClick={() => void decide(request, true)}>마스킹 열람 승인</Button></div></article>)}{pendingHasMore ? <div className="flex justify-center"><Button size="sm" variant="ghost" isLoading={isLoading} onClick={() => void loadMore("awaiting_owner_approval")}>다음 승인 대기 100건</Button></div> : null}</div>}
      {active.length > 0 ? <div className="mt-5"><h3 className="font-black text-[var(--text-strong)]">현재 열람 승인 {active.length}건</h3><div className="mt-3 space-y-3">{active.map((request) => <article key={request.requestId} className="rounded-2xl border border-[var(--success-text)]/25 bg-[var(--success-surface)] p-4"><div className="flex flex-wrap justify-between gap-2"><p className="font-black text-[var(--text-strong)]">{request.requesterDisplayName} → {request.subjectDisplayName}</p><span className="text-xs font-black text-[var(--success-text)]">{formatDateTime(request.accessExpiresAt)}까지</span></div><label className="mt-3 block text-xs font-black text-[var(--text-strong)]">추가 열람 중단 사유<input value={revocationReasons[request.requestId] ?? ""} onChange={(event) => setRevocationReasons((current) => ({ ...current, [request.requestId]: event.target.value }))} minLength={10} maxLength={500} placeholder="긴급 중단 사유 (10자 이상)" className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-3 font-bold" /></label><div className="mt-3 flex justify-end"><Button size="sm" variant="danger" isLoading={processingId === request.requestId} onClick={() => void revoke(request)}>추가 열람 중단</Button></div></article>)}{activeHasMore ? <div className="flex justify-center"><Button size="sm" variant="ghost" isLoading={isLoading} onClick={() => void loadMore("approved")}>다음 활성 승인 100건</Button></div> : null}</div></div> : null}
    </section>
  );
}

function SessionHistorySection({ accessToken }: OwnerSecurityAdminPanelProps) {
  const [userId, setUserId] = useState("");
  const [ip, setIp] = useState("");
  const [outcome, setOutcome] = useState<"" | "allowed" | "blocked">("");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<OwnerSecuritySession[]>([]);
  const [lastFilters, setLastFilters] = useState<OwnerSessionFilters | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [historyBySession, setHistoryBySession] = useState<
    Record<string, OwnerSecuritySessionIpHistory[]>
  >({});
  const [historyHasMore, setHistoryHasMore] = useState<Record<string, boolean>>({});
  const [loadingHistoryId, setLoadingHistoryId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId.trim() && !ip.trim()) {
      setNotice({ tone: "error", text: "사용자 ID 또는 IP 중 하나를 입력해 주세요." });
      return;
    }
    if (reason.trim().length < 10) {
      setNotice({ tone: "error", text: "세션 원문 조회 사유를 10자 이상 입력해 주세요." });
      return;
    }
    setIsLoading(true);
    setItems([]);
    setHistoryBySession({});
    setHistoryHasMore({});
    try {
      const filters: OwnerSessionFilters = { userId: userId.trim() || undefined, ip: ip.trim() || undefined, outcome: outcome || undefined, limit: OWNER_LOG_PAGE_SIZE, reason: reason.trim() };
      const sessions = await listOwnerSecuritySessions(accessToken, filters);
      setItems(sessions);
      setLastFilters(filters);
      setHasMore(sessions.length === OWNER_LOG_PAGE_SIZE);
      setNotice({ tone: "success", text: `감사 기록을 남기고 세션 ${sessions.length}건을 조회했습니다.` });
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "세션/IP 기록을 조회하지 못했습니다.") });
    } finally {
      setIsLoading(false);
    }
  };

  const loadMoreSessions = async () => {
    if (!lastFilters || isLoading) return;
    setIsLoading(true);
    try {
      const next = await listOwnerSecuritySessions(accessToken, {
        ...lastFilters,
        offset: items.length,
      });
      setItems((current) => [...current, ...next]);
      setHasMore(next.length === OWNER_LOG_PAGE_SIZE);
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "다음 세션 기록을 불러오지 못했습니다.") });
    } finally {
      setIsLoading(false);
    }
  };

  const loadSessionHistory = async (sessionRecordId: string) => {
    if (reason.trim().length < 10) {
      setNotice({ tone: "error", text: "세션 IP 이력 조회 사유를 10자 이상 입력해 주세요." });
      return;
    }
    if (historyBySession[sessionRecordId]) {
      setHistoryBySession((current) => {
        const next = { ...current };
        delete next[sessionRecordId];
        return next;
      });
      return;
    }
    setLoadingHistoryId(sessionRecordId);
    try {
      const history = await listOwnerSecuritySessionHistory(
        accessToken,
        sessionRecordId,
        reason.trim(),
      );
      setHistoryBySession((current) => ({ ...current, [sessionRecordId]: history }));
      setHistoryHasMore((current) => ({ ...current, [sessionRecordId]: history.length === 100 }));
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "세션별 IP 변경 이력을 불러오지 못했습니다.") });
    } finally {
      setLoadingHistoryId("");
    }
  };

  const loadMoreSessionHistory = async (sessionRecordId: string) => {
    const currentHistory = historyBySession[sessionRecordId] ?? [];
    setLoadingHistoryId(sessionRecordId);
    try {
      const next = await listOwnerSecuritySessionHistory(
        accessToken,
        sessionRecordId,
        reason.trim(),
        100,
        currentHistory.length,
      );
      setHistoryBySession((current) => ({
        ...current,
        [sessionRecordId]: [...(current[sessionRecordId] ?? []), ...next],
      }));
      setHistoryHasMore((current) => ({ ...current, [sessionRecordId]: next.length === 100 }));
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "다음 IP 변경 이력을 불러오지 못했습니다.") });
    } finally {
      setLoadingHistoryId("");
    }
  };

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-[var(--surface)] p-4 sm:p-5" aria-labelledby="owner-session-history-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800/80 pb-4"><div><p className="font-mono text-[9px] font-black tracking-[0.16em] text-[var(--accent-text)]">SESSION INTELLIGENCE</p><h3 id="owner-session-history-title" className="mt-1 text-lg font-black text-[var(--text-strong)]">세션별 IP 기록</h3><p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">침해·오남용 조사에 필요한 경우에만 원문 IP와 기기 정보를 조회합니다.</p></div><span className="rounded-full border border-zinc-800 bg-zinc-950/30 px-2.5 py-1 font-mono text-[9px] font-black tabular-nums text-[var(--text-muted)]">RAW IP · AUDITED</span></div>
      <form onSubmit={search} className="mt-5 rounded-2xl bg-[var(--surface-muted)] p-4"><div className="grid gap-3 lg:grid-cols-3"><label className="text-xs font-black text-[var(--text-strong)]">사용자 ID<input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="ID로 검색" className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-3 font-bold" /></label><label className="text-xs font-black text-[var(--text-strong)]">IP 주소<input value={ip} onChange={(event) => setIp(event.target.value)} placeholder="IP로 검색" className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-3 font-bold" /></label><label className="text-xs font-black text-[var(--text-strong)]">결과<select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-3 font-bold"><option value="">전체</option><option value="allowed">허용</option><option value="blocked">차단</option></select></label></div><label className="mt-3 block text-xs font-black text-[var(--text-strong)]">조회 사유<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={500} required placeholder="침해 의심 시각 확인 등 구체적인 사유" className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-3 font-bold" /></label><div className="mt-3 flex justify-end"><Button type="submit" isLoading={isLoading} disabled={reason.trim().length < 10}>세션 기록 조회</Button></div></form>
      <InlineNotice notice={notice} />
      {items.length > 0 ? (
        <><ul className="mt-4 max-h-[36rem] space-y-3 overflow-y-auto pr-1">
          {items.map((item) => (
            <li key={item.sessionRecordId} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-black text-[var(--text-strong)]">{item.displayName ?? "닉네임 없음"} · {item.latestIp}</p>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${item.lastOutcome === "blocked" ? "bg-[var(--danger-surface)] text-[var(--danger-text)]" : "bg-[var(--success-surface)] text-[var(--success-text)]"}`}>{item.lastOutcome === "blocked" ? "차단" : "허용"}</span>
              </div>
              <dl className="mt-2 grid gap-1 break-all text-xs font-bold text-[var(--text-muted)]">
                <div><dt className="inline font-black text-[var(--text-strong)]">사용자 ID </dt><dd className="inline">{item.userId}</dd></div>
                <div><dt className="inline font-black text-[var(--text-strong)]">인증 세션 ID </dt><dd className="inline">{item.authSessionId ?? "기록 없음"}</dd></div>
                <div><dt className="inline font-black text-[var(--text-strong)]">브라우저 탭 ID </dt><dd className="inline">{item.browserTabSessionId}</dd></div>
                <div><dt className="inline font-black text-[var(--text-strong)]">접속 시간 </dt><dd className="inline">{formatDateTime(item.firstSeenAt)} ~ {formatDateTime(item.lastSeenAt)}</dd></div>
                <div><dt className="inline font-black text-[var(--text-strong)]">최근 이벤트 </dt><dd className="inline">{item.lastEvent}</dd></div>
              </dl>
              {item.latestUserAgent ? <details className="mt-2 rounded-xl bg-[var(--surface-muted)] p-3"><summary className="cursor-pointer text-xs font-black">최근 기기 정보</summary><p className="mt-2 break-all text-xs font-bold text-[var(--text-muted)]">{item.latestUserAgent}</p></details> : null}
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="ghost" isLoading={loadingHistoryId === item.sessionRecordId} onClick={() => void loadSessionHistory(item.sessionRecordId)}>
                  {historyBySession[item.sessionRecordId] ? "IP 변경 이력 닫기" : "IP 변경 이력 보기"}
                </Button>
              </div>
              {historyBySession[item.sessionRecordId] ? (
                <ul className="mt-3 space-y-2 border-l-2 border-[var(--info-border)] pl-3">
                  {historyBySession[item.sessionRecordId].length === 0 ? <li className="text-xs font-bold text-[var(--text-muted)]">기록된 IP 변경 이력이 없습니다.</li> : historyBySession[item.sessionRecordId].map((history) => (
                    <li key={history.historyId} className="rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-xs font-bold text-[var(--text-muted)]">
                      <span className="font-black text-[var(--text-strong)]">{history.ipAddress}</span> · {history.eventType} · {history.outcome === "blocked" ? "차단" : "허용"} · {formatDateTime(history.observedAt)}
                      {history.userAgent ? <span className="mt-1 block break-all">{history.userAgent}</span> : null}
                    </li>
                  ))}
                  {historyHasMore[item.sessionRecordId] ? <li className="flex justify-center"><Button size="sm" variant="ghost" isLoading={loadingHistoryId === item.sessionRecordId} onClick={() => void loadMoreSessionHistory(item.sessionRecordId)}>다음 IP 이력 100건</Button></li> : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>{hasMore ? <div className="mt-3 flex justify-center"><Button size="sm" variant="ghost" isLoading={isLoading} onClick={() => void loadMoreSessions()}>다음 200개 세션 불러오기</Button></div> : <p className="mt-3 text-center text-xs font-bold text-[var(--text-muted)]">검색 조건의 세션 {items.length}개를 모두 불러왔습니다.</p>}</>
      ) : null}
    </section>
  );
}

interface RuleEditorState {
  network: string;
  label: string;
  reason: string;
  expiresAt: string;
  changeReason: string;
}

function IpBlockRulesSection({ accessToken }: OwnerSecurityAdminPanelProps) {
  const [rules, setRules] = useState<OwnerIpBlockRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const [isMutating, setIsMutating] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState("");
  const [editor, setEditor] = useState<RuleEditorState>({ network: "", label: "", reason: "", expiresAt: "", changeReason: "" });
  const [create, setCreate] = useState<RuleEditorState>({ network: "", label: "", reason: "", expiresAt: "", changeReason: "" });
  const [toggleReasons, setToggleReasons] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmation, setConfirmation] = useState<
    { kind: "create" } | { kind: "toggle"; rule: OwnerIpBlockRule } | null
  >(null);

  const load = useCallback(async () => {
    if (reviewReason.trim().length < 10) {
      setNotice({ tone: "error", text: "차단 규칙 조회 사유를 10자 이상 입력해 주세요." });
      return;
    }
    setIsLoading(true);
    try {
      setRules(await listOwnerIpBlockRules(accessToken, reviewReason.trim()));
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "IP 차단 규칙을 불러오지 못했습니다.") });
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, reviewReason]);

  const createRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.reason.trim().length < 10) {
      setNotice({ tone: "error", text: "차단 사유를 10자 이상 구체적으로 입력해 주세요." });
      return;
    }
    setConfirmation({ kind: "create" });
  };

  const confirmCreateRule = async () => {
    setIsMutating(true);
    setNotice(null);
    try {
      await createOwnerIpBlockRule(accessToken, { network: create.network.trim(), label: create.label.trim() || null, reason: create.reason.trim(), expiresAt: create.expiresAt ? toIso(create.expiresAt) : null });
      setCreate({ network: "", label: "", reason: "", expiresAt: "", changeReason: "" });
      setConfirmation(null);
      setNotice({ tone: "success", text: "IP/CIDR 차단 규칙을 만들고 변경 이력을 기록했습니다." });
      if (reviewReason.trim().length >= 10) await load();
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "IP 차단 규칙을 만들지 못했습니다.") });
    } finally {
      setIsMutating(false);
    }
  };

  const startEdit = (rule: OwnerIpBlockRule) => {
    setEditingRuleId(rule.ruleId);
    setEditor({ network: rule.network, label: rule.label ?? "", reason: rule.reason, expiresAt: rule.expiresAt ? toDateTimeLocal(new Date(rule.expiresAt)) : "", changeReason: "" });
  };

  const saveEdit = async (ruleId: string) => {
    if (editor.reason.trim().length < 10) {
      setNotice({ tone: "error", text: "차단 사유를 10자 이상 입력해 주세요." });
      return;
    }
    if (editor.changeReason.trim().length < 10) {
      setNotice({ tone: "error", text: "이번 수정 사유를 10자 이상 구체적으로 입력해 주세요." });
      return;
    }
    setIsMutating(true);
    try {
      await updateOwnerIpBlockRule(accessToken, ruleId, { changeReason: editor.changeReason.trim(), network: editor.network.trim(), label: editor.label.trim() || null, reason: editor.reason.trim(), expiresAt: editor.expiresAt ? toIso(editor.expiresAt) : null });
      setEditingRuleId("");
      setNotice({ tone: "success", text: "차단 규칙을 수정하고 변경 전후 상태를 기록했습니다." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "차단 규칙을 수정하지 못했습니다.") });
    } finally {
      setIsMutating(false);
    }
  };

  const toggleRule = (rule: OwnerIpBlockRule) => {
    const changeReason = toggleReasons[rule.ruleId]?.trim() ?? "";
    if (changeReason.length < 10) {
      setNotice({ tone: "error", text: "차단 해제 또는 재활성화 사유를 10자 이상 입력해 주세요." });
      return;
    }
    setConfirmation({ kind: "toggle", rule });
  };

  const confirmToggleRule = async (rule: OwnerIpBlockRule) => {
    const changeReason = toggleReasons[rule.ruleId]?.trim() ?? "";
    setIsMutating(true);
    try {
      await updateOwnerIpBlockRule(accessToken, rule.ruleId, { enabled: !rule.enabled, changeReason });
      setToggleReasons((current) => ({ ...current, [rule.ruleId]: "" }));
      setConfirmation(null);
      setNotice({ tone: "success", text: rule.enabled ? "차단을 해제했습니다. 규칙과 이력은 삭제되지 않습니다." : "차단 규칙을 다시 활성화했습니다." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "차단 상태를 변경하지 못했습니다.") });
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <section className="rounded-xl border border-red-500/20 bg-[var(--surface)] p-4 sm:p-5" aria-labelledby="owner-ip-blocks-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800/80 pb-4"><div><p className="font-mono text-[9px] font-black tracking-[0.16em] text-[var(--danger-text)]">NETWORK ENFORCEMENT</p><h3 id="owner-ip-blocks-title" className="mt-1 text-lg font-black text-[var(--text-strong)]">IP/CIDR 차단 관리</h3><p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">규칙은 삭제하지 않고 수정·해제·재활성화 이력을 보존합니다.</p></div><span className="rounded-full border border-red-400/25 bg-red-400/10 px-2.5 py-1 font-mono text-[9px] font-black text-[var(--danger-text)]">DANGER ZONE</span></div>
      <p className="mt-4 rounded-xl bg-[var(--danger-surface)] px-4 py-3 text-sm font-black leading-6 text-[var(--danger-text)]">현재 접속 IP나 공용망 대역을 잘못 차단하면 운영자와 정상 회원도 즉시 접속하지 못할 수 있습니다. 단일 IPv4는 /32, 단일 IPv6는 /128을 권장합니다. 이 기능은 애플리케이션 세션 차단이며 Vercel 방화벽/WAF의 네트워크 차단을 대신하지 않습니다.</p>
      <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-[var(--surface-muted)] p-4 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-xs font-black text-[var(--text-strong)]">차단 규칙 조회 사유<input value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} minLength={10} maxLength={500} placeholder="오차단 검토 또는 침해 대응 등 구체적인 사유" className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-3 font-bold" /></label><Button size="sm" variant="ghost" onClick={() => void load()} isLoading={isLoading} disabled={reviewReason.trim().length < 10}>규칙 조회</Button></div>
      <form onSubmit={createRule} className="mt-4 rounded-2xl bg-[var(--surface-muted)] p-4"><h3 className="font-black text-[var(--text-strong)]">새 차단 규칙</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><RuleInput label="IP 또는 CIDR" value={create.network} onChange={(value) => setCreate((current) => ({ ...current, network: value }))} placeholder="203.0.113.7/32" required /><RuleInput label="표시 이름 (선택)" value={create.label} onChange={(value) => setCreate((current) => ({ ...current, label: value }))} placeholder="반복 공격 네트워크" /><RuleInput label="차단 사유" value={create.reason} onChange={(value) => setCreate((current) => ({ ...current, reason: value }))} placeholder="확인된 오남용 근거를 10자 이상 입력" required /><RuleInput label="자동 만료 (선택)" type="datetime-local" value={create.expiresAt} onChange={(value) => setCreate((current) => ({ ...current, expiresAt: value }))} /></div><div className="mt-3 flex justify-end"><Button type="submit" isLoading={isMutating} disabled={!create.network.trim() || create.reason.trim().length < 10}>차단 규칙 추가</Button></div></form>
      <InlineNotice notice={notice} />
      {isLoading ? <p role="status" className="mt-4 font-bold text-[var(--text-muted)]">차단 규칙을 불러오는 중…</p> : rules.length === 0 ? <p className="mt-4 rounded-2xl bg-[var(--surface-muted)] p-4 font-bold text-[var(--text-muted)]">등록된 차단 규칙이 없습니다.</p> : <ul className="mt-4 space-y-3">{rules.map((rule) => <li key={rule.ruleId} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">{editingRuleId === rule.ruleId ? <div><div className="grid gap-3 sm:grid-cols-2"><RuleInput label="IP 또는 CIDR" value={editor.network} onChange={(value) => setEditor((current) => ({ ...current, network: value }))} required /><RuleInput label="표시 이름" value={editor.label} onChange={(value) => setEditor((current) => ({ ...current, label: value }))} /><RuleInput label="차단 사유" value={editor.reason} onChange={(value) => setEditor((current) => ({ ...current, reason: value }))} required /><RuleInput label="자동 만료" type="datetime-local" value={editor.expiresAt} onChange={(value) => setEditor((current) => ({ ...current, expiresAt: value }))} /><RuleInput label="이번 수정 사유" value={editor.changeReason} onChange={(value) => setEditor((current) => ({ ...current, changeReason: value }))} placeholder="변경 필요성과 근거를 10자 이상 입력" required /></div><div className="mt-3 flex flex-wrap justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditingRuleId("")}>취소</Button><Button size="sm" isLoading={isMutating} disabled={editor.changeReason.trim().length < 10} onClick={() => void saveEdit(rule.ruleId)}>수정 저장</Button></div></div> : <div><div className="flex flex-wrap justify-between gap-2"><div className="min-w-0"><p className="break-all font-mono text-sm font-black tabular-nums text-[var(--text-strong)]">{rule.label || "이름 없는 규칙"} · {rule.network}</p><p className="mt-1 text-xs font-bold text-[var(--text-muted)]">{rule.reason}<br />만료 {formatDateTime(rule.expiresAt)} · 수정 {formatDateTime(rule.updatedAt)}</p></div><span className={`h-fit rounded-full px-3 py-1 text-xs font-black ${rule.enabled ? "bg-[var(--danger-surface)] text-[var(--danger-text)]" : "bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}>{rule.enabled ? "차단 활성" : "차단 해제"}</span></div><div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-xs font-black text-[var(--text-strong)]">상태 변경 사유<input value={toggleReasons[rule.ruleId] ?? ""} onChange={(event) => setToggleReasons((current) => ({ ...current, [rule.ruleId]: event.target.value }))} minLength={10} maxLength={500} placeholder="해제 또는 재활성화 근거를 10자 이상 입력" className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-3 font-bold" /></label><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => startEdit(rule)}>수정</Button><Button size="sm" variant={rule.enabled ? "secondary" : "danger"} isLoading={isMutating} disabled={(toggleReasons[rule.ruleId]?.trim().length ?? 0) < 10} onClick={() => toggleRule(rule)}>{rule.enabled ? "차단 해제" : "다시 차단"}</Button></div></div></div>}</li>)}</ul>}
      <OwnerDangerConfirmModal
        open={Boolean(confirmation)}
        tone="danger"
        eyebrow="NETWORK ENFORCEMENT"
        title={confirmation?.kind === "toggle" ? (confirmation.rule.enabled ? "차단을 해제할까요?" : "네트워크를 다시 차단할까요?") : "네트워크 차단 규칙을 추가할까요?"}
        description="현재 접속 중인 운영자나 정상 회원의 네트워크가 포함되면 즉시 서비스 접근이 제한될 수 있습니다. 변경 전후 상태와 실행자는 감사 기록에 보존됩니다."
        confirmLabel={confirmation?.kind === "toggle" ? (confirmation.rule.enabled ? "차단 해제 확정" : "재차단 확정") : "차단 규칙 추가"}
        isLoading={isMutating}
        details={confirmation?.kind === "toggle" ? [
          { label: "네트워크", value: confirmation.rule.network },
          { label: "현재 상태", value: confirmation.rule.enabled ? "차단 활성" : "차단 해제" },
          { label: "변경 상태", value: confirmation.rule.enabled ? "차단 해제" : "차단 활성" },
        ] : confirmation?.kind === "create" ? [
          { label: "네트워크", value: create.network },
          { label: "만료", value: create.expiresAt || "자동 만료 없음" },
          { label: "적용 범위", value: "애플리케이션 전체 요청" },
        ] : []}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => confirmation?.kind === "toggle" ? confirmToggleRule(confirmation.rule) : confirmCreateRule()}
      />
    </section>
  );
}

function RuleInput({ label, value, onChange, type = "text", placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; type?: "text" | "datetime-local"; placeholder?: string; required?: boolean }) {
  return <label className="text-xs font-black text-[var(--text-strong)]">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-surface)] px-3 font-bold" /></label>;
}

function InlineNotice({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return <p role={notice.tone === "error" ? "alert" : "status"} className={`mt-4 rounded-xl px-4 py-3 font-bold ${notice.tone === "error" ? "bg-[var(--danger-surface)] text-[var(--danger-text)]" : "bg-[var(--success-surface)] text-[var(--success-text)]"}`}>{notice.text}</p>;
}
