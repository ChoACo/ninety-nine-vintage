"use client";

import { StaffChatInbox } from "@/src/components/chat/StaffChatInbox";
import { Button, ThemeToggle } from "@/src/components/common";
import { OwnerAuctionControlPanel } from "@/src/components/owner/OwnerAuctionControlPanel";
import { OwnerDelegationPanel } from "@/src/components/owner/OwnerDelegationPanel";
import { OwnerHiddenTestPanel } from "@/src/components/owner/OwnerHiddenTestPanel";
import { useAuthSession } from "@/src/hooks/useAuthSession";
import { isOwnerRole } from "@/src/lib/supabase/auth";

export function OwnerPrivatePage() {
  const auth = useAuthSession();

  if (auth.isLoading) {
    return <OwnerGateState message="운영 권한을 확인하고 있습니다…" />;
  }

  if (!auth.user || !auth.session || !isOwnerRole(auth.role)) {
    return (
      <OwnerGateState
        message="이 도구는 등록된 운영 총책임자 계정에서만 열 수 있습니다."
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
                PRIVATE TEST OPERATIONS
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--text-strong)]">
                운영 테스트 도구
              </h1>
              <p className="mt-2 max-w-2xl break-keep font-bold leading-7 text-[var(--text-muted)]">
                일반 화면에서는 언제나 운영자로 표시됩니다. 테스트 조작은 모두 실제 실행자와 대상, 사유가 감사 기록으로 남습니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ThemeToggle />
              <Button variant="secondary" onClick={() => window.location.assign("/") }>
                일반 운영 화면
              </Button>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-4 sm:grid-cols-3" aria-label="테스트 운영 안내">
          <OwnerSummaryCard title="공개 표시" value="운영자" />
          <OwnerSummaryCard title="내부 권한" value="전체 운영 권한" />
          <OwnerSummaryCard title="조작 기록" value="감사 로그 영구 보존" />
        </section>

        <section className="mt-6">
          <OwnerDelegationPanel accessToken={auth.session.access_token} />
        </section>

        <section className="mt-6">
          <OwnerHiddenTestPanel accessToken={auth.session.access_token} />
        </section>

        <section className="mt-6">
          <OwnerAuctionControlPanel />
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
