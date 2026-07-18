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
    <footer className="relative border-t border-[var(--border)] bg-[var(--surface-muted)] px-4 pb-28 pt-8 text-sm text-[var(--text-muted)] sm:px-6 lg:pb-10">
      <div className="mx-auto grid w-full max-w-7xl gap-7 lg:grid-cols-[1.2fr_1fr] lg:gap-12">
        <section aria-labelledby="business-information-title">
          <p className="text-xs font-black tracking-[0.16em] text-[var(--accent-text)]">
            NINETY-NINE VINTAGE
          </p>
          <details className="group mt-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <summary className="cursor-pointer list-none rounded-2xl px-4 py-3 outline-none transition hover:bg-[var(--surface-raised)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-muted)] [&::-webkit-details-marker]:hidden">
              <h2
                id="business-information-title"
                className="flex w-full items-center justify-between gap-4 text-lg font-black text-[var(--text-strong)]"
              >
                <span>
                  <span className="block">나인티 나인 빈티지 사업자 정보</span>
                  <span className="mt-1 block text-xs font-bold text-[var(--text-muted)]">
                    사업자등록번호·사업장·고객센터 확인
                  </span>
                </span>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] text-lg font-black text-[var(--text-strong)]">
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
            <div className="border-t border-[var(--border)] px-4 pb-4 pt-3">
              <dl className="grid gap-x-8 gap-y-2 font-bold leading-6 sm:grid-cols-2">
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
                  <dd className="tabular-nums">875-07-03297</dd>
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
                    <a className="underline underline-offset-2" href={`tel:${customerServicePhone}`}>
                      {customerServicePhone}
                    </a>
                    <span className="ml-1 text-xs">(스마트콜)</span>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-[var(--text-strong)]">고객지원 이메일</dt>
                  <dd className="break-all">
                    <a className="underline underline-offset-2" href={`mailto:${customerServiceEmail}`}>
                      {customerServiceEmail}
                    </a>
                  </dd>
                </div>
              </dl>
              <p className="mt-4 font-bold leading-6">
                고객 문의와 청약철회 신청은 로그인 후 사이트의 운영팀 1:1 상담에서도
                접수할 수 있습니다.
              </p>
            </div>
          </details>
        </section>

        <section aria-labelledby="policy-navigation-title">
          <h2
            id="policy-navigation-title"
            className="text-base font-black text-[var(--text-strong)]"
          >
            서비스 정책
          </h2>
          <nav aria-label="서비스 정책" className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
            {legalLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="font-black text-[var(--text-strong)] underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--accent-text)]"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="mt-5 break-keep font-bold leading-6">
            상품별 상태, 시작 가격·현재 입찰가, 배송 및 거래 조건은 각 상품 화면과
            결제 안내에서 확인할 수 있습니다.
          </p>
          <p className="mt-5 text-xs font-bold">© 2026 나인티 나인 빈티지</p>
        </section>
      </div>
    </footer>
  );
}
