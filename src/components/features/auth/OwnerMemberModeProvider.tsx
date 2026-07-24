"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Clock3, LogOut, Plus } from "lucide-react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import type { OwnerMemberModeState } from "@/lib/ownerMemberMode";

type OwnerMemberModeAction = "activate" | "extend" | "end";

interface OwnerMemberModeContextValue extends OwnerMemberModeState {
  busy: boolean;
  remainingSeconds: number;
  run: (action: OwnerMemberModeAction) => Promise<boolean>;
}

const EMPTY_STATE: OwnerMemberModeState = {
  active: false,
  eligible: false,
  expiresAt: null,
};

const OwnerMemberModeContext =
  createContext<OwnerMemberModeContextValue | null>(null);

export function useOwnerMemberMode() {
  const value = useContext(OwnerMemberModeContext);
  if (!value) {
    throw new Error(
      "useOwnerMemberMode must be used inside OwnerMemberModeProvider",
    );
  }
  return value;
}

export function OwnerMemberModeProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { loading, revision, session } = useSupabaseSession();
  const [state, setState] = useState<OwnerMemberModeState>(EMPTY_STATE);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (loading) return;
    if (!session) {
      setState(EMPTY_STATE);
      return;
    }
    const controller = new AbortController();
    void fetch("/api/owner/member-mode", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("owner-member-mode-unavailable");
        return response.json() as Promise<OwnerMemberModeState>;
      })
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState(EMPTY_STATE);
      });
    return () => controller.abort();
  }, [loading, revision, session]);

  useEffect(() => {
    if (!state.active || !state.expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state.active, state.expiresAt]);

  const remainingSeconds = state.active && state.expiresAt
    ? Math.max(
        0,
        Math.ceil((new Date(state.expiresAt).getTime() - now) / 1000),
      )
    : 0;

  useEffect(() => {
    if (state.active && remainingSeconds === 0) {
      setState((current) => ({
        ...current,
        active: false,
        expiresAt: null,
      }));
      window.location.assign("/home");
    }
  }, [remainingSeconds, state.active]);

  const run = useCallback(
    async (action: OwnerMemberModeAction) => {
      if (!session?.access_token || busy) return false;
      setBusy(true);
      try {
        const response = await fetch("/api/owner/member-mode", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action }),
        });
        const payload = await response.json().catch(() => null) as
          | (OwnerMemberModeState & { message?: string })
          | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.message ?? "임시 회원 권한을 변경하지 못했습니다.");
        }
        setNow(Date.now());
        setState(payload);
        return true;
      } catch {
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, session?.access_token],
  );

  const value = useMemo(
    () => ({ ...state, busy, remainingSeconds, run }),
    [busy, remainingSeconds, run, state],
  );

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return (
    <OwnerMemberModeContext.Provider value={value}>
      {children}
      {state.active && remainingSeconds > 0 && (
        <aside className="fixed right-3 top-3 z-[150] w-[min(22rem,calc(100vw-1.5rem))] border border-amber-300 bg-amber-50 p-3 text-amber-950 shadow-2xl sm:right-5 sm:top-5">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-xs font-black">
              <Clock3 size={15} /> 회원 권한 사용 중
            </span>
            <span
              aria-label={`남은 시간 ${minutes}분 ${seconds}초`}
              className="font-mono text-lg font-black tabular-nums"
            >
              {String(minutes).padStart(2, "0")}:
              {String(seconds).padStart(2, "0")}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-1 border border-amber-500 bg-white px-3 text-xs font-bold disabled:opacity-40"
              disabled={busy}
              onClick={() => void run("extend")}
              type="button"
            >
              <Plus size={14} /> 3분 연장
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-1 bg-amber-950 px-3 text-xs font-bold text-white disabled:opacity-40"
              disabled={busy}
              onClick={() => {
                void run("end").then((ended) => {
                  if (ended) window.location.assign("/home");
                });
              }}
              type="button"
            >
              <LogOut size={14} /> 즉시 종료
            </button>
          </div>
        </aside>
      )}
    </OwnerMemberModeContext.Provider>
  );
}
