"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/src/components/common";
import {
  getApprovedMaskedSecurityLogs,
  listMySecurityLogAccessRequests,
  requestSecurityLogAccess,
  respondSecurityLogSubjectConsent,
  revokeSecurityLogAccess,
  type MaskedSecurityActivity,
  type SecurityLogAccessRequest,
  type SecurityLogRequestStatus,
} from "@/src/lib/securityAudit/client";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";

type Notice = { tone: "success" | "error"; text: string } | null;
const MASKED_LOG_PAGE_SIZE = 100;

const statusCopy: Record<SecurityLogRequestStatus, string> = {
  awaiting_subject_consent: "정보 주체 동의 대기",
  awaiting_owner_approval: "총책임자 승인 대기",
  approved: "승인됨",
  denied: "거절됨",
  revoked: "열람 종료",
  expired: "기간 만료",
};

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : dateTimeFormatter.format(date);
}

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return { from: toDateInput(from), to: toDateInput(to) };
}

function dateBoundary(value: string, endOfDay: boolean): string {
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return date.toISOString();
}

function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const copy: Record<string, string> = {
    invalid_date_range: "조회 기간을 다시 확인해 주세요. 한 요청은 최대 90일까지 가능합니다.",
    reason_too_short: "요청 사유를 10자 이상 입력해 주세요.",
    subject_not_found: "입력한 공개 닉네임과 정확히 일치하는 회원을 찾지 못했습니다.",
    ambiguous_subject: "같은 닉네임이 확인되어 요청할 수 없습니다. 고객센터에 문의해 주세요.",
    consent_not_available: "이미 처리되었거나 만료된 동의 요청입니다.",
    access_not_approved: "승인되었거나 열람 가능한 요청이 아닙니다.",
  };
  return copy[error.message] ?? fallback;
}

function RequestStatusBadge({ status }: { status: SecurityLogRequestStatus }) {
  const tone =
    status === "approved"
      ? "border-[var(--success-text)]/25 bg-[var(--success-surface)] text-[var(--success-text)]"
      : status === "denied" || status === "revoked" || status === "expired"
        ? "border-[var(--danger-text)]/25 bg-[var(--danger-surface)] text-[var(--danger-text)]"
        : "border-[var(--warning-text)]/25 bg-[var(--warning-surface)] text-[var(--warning-text)]";
  return (
    <span className={`rounded-md border px-2.5 py-1 text-[10px] font-semibold tracking-wide ${tone}`}>
      {statusCopy[status]}
    </span>
  );
}

