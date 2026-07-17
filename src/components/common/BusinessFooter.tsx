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
            NINETY-NINE · DAMINE VINTAGE
          </p>
          <h2
            id="business-information-title"
            className="mt-2 text-lg font-black text-[var(--text-strong)]"
          >
            나인 티나인 빈티지 사업자 정보
          </h2>
          <dl className="mt-4 grid gap-x-8 gap-y-2 font-bold leading-6 sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="shrink-0 text-[var(--text-strong)]">상호</dt>
              <dd>나인 티나인 빈티지</dd>
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
          <p className="mt-5 text-xs font-bold">© 2026 나인 티나인 빈티지</p>
        </section>
      </div>
    </footer>
  );
}
