"use client";

import { Button } from "@/src/components/common";

interface AdminAccessGateProps {
  onSwitchToStaff: () => void;
}

export function AdminAccessGate({ onSwitchToStaff }: AdminAccessGateProps) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-28 pt-8 sm:px-6 sm:pt-12 lg:pb-14">
      <section className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-6 py-14 text-center shadow-[var(--panel-shadow)] sm:px-12 sm:py-16">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-[var(--accent)]" />

        <div className="relative mx-auto max-w-xl">
          <span className="mx-auto grid size-11 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)] shadow-sm" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" /></svg>
          </span>
          <p className="mt-5 text-[10px] font-black tracking-[0.18em] text-[var(--accent-text)]">OPERATIONS ACCESS</p>
          <h2 className="mt-1.5 text-2xl font-black tracking-[-0.04em] text-[var(--text-strong)] sm:text-3xl">
            운영 스태프 인증이 필요해요
          </h2>
          <p className="mx-auto mt-3 max-w-lg break-keep text-sm font-semibold leading-6 text-[var(--text-muted)]">
            등록된 운영 스태프 계정으로 로그인하면 역할에 허용된 회원·상품·배송
            업무를 실제 서버 데이터로 안전하게 처리할 수 있어요.
          </p>
          <Button size="lg" className="mt-7" onClick={onSwitchToStaff}>
            운영 스태프 로그인
            <span aria-hidden="true">→</span>
          </Button>
        </div>
      </section>
    </main>
  );
}
