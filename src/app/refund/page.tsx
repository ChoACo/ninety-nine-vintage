import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "취소·반품·환불 정책 | 나인티 나인 빈티지",
  description: "나인티 나인 빈티지의 청약철회, 반품 및 환불 기준",
};

export default function RefundPolicyPage() {
  return (
    <main className="theme-app-shell min-h-dvh px-4 py-8 sm:px-6 sm:py-12">
      <article className="theme-panel mx-auto max-w-4xl rounded-[2rem] border px-5 py-7 shadow-sm sm:px-10 sm:py-10">
        <p className="text-xs font-black tracking-[0.18em] text-[var(--accent-text)]">
          NINETY-NINE VINTAGE
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[var(--text-strong)]">
          취소·반품·환불 및 청약철회 정책
        </h1>
        <p className="mt-4 break-keep font-bold leading-7 text-[var(--text-muted)]">
          중고·빈티지 경매 상품에도 관계 법령에 따른 소비자 권리를 적용합니다.
        </p>

        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {[
            ["단순 청약철회", "계약서면 또는 상품 수령일부터 7일 이내"],
            ["설명과 다른 상품", "공급일부터 3개월 이내이면서 안 날부터 30일 이내"],
            ["환급 기한", "반환 상품 수령일부터 3영업일 이내"],
          ].map(([title, description]) => (
            <section
              key={title}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4"
            >
              <h2 className="font-black text-[var(--text-strong)]">{title}</h2>
              <p className="mt-2 break-keep text-sm font-bold leading-6 text-[var(--text-muted)]">
                {description}
              </p>
            </section>
          ))}
        </div>

        <div className="mt-8 space-y-8 break-keep font-medium leading-7 text-[var(--text-muted)]">
          <section>
            <h2 className="text-xl font-black text-[var(--text-strong)]">1. 신청 가능 기간</h2>
            <p className="mt-3">
              소비자는 계약내용에 관한 서면을 받은 날부터 7일 이내에 청약철회 또는
              계약해제를 요청할 수 있습니다. 상품 공급이 더 늦은 경우에는 상품을
              공급받거나 공급이 시작된 날부터 7일 이내에 요청할 수 있습니다.
            </p>
            <p className="mt-3">
              상품이 표시·광고와 다르거나 계약내용과 다르게 이행된 경우에는 공급받은
              날부터 3개월 이내이면서, 그 사실을 안 날 또는 알 수 있었던 날부터 30일
              이내에 요청할 수 있습니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-[var(--text-strong)]">2. 신청 방법</h2>
            <p className="mt-3">
              사이트 내 운영팀 1:1 상담, 고객센터 0507-1494-3519 또는
              ninety-nine@kakao.com으로 주문 또는 낙찰 상품과 신청 의사를 알려 주세요.
              상태 확인을 위해 사유와 사진을 요청할 수 있지만 사진 제출을 법정
              청약철회권 행사의 필수 조건으로 삼지 않습니다. 반환지는
              부산광역시 수영구 수미로50번길 37-1, 1층(수영동)이며, 발송 전에 운영팀의
              반품 접수 안내를 확인해 주세요.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-[var(--text-strong)]">3. 제한될 수 있는 경우</h2>
            <p className="mt-3">
              소비자의 책임 있는 사유로 상품이 멸실·훼손된 경우, 사용 또는 일부 소비로
              가치가 현저히 감소한 경우, 시간이 지나 재판매하기 어려울 정도로 가치가
              현저히 감소한 경우 등 관계 법령이 정한 사유가 있으면 청약철회가 제한될
              수 있습니다. 상품 확인을 위한 포장 훼손만으로는 제한하지 않습니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-[var(--text-strong)]">4. 빈티지 상품 기준</h2>
            <p className="mt-3">
              상품 화면에 구체적으로 고지된 사용감, 오염, 수선 흔적 등은 상품 상태
              판단에 반영될 수 있습니다. 다만 중고품, 단일 재고 또는 경매 상품이라는
              이유만으로 청약철회와 환불을 일률적으로 거절하지 않습니다. 고지되지 않은
              중대한 하자나 설명과 다른 상태는 회사 책임 기준으로 처리합니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-[var(--text-strong)]">5. 반환 비용과 교환</h2>
            <p className="mt-3">
              단순 변심에 따른 반환 비용은 소비자가 부담합니다. 상품이 표시·광고와
              다르거나 계약내용과 다르게 이행된 경우의 반환 비용은 회사가 부담하며,
              적법한 청약철회를 이유로 위약금이나 손해배상을 청구하지 않습니다. 단일
              빈티지 상품은 동일 상품으로 교환하기 어려울 수 있어 교환품이 없으면
              환불로 처리합니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-[var(--text-strong)]">6. 환불 처리</h2>
            <p className="mt-3">
              반환 상품을 받은 날부터 3영업일 이내에 결제대금을 환급합니다. 현재
              계좌이체 결제는 고객센터를 통해 본인 확인과 환급 수단을 확인한 뒤
              처리합니다. 향후 카드 등 전자결제수단이 활성화된 경우에는 결제사업자에게
              지체 없이 청구 정지 또는 결제 취소를 요청하며, 실제 카드사 반영 시점은
              결제사업자의 처리 일정에 따라 달라질 수 있습니다.
            </p>
          </section>

          <section className="rounded-2xl border border-[var(--info-border)] bg-[var(--info-surface)] px-4 py-4 text-[var(--info-text)]">
            <h2 className="font-black">입찰 취소와 청약철회는 다릅니다</h2>
            <p className="mt-2 text-sm font-bold leading-6">
              경매의 공정성을 위해 유효하게 제출된 입찰은 원칙적으로 임의 취소할 수
              없습니다. 그러나 낙찰 후 성립한 구매계약에 대한 법정 청약철회, 상품
              불일치 또는 회사 귀책에 따른 취소·환불 권리는 제한되지 않습니다.
            </p>
          </section>
        </div>

        <div className="mt-9 border-t border-[var(--border)] pt-6 text-sm font-bold leading-6 text-[var(--text-muted)]">
          <p>
            본 정책보다 관계 법령이 소비자에게 유리한 경우 관계 법령을 우선 적용합니다.
          </p>
          <p className="mt-2">공고일자·시행일자: 2026년 7월 18일</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/terms"
              className="rounded-xl bg-[var(--accent-surface)] px-4 py-2 text-[var(--accent-text)]"
            >
              이용약관 보기
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-[var(--text-strong)]"
            >
              서비스로 돌아가기
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
}
