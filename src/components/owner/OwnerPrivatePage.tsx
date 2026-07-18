"use client";

import type { ReactNode } from "react";
import { StaffChatInbox } from "@/src/components/chat/StaffChatInbox";
import { Button, ThemeToggle } from "@/src/components/common";
import { OwnerAuctionControlPanel } from "@/src/components/owner/OwnerAuctionControlPanel";
import { OwnerDelegationPanel } from "@/src/components/owner/OwnerDelegationPanel";
import { OwnerHiddenTestPanel } from "@/src/components/owner/OwnerHiddenTestPanel";
import { OwnerSecurityAdminPanel } from "@/src/components/owner/OwnerSecurityAdminPanel";
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
                PRIVATE SECURITY OPERATIONS
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--text-strong)]">
                관리자 메뉴
              </h1>
              <p className="mt-2 max-w-2xl break-keep font-bold leading-7 text-[var(--text-muted)]">
                일반 화면에서는 언제나 운영자로 표시됩니다. 보안 로그 열람, 승인, 차단과 테스트 조작은 실제 실행자·대상·사유가 감사 기록으로 남습니다.
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
          <OwnerSummaryCard title="로그 원문" value="총책임자 전용" />
          <OwnerSummaryCard title="보안 조작" value="감사 기록 보호" />
        </section>

        <section className="mt-6">
          <OwnerSecurityAdminPanel accessToken={auth.session.access_token} />
        </section>

        <OwnerMenuSection title="운영자 권한 대행" description="승인된 운영자 계정의 업무 상태를 점검합니다.">
          <OwnerDelegationPanel accessToken={auth.session.access_token} />
        </OwnerMenuSection>

        <OwnerMenuSection title="숨김 서비스 테스터" description="일반 회원 흐름을 다른 사용자에게 노출하지 않고 검증합니다.">
          <OwnerHiddenTestPanel accessToken={auth.session.access_token} />
        </OwnerMenuSection>

        <OwnerMenuSection title="경매 안전 제어" description="테스트 목적의 즉시 마감과 가격 조정을 감사 기록과 함께 실행합니다.">
          <OwnerAuctionControlPanel />
        </OwnerMenuSection>

        <OwnerMenuSection title="운영자별 상담 확인" description="운영자별 상담함을 읽기 전용으로 점검합니다.">
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
        </OwnerMenuSection>
      </div>
    </main>
  );
}

function OwnerMenuSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <details className="theme-panel group mt-6 rounded-[1.8rem] border p-4 sm:p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-xl font-black text-[var(--text-strong)]">{title}</span>
          <span className="mt-1 block break-keep text-sm font-bold leading-6 text-[var(--text-muted)]">
            {description}
          </span>
        </span>
        <span aria-hidden="true" className="text-xl font-black text-[var(--text-muted)] transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="mt-5">{children}</div>
    </details>
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
