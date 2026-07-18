import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "카카오 회원가입 안내 | 나인티 나인 빈티지 · 다미네 구제",
  description: "카카오 회원가입 필수 수집 항목과 이용 목적 안내",
};

export default function SignupGuidePage() {
  return (
    <main className="theme-app-shell grid min-h-dvh place-items-center px-4 py-10 sm:px-6">
      <section className="theme-panel w-full max-w-2xl rounded-[2rem] border px-5 py-8 shadow-sm sm:px-10 sm:py-10">
        <p className="text-xs font-black tracking-[0.18em] text-[var(--accent-text)]">
          NINETY-NINE · DAMINE VINTAGE
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[var(--text-strong)]">
          카카오로 회원가입
        </h1>
        <p className="mt-4 break-keep font-bold leading-7 text-[var(--text-muted)]">
          카카오 계정으로 본인 확인과 회원가입을 한 번에 진행합니다. 아래 세 항목은
          회원 서비스 제공을 위한 필수 정보입니다.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            ["이름", "회원 확인·고객 상담"],
            ["성별", "상품 운영·서비스 분석"],
            ["출생연도", "연령대별 안내·이용자 보호"],
          ].map(([label, purpose]) => (
            <div
              key={label}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4"
            >
              <span className="rounded-full bg-[var(--accent-surface)] px-2.5 py-1 text-xs font-black text-[var(--accent-text)]">
                필수
              </span>
              <h2 className="mt-3 text-lg font-black text-[var(--text-strong)]">
                {label}
              </h2>
              <p className="mt-1 text-sm font-bold leading-6 text-[var(--text-muted)]">
                {purpose}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-[#ead8b4] bg-[#fff7df] px-4 py-4 text-sm font-bold leading-6 text-[#725c36]">
          이메일과 카카오계정 전화번호는 동의 요청하지 않습니다. 같은 카카오 계정의
          중복 가입은 카카오 앱별 회원번호로 차단합니다.
        </div>

        <a
          href="/api/auth/kakao/start"
          className="mt-7 inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#fee500] px-5 text-base font-black text-[#191919] shadow-sm transition hover:bg-[#f5dc00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b9a600] focus-visible:ring-offset-2"
        >
          카카오 동의 후 가입하기
        </a>
        <p className="mt-4 text-center text-sm font-bold leading-6 text-[var(--text-muted)]">
          가입을 진행하면 필수 정보 수집·이용과{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            개인정보처리방침
          </Link>
          과{" "}
          <Link href="/terms" className="underline underline-offset-2">
            이용약관
          </Link>
          을 확인한 것으로 처리됩니다.
        </p>
        <div className="mt-5 text-center">
          <Link href="/" className="text-sm font-black text-[var(--accent-text)]">
            취소하고 서비스로 돌아가기
          </Link>
        </div>
      </section>
    </main>
  );
}
