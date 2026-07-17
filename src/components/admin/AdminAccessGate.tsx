"use client";

import { Button } from "@/src/components/common";

interface AdminAccessGateProps {
  onSwitchToAdmin: () => void;
}

export function AdminAccessGate({ onSwitchToAdmin }: AdminAccessGateProps) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-28 pt-8 sm:px-6 sm:pt-12 lg:pb-14">
      <section className="relative overflow-hidden rounded-[2rem] border border-[#eadccd] bg-[#fffaf4] px-6 py-14 text-center shadow-[0_24px_70px_rgba(106,77,55,0.09)] sm:px-12 sm:py-20">
        <div aria-hidden="true" className="absolute -left-16 -top-16 h-44 w-44 rounded-full bg-[#e5f1f4]" />
        <div aria-hidden="true" className="absolute -bottom-20 -right-14 h-52 w-52 rounded-full bg-[#f9ddd4]" />

        <div className="relative mx-auto max-w-xl">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-[1.4rem] bg-[#f6ded5] text-3xl shadow-sm" aria-hidden="true">
            ◈
          </span>
          <p className="mt-6 text-[17px] font-black tracking-[0.16em] text-[#b96858]">ADMIN ACCESS</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-[#453a34] sm:text-3xl">
            Supabase 관리자 인증이 필요해요
          </h2>
          <p className="mx-auto mt-4 max-w-lg break-keep text-[17px] font-bold leading-8 text-[#7d6d63]">
            관리자 계정으로 로그인하면 경매글 등록, 발송 피킹과 송장 등록을
            안전하게 사용할 수 있어요. 운영자 상담은 상담 대화함에서 분리됩니다.
          </p>
          <Button size="lg" className="mt-7" onClick={onSwitchToAdmin}>
            관리자 로그인
            <span aria-hidden="true">→</span>
          </Button>
        </div>
      </section>
    </main>
  );
}