export function MemberSecurityLogPanel() {
  const [requests, setRequests] = useState<SecurityLogAccessRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [mode, setMode] = useState<"self" | "other">("self");
  const [subjectDisplayName, setSubjectDisplayName] = useState("");
  const [reason, setReason] = useState("");
  const initial = useMemo(() => initialRange(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [consentNote, setConsentNote] = useState<Record<string, string>>({});
  const [revocationReason, setRevocationReason] = useState<Record<string, string>>({});
  const [viewingRequest, setViewingRequest] = useState<SecurityLogAccessRequest | null>(null);
  const [maskedLogs, setMaskedLogs] = useState<MaskedSecurityActivity[]>([]);
  const [hasMoreMaskedLogs, setHasMoreMaskedLogs] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const loadRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await listMySecurityLogAccessRequests(getSupabaseBrowserClient());
      setRequests(items);
    } catch (error) {
      setNotice({
        tone: "error",
        text: readableError(error, "로그 요청 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadRequests(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadRequests]);

  const outgoing = requests.filter((request) => request.isRequester);
  const consentInbox = requests.filter(
    (request) =>
      request.isSubject &&
      !request.isRequester &&
      request.status === "awaiting_subject_consent",
  );
  const activeSubjectShares = requests.filter(
    (request) =>
      request.isSubject &&
      !request.isRequester &&
      (request.status === "awaiting_owner_approval" || request.status === "approved"),
  );
  const subjectConsentHistory = requests.filter(
    (request) =>
      request.isSubject &&
      !request.isRequester &&
      request.status !== "awaiting_subject_consent" &&
      request.status !== "awaiting_owner_approval" &&
      request.status !== "approved",
  );

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    if (reason.trim().length < 10) {
      setNotice({ tone: "error", text: "요청 사유를 10자 이상 입력해 주세요." });
      return;
    }
    if (!from || !to || from > to) {
      setNotice({ tone: "error", text: "시작일과 종료일을 올바르게 선택해 주세요." });
      return;
    }
    if (mode === "other" && subjectDisplayName.trim().length < 2) {
      setNotice({ tone: "error", text: "상대방의 공개 닉네임을 정확히 입력해 주세요." });
      return;
    }

    setIsSubmitting(true);
    try {
      await requestSecurityLogAccess(getSupabaseBrowserClient(), {
        reason: reason.trim(),
        from: dateBoundary(from, false),
        to: dateBoundary(to, true),
        subjectDisplayName: mode === "other" ? subjectDisplayName.trim() : undefined,
      });
      setReason("");
      setSubjectDisplayName("");
      setNotice({
        tone: "success",
        text:
          mode === "self"
            ? "본인 로그 요청을 접수했습니다. 총책임자 승인 후 마스킹된 기록을 확인할 수 있습니다."
            : "상대방 동의 요청을 보냈습니다. 동의 후 총책임자 승인 절차가 진행됩니다.",
      });
      await loadRequests();
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "로그 열람 요청을 접수하지 못했습니다.") });
    } finally {
      setIsSubmitting(false);
    }
  };

  const decideConsent = async (requestId: string, approved: boolean) => {
    setProcessingRequestId(requestId);
    setNotice(null);
    try {
      await respondSecurityLogSubjectConsent(
        getSupabaseBrowserClient(),
        requestId,
        approved,
        consentNote[requestId]?.trim() || undefined,
      );
      setNotice({
        tone: "success",
        text: approved
          ? "동의했습니다. 총책임자 승인 전까지 로그는 상대방에게 공개되지 않습니다."
          : "요청을 거절했습니다. 상대방에게 로그가 공개되지 않습니다.",
      });
      await loadRequests();
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "동의 요청을 처리하지 못했습니다.") });
    } finally {
      setProcessingRequestId("");
    }
  };

  const openApprovedLogs = async (request: SecurityLogAccessRequest) => {
    setViewingRequest(request);
    setMaskedLogs([]);
    setHasMoreMaskedLogs(false);
    setIsLoadingLogs(true);
    setNotice(null);
    try {
      const logs = await getApprovedMaskedSecurityLogs(
        getSupabaseBrowserClient(),
        request.requestId,
        MASKED_LOG_PAGE_SIZE,
      );
      setMaskedLogs(logs);
      setHasMoreMaskedLogs(logs.length === MASKED_LOG_PAGE_SIZE);
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "승인된 로그를 불러오지 못했습니다.") });
      setViewingRequest(null);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const loadMoreMaskedLogs = async () => {
    if (!viewingRequest || isLoadingLogs) return;
    setIsLoadingLogs(true);
    try {
      const next = await getApprovedMaskedSecurityLogs(
        getSupabaseBrowserClient(),
        viewingRequest.requestId,
        MASKED_LOG_PAGE_SIZE,
        maskedLogs.length,
      );
      setMaskedLogs((current) => [...current, ...next]);
      setHasMoreMaskedLogs(next.length === MASKED_LOG_PAGE_SIZE);
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "다음 로그를 불러오지 못했습니다.") });
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const revokeSubjectAccess = async (requestId: string) => {
    const reason = revocationReason[requestId]?.trim() ?? "";
    if (reason.length < 10) {
      setNotice({ tone: "error", text: "철회 사유를 10자 이상 입력해 주세요." });
      return;
    }
    setProcessingRequestId(requestId);
    setNotice(null);
    try {
      await revokeSecurityLogAccess(getSupabaseBrowserClient(), requestId, reason);
      setNotice({ tone: "success", text: "동의 또는 본인 열람을 철회해 추가 로그 열람을 즉시 중단했습니다." });
      await loadRequests();
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error, "로그 제공 동의를 철회하지 못했습니다.") });
    } finally {
      setProcessingRequestId("");
    }
  };

  const fieldClasses =
    "mt-2 min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--input-surface)] px-3 text-sm font-medium text-[var(--text-strong)] outline-none transition-all duration-200 ease-out placeholder:font-normal placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)]/20 disabled:cursor-not-allowed disabled:opacity-60";
  const compactFieldClasses =
    "mt-1.5 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 text-sm font-medium text-[var(--text-strong)] outline-none transition-all duration-200 ease-out placeholder:font-normal placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)]/20";

  return (
    <section className="theme-panel mt-5 rounded-2xl border p-5 shadow-sm sm:p-7" aria-labelledby="security-log-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--accent-text)]">PRIVACY LOG REQUEST</p>
          <h2 id="security-log-title" className="mt-1.5 text-xl font-semibold tracking-tight text-[var(--text-strong)]">내 활동 로그 요청</h2>
          <p className="mt-2 max-w-3xl break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">
            승인된 기간의 마스킹 사본만 제한된 시간 동안 제공됩니다. 원문 IP·기기 상세·내부 권한·다른 회원의 식별정보는 표시하지 않으며, 요청·동의·승인·열람 이력은 오남용 방지를 위해 감사 기록으로 남습니다.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--info-border)] bg-[var(--info-surface)] px-2.5 py-1 text-[10px] font-semibold tracking-wide text-[var(--info-text)]">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-3.5"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v10H5z" /></svg>
          원문 직접 열람 불가
        </span>
      </div>

      <form onSubmit={submitRequest} className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 sm:p-5">
        <fieldset disabled={isSubmitting}>
          <legend className="text-xs font-semibold tracking-wide text-[var(--text-strong)]">열람 대상</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(["self", "other"] as const).map((value) => (
              <label key={value} className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--border-strong)] ${mode === value ? "border-[var(--accent)] bg-[var(--accent-surface)] shadow-sm" : "border-[var(--border)] bg-[var(--surface)]"}`}>
                <input type="radio" name="security-log-target" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>
                  <span className="block text-sm font-semibold text-[var(--text-strong)]">{value === "self" ? "내 로그" : "다른 회원의 로그"}</span>
                  <span className="mt-1 block text-xs font-medium leading-5 text-[var(--text-muted)]">{value === "self" ? "총책임자 승인 후 마스킹 사본 제공" : "정보 주체 동의 후 총책임자 승인 필요"}</span>
                </span>
              </label>
            ))}
          </div>
          {mode === "other" ? (
            <label className="mt-4 block text-xs font-semibold tracking-wide text-[var(--text-strong)]">
              상대방의 정확한 공개 닉네임
              <input value={subjectDisplayName} onChange={(event) => setSubjectDisplayName(event.target.value)} minLength={2} maxLength={30} autoComplete="off" placeholder="회원 검색 목록 없이 정확히 입력" className={fieldClasses} />
              <span className="mt-1.5 block text-[11px] font-medium normal-case tracking-normal text-[var(--text-muted)]">회원 명단과 사용자 ID는 개인정보 보호를 위해 제공하지 않습니다.</span>
            </label>
          ) : null}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold tracking-wide text-[var(--text-strong)]">조회 시작일<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required className={`${fieldClasses} font-mono tabular-nums tracking-tight`} /></label>
            <label className="text-xs font-semibold tracking-wide text-[var(--text-strong)]">조회 종료일<input type="date" value={to} onChange={(event) => setTo(event.target.value)} required className={`${fieldClasses} font-mono tabular-nums tracking-tight`} /></label>
          </div>
          <label className="mt-4 block text-xs font-semibold tracking-wide text-[var(--text-strong)]">요청 사유<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={500} rows={3} required placeholder="확인이 필요한 구체적인 이유를 10자 이상 적어 주세요." className={`${fieldClasses} min-h-24 resize-y py-3`} /><span className="mt-1.5 block text-[11px] font-medium normal-case tracking-normal text-[var(--text-muted)]">다른 회원의 로그 요청 사유는 동의 판단을 위해 그 회원에게 그대로 공개됩니다. 민감한 개인정보는 적지 마세요.</span></label>
          <div className="mt-4 flex justify-end"><Button type="submit" isLoading={isSubmitting} disabled={reason.trim().length < 10}>{isSubmitting ? "요청 접수 중…" : "로그 요청하기"}</Button></div>
        </fieldset>
      </form>

      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-semibold leading-6 ${
            notice.tone === "error"
              ? "border-[var(--danger-text)]/20 bg-[var(--danger-surface)] text-[var(--danger-text)]"
              : "border-[var(--success-text)]/20 bg-[var(--success-surface)] text-[var(--success-text)]"
          }`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="mt-0.5 size-4 shrink-0">
            {notice.tone === "error" ? <path d="M12 8v4m0 4h.01M10.3 4.4 2.8 17.2A1.2 1.2 0 0 0 3.84 19h16.32a1.2 1.2 0 0 0 1.04-1.8L13.7 4.4a1.98 1.98 0 0 0-3.4 0Z" /> : <path d="m5 12 4 4L19 6" />}
          </svg>
          <p>{notice.text}</p>
        </div>
      ) : null}

      {consentInbox.length > 0 ? (
        <section className="mt-6" aria-labelledby="consent-inbox-title">
          <h3 id="consent-inbox-title" className="text-lg font-semibold tracking-tight text-[var(--text-strong)]">내 동의가 필요한 요청</h3>
          <p className="mt-1 text-xs font-medium leading-5 text-[var(--text-muted)]">동의해도 총책임자가 목적과 범위를 다시 검토하며, 승인 전에는 기록이 공개되지 않습니다.</p>
          <div className="mt-3 space-y-3">
            {consentInbox.map((request) => (
              <article key={request.requestId} className="rounded-xl border border-[var(--warning-text)]/25 bg-[var(--warning-surface)] p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-[var(--text-strong)]">{request.requesterDisplayName} 님의 요청</p><RequestStatusBadge status={request.status} /></div>
                <p className="mt-2 text-sm font-medium leading-6 text-[var(--text-muted)]"><span className="font-mono text-xs tabular-nums tracking-tight">기간: {formatDateTime(request.requestedFrom)} ~ {formatDateTime(request.requestedTo)}</span><br />사유: {request.reason}</p>
                <label className="mt-3 block text-xs font-semibold text-[var(--text-strong)]">선택 메모<input value={consentNote[request.requestId] ?? ""} onChange={(event) => setConsentNote((current) => ({ ...current, [request.requestId]: event.target.value }))} maxLength={500} className={compactFieldClasses} /></label>
                <div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="ghost" isLoading={processingRequestId === request.requestId} onClick={() => void decideConsent(request.requestId, false)}>동의하지 않음</Button><Button size="sm" isLoading={processingRequestId === request.requestId} onClick={() => void decideConsent(request.requestId, true)}>마스킹 제공 동의</Button></div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeSubjectShares.length > 0 ? (
        <section className="mt-6" aria-labelledby="active-log-sharing-title">
          <h3 id="active-log-sharing-title" className="text-lg font-semibold tracking-tight text-[var(--text-strong)]">내가 동의한 요청</h3>
          <p className="mt-1 text-xs font-medium leading-5 text-[var(--text-muted)]">총책임자 승인 전이나 승인 기간 중에도 동의를 철회하면 상대방의 열람이 차단됩니다.</p>
          <div className="mt-3 space-y-3">
            {activeSubjectShares.map((request) => (
              <article key={request.requestId} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-[var(--text-strong)]">{request.requesterDisplayName} 님에게 제공 중</p><RequestStatusBadge status={request.status} /></div>
                <p className="mt-2 text-xs font-medium leading-5 text-[var(--text-muted)]"><span className="font-mono tabular-nums tracking-tight">{request.status === "approved" ? `열람 만료 ${formatDateTime(request.accessExpiresAt)}` : "현재 총책임자 승인 대기 중"}</span><br />요청 사유: {request.reason}</p>
                <label className="mt-3 block text-xs font-semibold text-[var(--text-strong)]">철회 사유<input value={revocationReason[request.requestId] ?? ""} onChange={(event) => setRevocationReason((current) => ({ ...current, [request.requestId]: event.target.value }))} minLength={10} maxLength={500} placeholder="추가 열람을 중단할 사유 (10자 이상)" className={compactFieldClasses} /></label>
                <div className="mt-3 flex justify-end"><Button size="sm" variant="danger" isLoading={processingRequestId === request.requestId} disabled={(revocationReason[request.requestId]?.trim().length ?? 0) < 10} onClick={() => void revokeSubjectAccess(request.requestId)}>동의·열람 철회</Button></div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {subjectConsentHistory.length > 0 ? (
        <details className="theme-panel group mt-6 rounded-xl border p-4 transition-all duration-200 ease-out open:shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-base font-semibold text-[var(--text-strong)]">내 동의 처리 이력</span>
              <span className="mt-1 block text-xs font-medium text-[var(--text-muted)]">거절·철회·만료 기록 <span className="font-mono tabular-nums tracking-tight">{subjectConsentHistory.length}</span>건</span>
            </span>
            <span aria-hidden="true" className="text-sm font-semibold text-[var(--text-muted)] transition-transform duration-200 group-open:rotate-180">⌄</span>
          </summary>
          <ul className="mt-3 space-y-2">
            {subjectConsentHistory.map((request) => (
              <li key={request.requestId} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--text-strong)]">{request.requesterDisplayName} 님의 요청</p>
                  <RequestStatusBadge status={request.status} />
                </div>
                <p className="mt-2 text-xs font-medium leading-5 text-[var(--text-muted)]">
                  <span className="font-mono tabular-nums tracking-tight">접수 {formatDateTime(request.createdAt)}</span> · 정보 주체 결정 {request.subjectDecision === "approved" ? "동의" : request.subjectDecision === "denied" ? "거절" : "확인 전"}<br />
                  <span className="font-mono tabular-nums tracking-tight">조회 범위 {formatDateTime(request.requestedFrom)} ~ {formatDateTime(request.requestedTo)}</span><br />
                  사유: {request.reason}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <section className="mt-6" aria-labelledby="request-history-title">
        <div className="flex items-center justify-between gap-3"><h3 id="request-history-title" className="text-lg font-semibold tracking-tight text-[var(--text-strong)]">내 요청 내역</h3><Button size="sm" variant="ghost" onClick={() => void loadRequests()} isLoading={isLoading}>새로고침</Button></div>
        {isLoading ? (
          <div role="status" aria-label="요청 내역을 불러오는 중" className="mt-4 space-y-2">
            <div className="commerce-skeleton h-24 rounded-xl" />
            <div className="commerce-skeleton h-24 rounded-xl" />
          </div>
        ) : outgoing.length === 0 ? (
          <div className="commerce-empty-state mt-4 min-h-40">
            <span aria-hidden="true" className="commerce-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="M5 4.5h14v15H5zM8 8h8m-8 4h8m-8 4h5" /></svg>
            </span>
            <div><p className="text-sm font-semibold text-[var(--text-strong)]">접수한 요청이 없습니다.</p><p className="mt-1 text-xs font-medium text-[var(--text-muted)]">열람이 필요할 때 위 양식을 제출해 주세요.</p></div>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {outgoing.map((request) => (
              <li key={request.requestId} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-[var(--text-strong)]">{request.isSubject ? "내 활동 로그" : `${request.subjectDisplayName} 님의 마스킹 로그`}</p><p className="mt-1 font-mono text-[11px] font-medium tabular-nums tracking-tight text-[var(--text-muted)]">접수 {formatDateTime(request.createdAt)} · 요청번호 {request.requestId.slice(0, 8)}</p></div><RequestStatusBadge status={request.status} /></div>
                <p className="mt-3 text-sm font-medium leading-6 text-[var(--text-muted)]">{request.reason}<br /><span className="font-mono text-xs tabular-nums tracking-tight">조회 범위: {formatDateTime(request.requestedFrom)} ~ {formatDateTime(request.requestedTo)}</span></p>
                {request.status === "approved" ? (
                  <div className="mt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-xs font-semibold tabular-nums tracking-tight text-[var(--success-text)]">{formatDateTime(request.accessExpiresAt)}까지 열람 가능</p>
                      <Button size="sm" variant="secondary" onClick={() => void openApprovedLogs(request)}>마스킹 로그 보기</Button>
                    </div>
                    {request.isSubject ? (
                      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <label className="block text-xs font-semibold text-[var(--text-strong)]">내 열람 종료 사유<input value={revocationReason[request.requestId] ?? ""} onChange={(event) => setRevocationReason((current) => ({ ...current, [request.requestId]: event.target.value }))} minLength={10} maxLength={500} placeholder="추가 열람을 종료할 사유 (10자 이상)" className={compactFieldClasses} /></label>
                        <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" isLoading={processingRequestId === request.requestId} disabled={(revocationReason[request.requestId]?.trim().length ?? 0) < 10} onClick={() => void revokeSubjectAccess(request.requestId)}>열람 종료</Button></div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {request.status === "awaiting_owner_approval" && request.isSubject ? (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <label className="block text-xs font-semibold text-[var(--text-strong)]">요청 취소 사유<input value={revocationReason[request.requestId] ?? ""} onChange={(event) => setRevocationReason((current) => ({ ...current, [request.requestId]: event.target.value }))} minLength={10} maxLength={500} placeholder="승인 대기 요청을 취소할 사유 (10자 이상)" className={compactFieldClasses} /></label>
                    <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" isLoading={processingRequestId === request.requestId} disabled={(revocationReason[request.requestId]?.trim().length ?? 0) < 10} onClick={() => void revokeSubjectAccess(request.requestId)}>요청 취소</Button></div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {viewingRequest ? (
        <section className="mt-6 rounded-xl border border-[var(--info-border)] bg-[var(--info-surface)] p-4 sm:p-5" aria-labelledby="masked-log-viewer-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="masked-log-viewer-title" className="text-lg font-semibold tracking-tight text-[var(--text-strong)]">승인된 마스킹 로그</h3>
              <p className="mt-1 font-mono text-xs font-medium tabular-nums tracking-tight text-[var(--text-muted)]">열람 만료 {formatDateTime(viewingRequest.accessExpiresAt)} · 열람 행위도 감사 기록에 남습니다.</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setViewingRequest(null); setMaskedLogs([]); }}>닫기</Button>
          </div>
          {isLoadingLogs && maskedLogs.length === 0 ? (
            <div role="status" aria-label="마스킹 로그를 불러오는 중" className="mt-4 space-y-2">
              <div className="commerce-skeleton h-20 rounded-lg" />
              <div className="commerce-skeleton h-20 rounded-lg" />
              <div className="commerce-skeleton h-20 rounded-lg" />
            </div>
          ) : maskedLogs.length === 0 ? (
            <div className="commerce-empty-state mt-4 min-h-40">
              <span aria-hidden="true" className="commerce-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="M5 4.5h14v15H5zM8 8h8m-8 4h8m-8 4h5" /></svg></span>
              <p className="text-sm font-semibold text-[var(--text-strong)]">승인된 기간에 제공할 기록이 없습니다.</p>
            </div>
          ) : (
            <>
              <ul className="mt-4 max-h-[34rem] space-y-2 overflow-y-auto pr-1">
                {maskedLogs.map((log) => (
                  <li key={log.logKey} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 transition-colors duration-200 hover:border-[var(--border-strong)]">
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--text-strong)]">{log.eventType} · {log.action}</p>
                      <span className="font-mono text-[11px] font-medium tabular-nums tracking-tight text-[var(--text-muted)]">{formatDateTime(log.occurredAt)}</span>
                    </div>
                    <p className="mt-1 break-all font-mono text-[11px] font-medium leading-5 tabular-nums tracking-tight text-[var(--text-muted)]">분류 {log.category} · 출처 {log.source}{log.actorLabel ? ` · 실행 ${log.actorLabel}` : ""}{log.subjectLabel ? ` · 대상 ${log.subjectLabel}` : ""}{log.ipAddressMasked ? ` · IP ${log.ipAddressMasked}` : ""}{log.userAgentMasked ? ` · 기기 ${log.userAgentMasked}` : ""}</p>
                  </li>
                ))}
              </ul>
              {hasMoreMaskedLogs ? (
                <div className="mt-3 flex justify-center"><Button size="sm" variant="ghost" isLoading={isLoadingLogs} onClick={() => void loadMoreMaskedLogs()}>다음 100건 불러오기</Button></div>
              ) : (
                <p className="mt-3 text-center text-xs font-medium text-[var(--text-muted)]">승인 범위의 로그 <span className="font-mono tabular-nums tracking-tight">{maskedLogs.length}</span>건을 모두 불러왔습니다.</p>
              )}
            </>
          )}
        </section>
      ) : null}
    </section>
  );
}
