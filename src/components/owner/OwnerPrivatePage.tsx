"use client";

import { useEffect, useState } from "react";

import { StaffChatInbox } from "@/src/components/chat/StaffChatInbox";
import { Button, ThemeToggle } from "@/src/components/common";
import { useAuthSession } from "@/src/hooks/useAuthSession";
import {
  getOwnerModeStatus,
  lockOwnerMode,
} from "@/src/lib/ownerMode/client";
import { isOwnerRole } from "@/src/lib/supabase/auth";

type GateStatus = "loading" | "unlocked" | "denied" | "error";

function formatExpiry(value: string | null): string {
  if (!value) return "확인 필요";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function OwnerPrivatePage() {
  const auth = useAuthSession();
  const [gateStatus, setGateStatus] = useState<GateStatus>("loading");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [isLocking, setIsLocking] = useState(false);

  useEffect(() => {
    if (auth.isLoading) return;
    let active = true;
    let expiryTimer: number | undefined;

    if (!auth.user || !isOwnerRole(auth.role)) {
      const deniedTimer = window.setTimeout(() => {
        if (active) setGateStatus("denied");
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(deniedTimer);
      };
    }

    void getOwnerModeStatus()
      .then((status) => {
        if (!active) return;
        if (!status.unlocked || !status.expiresAt) {
          setGateStatus("denied");
          return;
        }

        setExpiresAt(status.expiresAt);
        setGateStatus("unlocked");
        const remaining = new Date(status.expiresAt).getTime() - Date.now();
        expiryTimer = window.setTimeout(
          () => {
            if (active) setGateStatus("denied");
          },
          Math.max(0, Math.min(remaining, 2_147_000_000)),
        );
      })
      .catch(() => {
        if (active) setGateStatus("error");
      });

    return () => {
      active = false;
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
    };
  }, [auth.isLoading, auth.role, auth.user]);

  const handleLock = async () => {
    if (isLocking) return;
    setIsLocking(true);
    try {
      await lockOwnerMode();
    } finally {
      window.location.replace("/");
    }
  };

  if (gateStatus === "loading" || auth.isLoading) {
    return <OwnerGateState message="전용 관리 세션을 확인하고 있습니다…" />;
  }

  if (
    gateStatus !== "unlocked" ||
    !auth.user ||
    !isOwnerRole(auth.role)
  ) {
    return (
      <OwnerGateState
        message={
          gateStatus === "error"
            ? "전용 페이지를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."
            : "이 페이지를 열 수 없습니다. 메인 화면에서 전용 모드를 먼저 확인해 주세요."
        }
        showHome
      />
    );
  }

  return (
    <main className="theme-app-shell min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <header className="theme-surface-glass rounded-[2rem] border p-5 backdrop-blur sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black tracking-[0.18em] text-[var(--accent-text)]">
                PRIVATE OPERATIONS CONSOLE
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--text-strong)]">
                전용 운영 페이지
              </h1>
              <p className="mt-2 max-w-2xl break-keep font-bold leading-7 text-[var(--text-muted)]">
                일반 화면에서는 언제나 운영자로 표시됩니다. 이 페이지의 전용 기능은
                짧게 만료되는 서버 세션이 확인된 동안에만 열립니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ThemeToggle />
              <Button variant="secondary" onClick={() => window.location.assign("/") }>
                일반 운영 화면
              </Button>
              <Button variant="ghost" isLoading={isLocking} onClick={() => void handleLock()}>
                전용 모드 잠그기
              </Button>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-4 sm:grid-cols-3" aria-label="전용 세션 안내">
          <OwnerSummaryCard title="공개 표시" value="운영자" />
          <OwnerSummaryCard title="전용 세션 만료" value={formatExpiry(expiresAt)} />
          <OwnerSummaryCard title="접근 방식" value="PIN · 서버 검증" />
        </section>

        <section className="mt-6">
          <div className="mb-4">
            <p className="text-xs font-black tracking-[0.16em] text-[var(--accent-text)]">
              SUPPORT REVIEW
            </p>
            <h2 className="mt-1 text-2xl font-black text-[var(--text-strong)]">
              운영자별 상담 확인
            </h2>
            <p className="mt-1 font-bold text-[var(--text-muted)]">
              운영자별 상담함은 이 전용 페이지에서만 읽기 전용으로 확인합니다.
            </p>
          </div>
          <StaffChatInbox staffId={auth.user.id} role="admin" />
        </section>
      </div>
    </main>
  );
}
function OwnerSummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <article className="theme-panel rounded-[1.5rem] border p-5">
      <p className="text-sm font-black text-[var(--text-muted)]">{title}</p>
      <p className="mt-2 text-xl font-black text-[var(--text-strong)]">{value}</p>
    </article>
  );
}

function OwnerGateState({
  message,
  showHome = false,
}: {
  message: string;
  showHome?: boolean;
}) {
  return (
    <main className="theme-app-shell grid min-h-screen place-items-center px-4 py-12">
      <section className="theme-panel w-full max-w-lg rounded-[2rem] border p-8 text-center">
        <span aria-hidden="true" className="text-3xl">◇</span>
        <p className="mt-4 break-keep text-[17px] font-bold leading-8 text-[var(--text-muted)]">
          {message}
        </p>
        {showHome ? (
          <Button className="mt-6" onClick={() => window.location.replace("/") }>
            메인 화면으로
          </Button>
        ) : null}
      </section>
    </main>
  );
}
