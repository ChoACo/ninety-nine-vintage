"use client";

/* eslint-disable @next/next/no-img-element -- Kakao/Supabase 프로필 이미지 URL을 표시합니다. */
import type { Role } from "@/src/types/auction";
import { Button } from "@/src/components/common";

interface AccountPageProps {
  userId?: string;
  displayName?: string;
  avatarUrl?: string | null;
  email?: string | null;
  role: Role;
  onSignIn: () => void;
  onSignOut: () => void | Promise<void>;
}

const roleLabel: Record<Role, string> = {
  user: "일반 회원",
  operator: "운영자",
  admin: "관리자",
};

export function AccountPage({
  userId,
  displayName,
  avatarUrl,
  email,
  role,
  onSignIn,
  onSignOut,
}: AccountPageProps) {
  if (!userId) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-8 sm:px-6 lg:pb-12">
        <section className="rounded-[2rem] border border-[#eadbcd] bg-[#fffaf4] px-6 py-14 text-center shadow-[0_22px_60px_rgba(92,67,51,0.09)] sm:px-10">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-[1.4rem] bg-[#fee500] text-3xl" aria-hidden="true">
            K
          </span>
          <h2 className="mt-5 text-2xl font-black text-[#463a33]">내 정보를 보려면 로그인해 주세요</h2>
          <p className="mx-auto mt-3 max-w-lg break-keep text-[17px] font-bold leading-8 text-[#7a6b62]">
            일반 회원은 카카오 계정으로 가입과 로그인을 한 번에 진행할 수 있습니다.
          </p>
          <Button size="lg" className="mt-6" onClick={onSignIn}>
            카카오로 시작하기
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-8 sm:px-6 lg:pb-12">
      <section className="overflow-hidden rounded-[2rem] border border-[#eadbcd] bg-[#fffaf4] shadow-[0_22px_60px_rgba(92,67,51,0.09)]">
        <div className="bg-[linear-gradient(135deg,#f8ded3_0%,#e6f1f2_100%)] px-6 py-8 sm:px-9">
          <p className="text-sm font-black tracking-[0.14em] text-[#a85e50]">MY ACCOUNT</p>
          <div className="mt-4 flex items-center gap-4">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-16 w-16 rounded-2xl object-cover shadow-sm" />
            ) : (
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white text-2xl font-black text-[#b45d4f] shadow-sm" aria-hidden="true">
                {(displayName || "회").slice(0, 1)}
              </span>
            )}
            <div>
              <h2 className="text-2xl font-black text-[#40352f]">{displayName || "회원"}</h2>
              <span className="mt-1 inline-flex rounded-full bg-white/80 px-3 py-1 text-sm font-black text-[#5d7768]">
                {roleLabel[role]}
              </span>
            </div>
          </div>
        </div>

        <dl className="grid gap-px bg-[#eadfd5] sm:grid-cols-2">
          <div className="bg-[#fffdf9] px-6 py-5">
            <dt className="text-sm font-black text-[#8a776b]">로그인 계정</dt>
            <dd className="mt-1 break-all text-[17px] font-bold text-[#4c4039]">
              {email || (role === "user" ? "카카오 연결 계정" : "운영 계정")}
            </dd>
          </div>
          <div className="bg-[#fffdf9] px-6 py-5">
            <dt className="text-sm font-black text-[#8a776b]">회원 식별 상태</dt>
            <dd className="mt-1 text-[17px] font-bold text-[#4c4039]">Supabase 인증 완료</dd>
          </div>
        </dl>

        <div className="flex justify-end px-6 py-5 sm:px-9">
          <Button variant="ghost" onClick={() => void onSignOut()}>
            로그아웃
          </Button>
        </div>
      </section>
    </main>
  );
}
