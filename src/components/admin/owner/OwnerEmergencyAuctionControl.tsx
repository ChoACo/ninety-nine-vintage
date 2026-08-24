"use client";

import {
  AlertTriangle,
  Clock3,
  PauseCircle,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Action = "pause" | "resume" | "extend_60";

interface EmergencyState {
  activeAuctionCount: number;
  paused: boolean;
  pausedAt: string | null;
  reason: string | null;
  updatedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readEmergencyState(value: unknown): EmergencyState | null {
  if (
    !isRecord(value) ||
    typeof value.paused !== "boolean" ||
    typeof value.activeAuctionCount !== "number" ||
    !Number.isSafeInteger(value.activeAuctionCount) ||
    value.activeAuctionCount < 0 ||
    (value.paused_at !== null && typeof value.paused_at !== "string") ||
    (value.reason !== null && typeof value.reason !== "string") ||
    (value.updated_at !== null && typeof value.updated_at !== "string")
  ) {
    return null;
  }
  return {
    paused: value.paused,
    activeAuctionCount: value.activeAuctionCount,
    pausedAt: value.paused_at,
    reason: value.reason,
    updatedAt: value.updated_at,
  };
}

function formatAt(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "-"
    : parsed.toLocaleString("ko-KR");
}

export function OwnerEmergencyAuctionControl() {
  const [token, setToken] = useState("");
  const [state, setState] = useState<EmergencyState | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [keyword, setKeyword] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadState = useCallback(async (accessToken: string) => {
    const response = await fetch("/api/admin/owner/auctions/emergency", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as unknown;
    const nextState = readEmergencyState(payload);
    if (!response.ok || !nextState) {
      throw new Error("비상 제어 상태를 불러오지 못했습니다.");
    }
    setState(nextState);
  }, []);

  useEffect(() => {
    let active = true;
    let intervalId: number | undefined;
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data
          .session;
        if (!active || !session) return;
        setToken(session.access_token);
        await loadState(session.access_token);
        if (!active) return;
        intervalId = window.setInterval(() => {
          void loadState(session.access_token).catch(() => {
            setNotice("자동 상태 갱신에 실패했습니다. 직접 새로고침해 주세요.");
          });
        }, 10_000);
      } catch (error) {
        if (active) {
          setNotice(
            error instanceof Error
              ? error.message
              : "비상 제어 상태를 불러오지 못했습니다.",
          );
        }
      }
    })();
    return () => {
      active = false;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [loadState]);

  const refresh = async () => {
    if (!token || refreshing) return;
    setRefreshing(true);
    try {
      await loadState(token);
      setNotice("");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "비상 제어 상태를 불러오지 못했습니다.",
      );
    } finally {
      setRefreshing(false);
    }
  };

  const run = async () => {
    if (!pending || busy || !token) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/auctions/emergency", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: pending, reason, keyword }),
      });
      const data = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const message = isRecord(data) && typeof data.message === "string"
          ? data.message
          : "비상 제어를 실행하지 못했습니다.";
        throw new Error(message);
      }
      await loadState(token);
      setPending(null);
      setKeyword("");
      setReason("");
      setNotice("전사 경매 제어 작업과 감사 기록을 완료했습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "비상 제어를 실행하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const paused = state?.paused === true;
  const activeAuctionCount = state?.activeAuctionCount ?? 0;

  return (
    <section className="rounded-2xl border border-rose-500/30 bg-zinc-950 p-5 text-zinc-100">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-black text-rose-400">
            <AlertTriangle size={15} /> Emergency control room
          </p>
          <h1 className="mt-2 text-2xl font-black">전사 경매 비상 제어</h1>
          <p className="mt-2 text-xs text-zinc-500">
            모든 센터의 신규 입찰을 DB에서 차단하며, 재개 시 중단 시간을 활성
            경매 마감에 반영합니다.
          </p>
        </div>
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-3 text-xs font-bold active:scale-[0.98] disabled:opacity-40"
          disabled={!token || refreshing}
          onClick={() => void refresh()}
          type="button"
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} size={14} />
          상태 새로고침
        </button>
      </div>

      <div aria-live="polite" className="mt-5 flex flex-wrap gap-2">
        <span className={`rounded-full border px-3 py-2 text-xs font-black ${state === null ? "border-zinc-700 text-zinc-400" : paused ? "border-rose-500/40 bg-rose-500/10 text-rose-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"}`}>
          {state === null ? "상태 확인 중" : paused ? "전사 일시정지 중" : "정상 운영 중"}
        </span>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-black text-amber-300">
          영향받는 진행 경매 {activeAuctionCount}건
        </span>
        <span className="rounded-full border border-zinc-700 px-3 py-2 text-[10px] text-zinc-400">
          10초 자동 갱신 · 최근 {formatAt(state?.updatedAt ?? null)}
        </span>
      </div>

      {state?.pausedAt && (
        <p className="mt-3 text-[11px] text-rose-300">
          일시정지 시작 {formatAt(state.pausedAt)}
          {state.reason ? ` · 사유 ${state.reason}` : ""}
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <button
          className="min-h-11 rounded-xl bg-rose-600 px-4 text-xs font-black disabled:opacity-40"
          disabled={busy || state === null || paused}
          onClick={() => setPending("pause")}
          type="button"
        >
          <PauseCircle className="mr-2 inline" size={15} />
          비상 일괄 정지
        </button>
        <button
          className="min-h-11 rounded-xl border border-emerald-500/30 px-4 text-xs font-black text-emerald-400 disabled:opacity-40"
          disabled={busy || state === null || !paused}
          onClick={() => setPending("resume")}
          type="button"
        >
          <PlayCircle className="mr-2 inline" size={15} />
          경매 재개
        </button>
        <button
          className="min-h-11 rounded-xl border border-amber-500/30 px-4 text-xs font-black text-amber-400 disabled:opacity-40"
          disabled={busy || state === null || activeAuctionCount === 0}
          onClick={() => setPending("extend_60")}
          type="button"
        >
          <Clock3 className="mr-2 inline" size={15} />
          전사 +1시간 연장
        </button>
      </div>

      {pending && (
        <div className="mt-5 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
          <p className="text-sm font-black">2단계 확인</p>
          <textarea
            className="mt-3 min-h-24 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-xs"
            onChange={(event) => setReason(event.target.value)}
            placeholder="감사 로그에 남길 필수 사유"
            value={reason}
          />
          <input
            className="mt-3 h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 font-mono text-xs"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="CONFIRM 입력"
            value={keyword}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              className="min-h-11 px-4 text-xs font-bold"
              onClick={() => setPending(null)}
              type="button"
            >
              취소
            </button>
            <button
              className="min-h-11 rounded-xl bg-rose-600 px-4 text-xs font-black disabled:opacity-40"
              disabled={busy || keyword !== "CONFIRM" || reason.trim().length < 2}
              onClick={() => void run()}
              type="button"
            >
              {busy ? "처리 중…" : "확인 후 실행"}
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p aria-live="polite" className="mt-4 text-xs text-zinc-400">
          {notice}
        </p>
      )}
    </section>
  );
}
