import Link from "next/link";

const legalLinks = [
  { href: "/terms", label: "이용약관" },
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/refund", label: "취소·반품·환불 정책" },
];

export default function BusinessFooter() {
  const customerServicePhone = process.env.NEXT_PUBLIC_BUSINESS_PHONE?.trim() || "0507-1494-3519";
  const customerServiceEmail = process.env.NEXT_PUBLIC_BUSINESS_EMAIL?.trim() || "ninety-nine@kakao.com";

  return (
    <footer className="relative border-t border-[var(--border)] bg-[var(--surface-muted)] px-10 pb-12 pt-10 text-sm text-[var(--text-muted)]">
      <div className="mx-auto grid w-full max-w-[1680px] grid-cols-4 gap-12">
        <section>
          <p className="text-xs font-black tracking-[0.12em] text-[var(--text-strong)]">NINETY-NINE VINTAGE</p>
          <p className="mt-4 text-xs leading-5">시간을 다시 입는 빈티지 경매 플랫폼</p>
          <p className="mt-2 text-xs">고객센터 {customerServicePhone}</p>
          <p className="mt-1 text-xs">{customerServiceEmail}</p>
        </section>

        <section>
          <p className="text-xs font-bold tracking-[0.1em] text-[var(--text-strong)]">SERVICE</p>
          <nav aria-label="서비스 정책" className="mt-4 grid gap-2 text-xs">
            {legalLinks.map((link) => <Link key={link.href} href={link.href} className="transition-colors hover:text-[var(--text-strong)]">{link.label}</Link>)}
          </nav>
        </section>

        <section>
          <p className="text-xs font-bold tracking-[0.1em] text-[var(--text-strong)]">ACCOUNT</p>
          <nav aria-label="계정 메뉴" className="mt-4 grid gap-2 text-xs">
            <Link href="/account" className="transition-colors hover:text-[var(--text-strong)]">내 정보</Link>
            <Link href="/chat" className="transition-colors hover:text-[var(--text-strong)]">상담·채팅</Link>
            <Link href="/sold" className="transition-colors hover:text-[var(--text-strong)]">판매 완료 아카이브</Link>
          </nav>
        </section>

        <section aria-labelledby="business-information-title">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between text-left text-xs font-bold tracking-[0.1em] text-[var(--text-strong)] outline-none [&::-webkit-details-marker]:hidden">
              <span id="business-information-title">사업자 정보<span className="sr-only">사업자 정보 열기 또는 닫기</span></span>
              <span aria-hidden="true" className="text-base transition-transform duration-200 group-open:rotate-180">⌄</span>
            </summary>
            <dl className="mt-4 grid gap-1 text-xs leading-5">
              <div><dt className="inline font-bold text-[var(--text-strong)]">상호: </dt><dd className="inline">나인티 나인 빈티지</dd></div>
              <div><dt className="inline font-bold text-[var(--text-strong)]">대표: </dt><dd className="inline">이영준</dd></div>
              <div><dt className="inline font-bold text-[var(--text-strong)]">사업자등록번호: </dt><dd className="inline font-mono tabular-nums">875-07-03297</dd></div>
              <div><dt className="inline font-bold text-[var(--text-strong)]">업태/종목: </dt><dd className="inline">소매 / 옷가게</dd></div>
              <div><dt className="inline font-bold text-[var(--text-strong)]">통신판매업 신고 면제 사유: </dt><dd className="inline">「부가가치세법」상 간이과세자</dd></div>
              <div><dt className="inline font-bold text-[var(--text-strong)]">사업장: </dt><dd className="inline">부산광역시 수영구 수미로50번길 37-1, 1층</dd></div>
              <div><dt className="inline font-bold text-[var(--text-strong)]">고객센터: </dt><dd className="inline"><a className="font-mono tabular-nums underline underline-offset-4" href={`tel:${customerServicePhone}`}>{customerServicePhone}</a></dd></div>
              <div><dt className="inline font-bold text-[var(--text-strong)]">이메일: </dt><dd className="inline break-all"><a className="underline underline-offset-4" href={`mailto:${customerServiceEmail}`}>{customerServiceEmail}</a></dd></div>
            </dl>
          </details>
        </section>
      </div>
      <div className="mx-auto mt-10 w-full max-w-[1680px] border-t border-[var(--border)] pt-5 text-[10px]">© 2026 NINETY-NINE VINTAGE. ALL RIGHTS RESERVED.</div>
    </footer>
  );
}
