import Link from "next/link";

const legalLinks = [
  { href: "/terms", label: "이용약관" },
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/refund", label: "취소·반품·환불 정책" },
  { href: "/signup", label: "카카오 회원가입 안내" },
];

export default function BusinessFooter() {
  const customerServicePhone =
    process.env.NEXT_PUBLIC_BUSINESS_PHONE?.trim() || "0507-1494-3519";
  const customerServiceEmail =
    process.env.NEXT_PUBLIC_BUSINESS_EMAIL?.trim() || "ninety-nine@kakao.com";

  return (
    <footer className="relative border-t border-[var(--border-strong)] bg-[var(--surface)] px-4 pb-28 pt-10 text-sm text-[var(--text-muted)] sm:px-6 sm:pt-12 lg:pb-12">
      <div className="mx-auto mb-8 flex w-full max-w-7xl items-end justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <p className="text-[10px] font-bold tracking-[0.24em] text-[var(--text-muted)]">
            CURATED VINTAGE · BUSAN
          </p>
          <p className="mt-1 text-xl font-extrabold tracking-[-0.04em] text-[var(--text-strong)]">
            NINETY-NINE
          </p>
        </div>
        <span className="font-mono text-sm font-bold tabular-nums tracking-tight text-[var(--text-muted)]">
          EST. 2025
        </span>
      </div>
      <div className="mx-auto grid w-full max-w-7xl gap-7 lg:grid-cols-[1.2fr_1fr] lg:gap-12">
        <section aria-labelledby="business-information-title">
          <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
            BUSINESS INFORMATION
          </p>
          <details className="group mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)]">
            <summary className="cursor-pointer list-none rounded-lg px-4 py-3 outline-none transition-all duration-200 ease-out hover:bg-[var(--surface-muted)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] [&::-webkit-details-marker]:hidden">
              <h2
                id="business-information-title"
                className="flex w-full items-center justify-between gap-4 text-base font-extrabold tracking-[-0.025em] text-[var(--text-strong)] sm:text-lg"
              >
                <span>
                  <span className="block">나인티 나인 빈티지 사업자 정보</span>
                  <span className="mt-1 block text-[11px] font-semibold tracking-normal text-[var(--text-muted)]">
                    사업자등록번호·사업장·고객센터 확인
                  </span>
                </span>
                <span className="grid size-9 shrink-0 place-items-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-base font-bold text-[var(--text-strong)]">
                  <span className="sr-only">사업자 정보 열기 또는 닫기</span>
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-200 group-open:rotate-180"
                  >
                    ⌄
                  </span>
                </span>
              </h2>
            </summary>
            <div className="border-t border-[var(--border)] px-4 pb-4 pt-4">
              <dl className="grid gap-x-8 gap-y-2.5 text-[13px] font-semibold leading-6 sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="shrink-0 text-[var(--text-strong)]">상호</dt>
                  <dd>나인티 나인 빈티지</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-[var(--text-strong)]">대표자</dt>
                  <dd>이영준</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-[var(--text-strong)]">사업자등록번호</dt>
                  <dd className="font-mono tabular-nums tracking-tight">875-07-03297</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-[var(--text-strong)]">업태·종목</dt>
                  <dd>소매 · 옷가게</dd>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <dt className="shrink-0 text-[var(--text-strong)]">사업장</dt>
                  <dd>부산광역시 수영구 수미로50번길 37-1, 1층 (수영동)</dd>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <dt className="shrink-0 text-[var(--text-strong)]">
                    통신판매업 신고 면제 사유
                  </dt>
                  <dd>「부가가치세법」상 간이과세자</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-[var(--text-strong)]">고객센터</dt>
                  <dd>
                    <a className="font-mono tabular-nums tracking-tight underline underline-offset-4 transition-colors hover:text-[var(--text-strong)]" href={`tel:${customerServicePhone}`}>
                      {customerServicePhone}
                    </a>
                    <span className="ml-1 text-xs">(스마트콜)</span>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-[var(--text-strong)]">고객지원 이메일</dt>
                  <dd className="break-all">
                    <a className="underline decoration-[var(--border-strong)] underline-offset-4 transition-colors hover:text-[var(--text-strong)]" href={`mailto:${customerServiceEmail}`}>
                      {customerServiceEmail}
                    </a>
                  </dd>
                </div>
              </dl>
              <p className="mt-4 border-t border-[var(--border)] pt-4 text-xs font-semibold leading-6">
                고객 문의와 청약철회 신청은 로그인 후 사이트의 운영팀 1:1 상담에서도
                접수할 수 있습니다.
              </p>
            </div>
          </details>
        </section>

        <section aria-labelledby="policy-navigation-title">
          <h2
            id="policy-navigation-title"
            className="text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)]"
          >
            SERVICE &amp; POLICY
          </h2>
          <nav aria-label="서비스 정책" className="mt-4 grid gap-0 border-t border-[var(--border)] sm:grid-cols-2">
            {legalLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="border-b border-[var(--border)] py-3 font-bold text-[var(--text-strong)] transition-all duration-200 ease-out hover:pl-1 hover:text-[var(--accent-text)] sm:odd:mr-4"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="mt-5 break-keep text-xs font-semibold leading-6">
            상품별 상태, 시작 가격·현재 입찰가, 배송 및 거래 조건은 각 상품 화면과
            결제 안내에서 확인할 수 있습니다.
          </p>
          <p className="mt-5 font-mono text-[11px] font-semibold tabular-nums tracking-tight">© 2026 나인티 나인 빈티지</p>
        </section>
      </div>
    </footer>
  );
}
