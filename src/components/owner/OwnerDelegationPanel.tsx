"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/src/components/common";
import {
  beginOwnerDelegation,
  endOwnerDelegation,
  fetchOwnerDelegation,
  type OwnerDelegationSession,
  type OwnerDelegationTarget,
} from "@/src/lib/ownerAccess/client";

interface DelegationAuditRow {
  audit_id?: number;
  action?: string;
  occurred_at?: string;
  target_operator_id?: string;
  payload?: Record<string, unknown> | null;
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function delegationActionLabel(action?: string) {
  if (action === "delegation.started") return "운영자 컨텍스트 시작";
  if (action === "delegation.ended") return "운영자 컨텍스트 종료";
  if (action === "delegation.expired") return "운영자 컨텍스트 만료";
  if (action === "delegation.replaced") return "운영자 컨텍스트 교체";
  if (action === "product.created") return "상품 등록";
  if (action === "product.updated") return "상품 수정";
  return action || "운영 조작";
}

export function OwnerDelegationPanel({ accessToken }: { accessToken: string }) {
  const [targets, setTargets] = useState<OwnerDelegationTarget[]>([]);
  const [current, setCurrent] = useState<OwnerDelegationSession | null>(null);
  const [audit, setAudit] = useState<DelegationAuditRow[]>([]);
  const [selectedOperatorId, setSelectedOperatorId] = useState("");
  const [reason, setReason] = useState("상품 등록 및 운영 흐름 확인");
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const targetNames = useMemo(
    () => new Map(targets.map((target) => [target.operator_id, target.display_name])),
    [targets],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await fetchOwnerDelegation(accessToken);
      setTargets(result.targets);
      setCurrent(result.current);
      setAudit(result.audit as DelegationAuditRow[]);
      setSelectedOperatorId((value) =>
        value && result.targets.some((target) => target.operator_id === value)
          ? value
          : (result.current?.target_operator_id ?? result.targets[0]?.operator_id ?? ""),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "운영자 컨텍스트를 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const begin = async () => {
    if (!selectedOperatorId || reason.trim().length < 3) return;
    setIsMutating(true);
    setMessage("");
    setError("");
    try {
      await beginOwnerDelegation(accessToken, selectedOperatorId, reason.trim());
      await load();
      setMessage("선택한 운영자 컨텍스트를 시작했습니다. 이후 상품 등록·수정은 해당 운영자 소유로 기록됩니다.");
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "운영자 컨텍스트를 시작하지 못했습니다.",
      );
    } finally {
      setIsMutating(false);
    }
  };

  const end = async () => {
    if (!current) return;
    setIsMutating(true);
    setMessage("");
    setError("");
    try {
      await endOwnerDelegation(accessToken, current.session_id);
      await load();
      setMessage("운영자 컨텍스트를 종료했습니다. 총책임자 기본 운영 컨텍스트로 돌아왔습니다.");
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "운영자 컨텍스트를 종료하지 못했습니다.",
      );
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <section className="theme-panel rounded-[1.8rem] border p-5 sm:p-6" aria-labelledby="owner-delegation-title">
      <p className="text-xs font-black tracking-[0.16em] text-[var(--accent-text)]">
        AUDITED OPERATOR CONTEXT
      </p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="owner-delegation-title" className="text-2xl font-black text-[var(--text-strong)]">
            운영자 컨텍스트
          </h2>
          <p className="mt-2 max-w-3xl break-keep font-bold leading-7 text-[var(--text-muted)]">
            공개 화면에서는 항상 운영자로 보입니다. 컨텍스트 사용 중 등록·수정한 상품과 문의 연결은 선택 운영자에게 귀속되며, 실제 실행자와 사유는 삭제 불가 감사 기록으로 남습니다.
          </p>
        </div>
        <span className="rounded-full border border-[var(--info-border)] bg-[var(--info-surface)] px-3 py-1.5 text-xs font-black text-[var(--info-text)]">
          감사 기록 활성
        </span>
      </div>

      {isLoading ? (
        <p className="mt-5 font-bold text-[var(--text-muted)]">운영자 컨텍스트를 불러오는 중…</p>
      ) : (
        <>
          <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-sm font-black text-[var(--text-muted)]">현재 컨텍스트</p>
            <p className="mt-1 text-lg font-black text-[var(--text-strong)]">
              {current ? current.target_display_name : "총책임자 기본 운영"}
            </p>
            {current ? (
              <p className="mt-1 text-sm font-bold text-[var(--text-muted)]">
                사유: {current.reason} · {formatDateTime(current.expires_at)} 자동 만료
              </p>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <label className="text-sm font-black text-[var(--text-strong)]">
              귀속할 운영자
              <select
                value={selectedOperatorId}
                onChange={(event) => setSelectedOperatorId(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 font-bold"
              >
                {targets.length === 0 ? <option value="">등록된 운영자가 없습니다</option> : null}
                {targets.map((target) => (
                  <option key={target.operator_id} value={target.operator_id}>
                    {target.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-black text-[var(--text-strong)]">
              사용 사유
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={3}
                maxLength={300}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 font-bold"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {current ? (
              <Button variant="ghost" isLoading={isMutating} onClick={() => void end()}>
                컨텍스트 종료
              </Button>
            ) : null}
            <Button
              isLoading={isMutating}
              disabled={!selectedOperatorId || reason.trim().length < 3}
              onClick={() => void begin()}
            >
              {current ? "선택 운영자로 교체" : "운영자 컨텍스트 시작"}
            </Button>
          </div>
        </>
      )}

      {error ? <p role="alert" className="mt-4 rounded-xl bg-[var(--danger-surface)] px-4 py-3 font-bold text-[var(--danger-text)]">{error}</p> : null}
      {message ? <p role="status" className="mt-4 rounded-xl bg-[var(--info-surface)] px-4 py-3 font-bold text-[var(--info-text)]">{message}</p> : null}

      {audit.length > 0 ? (
        <details className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <summary className="cursor-pointer font-black text-[var(--text-strong)]">최근 감사 기록 {audit.length}건</summary>
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
            {audit.slice(0, 30).map((row, index) => (
              <li key={row.audit_id ?? index} className="rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-sm font-bold text-[var(--text-muted)]">
                <span className="font-black text-[var(--text-strong)]">{delegationActionLabel(row.action)}</span>
                {row.target_operator_id ? ` · ${targetNames.get(row.target_operator_id) ?? "지정 운영자"}` : ""}
                <span className="block text-xs">{formatDateTime(row.occurred_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
