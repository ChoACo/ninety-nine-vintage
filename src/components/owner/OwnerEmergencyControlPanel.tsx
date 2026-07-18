"use client";

import { useEffect, useState } from "react";

import { Button } from "@/src/components/common";
import { OwnerDangerConfirmModal } from "@/src/components/owner/OwnerDangerConfirmModal";
import {
  fetchOwnerPaymentRuntime,
  setOwnerPaymentRuntimeMode,
  type OwnerPaymentRuntime,
} from "@/src/lib/ownerAccess/client";

interface OwnerEmergencyControlPanelProps {
  accessToken: string;
  onOpenSandbox: () => void;
}

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDateTime(value: string | null): string {
  if (!value) return "기록 없음";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "기록 없음" : dateTimeFormatter.format(parsed);
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "긴급 제어 상태를 변경하지 못했습니다.";
  if (error.message === "portone_not_ready") {
    return "PortOne 서버 Secret, 웹훅 Secret, Store ID와 결제 채널 준비가 완료되지 않아 PG 모드를 열 수 없습니다.";
  }
  if (error.message === "owner_rpc_failed") {
    return "입금 확인 대기 주문이 남아 있거나 현재 결제 모드를 변경할 수 없습니다.";
  }
  return error.message;
}

export function OwnerEmergencyControlPanel({
  accessToken,
  onOpenSandbox,
}: OwnerEmergencyControlPanelProps) {
  const [runtime, setRuntime] = useState<OwnerPaymentRuntime | null>(null);
  const [pendingMode, setPendingMode] = useState<OwnerPaymentRuntime["activeMode"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      setRuntime(await fetchOwnerPaymentRuntime(accessToken));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void fetchOwnerPaymentRuntime(accessToken)
      .then((nextRuntime) => {
        if (active) setRuntime(nextRuntime);
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accessToken]);

  const confirmModeChange = async () => {
    if (!pendingMode || isMutating) return;
    setIsMutating(true);
    setError("");
    setMessage("");
    try {
      const next = await setOwnerPaymentRuntimeMode(accessToken, pendingMode);
      setRuntime(next);
      setPendingMode(null);
      setMessage(
        next.activeMode === "manual_transfer"
          ? "결제 운영 모드를 수동 계좌이체로 전환했습니다."
          : "PortOne PG 결제 모드를 활성화했습니다.",
      );
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setIsMutating(false);
    }
  };

  const currentLabel = runtime?.activeMode === "portone" ? "PortOne PG" : "수동 계좌이체";

  return (
    <section className="space-y-4" aria-labelledby="owner-emergency-title">
      <div className="rounded-xl border border-red-500/25 bg-gradient-to-br from-red-500/10 via-[var(--surface)] to-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] font-black tracking-[0.18em] text-[var(--danger-text)]">
              RED / AMBER ZONE
            </p>
            <h2 id="owner-emergency-title" className="mt-1 text-xl font-black tracking-tight text-[var(--text-strong)] sm:text-2xl">
              시스템 긴급 제어
            </h2>
            <p className="mt-2 max-w-3xl break-keep text-sm font-semibold leading-6 text-[var(--text-muted)]">
              실제 서버 상태를 변경하는 제어만 활성화합니다. 백엔드 차단 장치가 없는 항목은 허위 버튼 대신 잠금 상태로 유지합니다.
            </p>
          </div>
          <Button size="sm" variant="ghost" isLoading={isLoading} onClick={() => void load()}>
            상태 재검증
          </Button>
        </div>
      </div>

      {message ? <p role="status" className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-[var(--success-text)]">{message}</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-bold text-[var(--danger-text)]">{error}</p> : null}

      <div className="grid gap-3 xl:grid-cols-3">
        <article className="rounded-xl border border-amber-400/25 bg-[var(--surface)] p-4 sm:p-5 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-black tracking-[0.15em] text-[var(--warning-text)]">PAYMENT RUNTIME</p>
              <h3 className="mt-1 text-lg font-black text-[var(--text-strong)]">결제 운영 모드</h3>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-xs font-black text-[var(--warning-text)]">
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {isLoading ? "검증 중" : currentLabel}
            </span>
          </div>
          <dl className="mt-4 grid gap-px overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-800/80 sm:grid-cols-3">
            <div className="bg-[var(--surface-muted)] p-3">
              <dt className="text-[10px] font-black text-[var(--text-muted)]">계좌 설정</dt>
              <dd className="mt-1 text-sm font-black text-[var(--text-strong)]">{runtime?.bankConfigured ? "완료" : "미완료"}</dd>
            </div>
            <div className="bg-[var(--surface-muted)] p-3">
              <dt className="text-[10px] font-black text-[var(--text-muted)]">PortOne 서버</dt>
              <dd className="mt-1 text-sm font-black text-[var(--text-strong)]">{runtime?.portoneReady ? "준비 완료" : "잠금"}</dd>
            </div>
            <div className="bg-[var(--surface-muted)] p-3">
              <dt className="text-[10px] font-black text-[var(--text-muted)]">최근 변경</dt>
              <dd className="mt-1 font-mono text-[10px] font-black tabular-nums text-[var(--text-strong)]">{formatDateTime(runtime?.updatedAt ?? null)}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              disabled={isLoading || runtime?.activeMode === "manual_transfer"}
              onClick={() => setPendingMode("manual_transfer")}
            >
              수동 계좌이체로 전환
            </Button>
            <Button
              variant="danger"
              disabled={isLoading || runtime?.activeMode === "portone" || !runtime?.portoneReady}
              onClick={() => setPendingMode("portone")}
            >
              PortOne PG 활성화
            </Button>
          </div>
          {!runtime?.portoneReady ? (
            <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs font-semibold leading-5 text-[var(--text-muted)]">
              PG 활성화는 서버 Secret·웹훅 Secret·Store ID·결제 채널이 모두 검증된 경우에만 열립니다.
            </p>
          ) : null}
        </article>

        <article className="rounded-xl border border-zinc-800/80 bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-black tracking-[0.15em] text-[var(--text-muted)]">CACHE POLICY</p>
              <h3 className="mt-1 text-lg font-black text-[var(--text-strong)]">민감 데이터 캐시</h3>
            </div>
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black text-[var(--success-text)]">NO-STORE</span>
          </div>
          <p className="mt-3 break-keep text-xs font-semibold leading-5 text-[var(--text-muted)]">
            관리자 API는 브라우저·CDN 저장을 금지합니다. 현재 삭제할 전역 애플리케이션 캐시 계층이 없어 “전체 초기화” 버튼은 노출하지 않습니다.
          </p>
          <Button className="mt-4 w-full" size="sm" variant="ghost" onClick={() => window.location.reload()}>
            이 콘솔 새로고침
          </Button>
        </article>
      </div>

      <article className="rounded-xl border border-zinc-800/80 bg-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-800 bg-zinc-900/60 font-mono text-sm font-black text-zinc-500" aria-hidden="true">×</span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-black text-[var(--text-strong)]">전체 경매 수동 일시정지</h3>
                <span className="rounded-full border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[9px] font-black text-zinc-500">BACKEND LOCKED</span>
              </div>
              <p className="mt-1 max-w-3xl break-keep text-xs font-semibold leading-5 text-[var(--text-muted)]">
                현재 서버에는 전역 pause 상태와 입찰 차단 RPC가 없습니다. 개별 상품은 감사 기록이 보존되는 기존 경매 안전 제어에서 즉시 마감·가격 조정할 수 있습니다.
              </p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onOpenSandbox}>경매 안전 제어 열기</Button>
        </div>
      </article>

      <OwnerDangerConfirmModal
        open={Boolean(pendingMode)}
        tone="danger"
        eyebrow="PAYMENT RUNTIME OVERRIDE"
        title="결제 운영 모드를 전환할까요?"
        description="모든 신규 결제 흐름에 즉시 적용됩니다. PortOne 전환 시 서버 구성과 미처리 계좌이체 주문을 다시 검증합니다."
        confirmLabel={`${pendingMode === "portone" ? "PortOne PG" : "수동 계좌이체"} 전환 확정`}
        isLoading={isMutating}
        details={[
          { label: "현재 모드", value: currentLabel },
          { label: "변경 모드", value: pendingMode === "portone" ? "PortOne PG" : "수동 계좌이체" },
          { label: "감사 기록", value: "변경 전후 상태 자동 보존" },
        ]}
        onCancel={() => setPendingMode(null)}
        onConfirm={confirmModeChange}
      />
    </section>
  );
}
