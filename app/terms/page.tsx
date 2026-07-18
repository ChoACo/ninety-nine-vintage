import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "이용약관 | 나인티 나인 빈티지",
  description: "나인티 나인 빈티지 경매 및 전자상거래 서비스 이용약관",
};

const sections = [
  {
    title: "제1조 목적과 운영자",
    content: (
      <>
        <p>
          이 약관은 나인티 나인 빈티지(이하 “회사”)가 제공하는 구제·빈티지 의류
          경매와 관련 서비스의 이용 조건, 회사와 회원의 권리·의무 및 책임사항을
          정합니다.
        </p>
        <p className="mt-3">
          회사의 상호는 나인티 나인 빈티지, 대표자는 이영준, 사업자등록번호는
          875-07-03297이며 사업장 주소는 부산광역시 수영구 수미로50번길 37-1,
          1층(수영동)입니다. 고객센터는 0507-1494-3519, 고객지원 이메일은
          ninety-nine@kakao.com입니다.
        </p>
      </>
    ),
  },
  {
    title: "제2조 회원가입과 계정 관리",
    content: (
      <p>
        회원은 카카오 로그인을 통해 가입하며 본인의 계정을 안전하게 관리해야 합니다.
        타인의 정보를 사용하거나 계정을 양도·대여해서는 안 됩니다. 회사는 부정 이용,
        경매 방해 또는 관계 법령 위반이 확인되면 사전 고지 후 이용을 제한할 수 있고,
        긴급한 피해 방지가 필요한 경우 먼저 제한한 뒤 사유를 안내할 수 있습니다.
      </p>
    ),
  },
  {
    title: "제3조 상품 정보와 빈티지 특성",
    content: (
      <p>
        회사는 상품 화면에 상품 설명, 사진, 확인된 사용감·오염·수선 흔적 등 주요
        상태, 시작 가격 또는 현재 입찰가와 거래 조건을 표시합니다. 빈티지·중고 상품은
        동일한 새 상품과 상태가 다를 수 있으므로 회원은 입찰 전에 상품 정보와 사진을
        확인해야 합니다. 표시되지 않은 중대한 하자나 설명과 다른 상태에 관한 소비자의
        법정 권리는 제한되지 않습니다.
      </p>
    ),
  },
  {
    title: "제4조 입찰, 낙찰가와 계약 성립",
    content: (
      <>
        <p>
          회원은 상품 화면에 표시된 최소 입찰 가능 금액 이상으로 입찰합니다. 경매
          마감 시점의 최고 유효 입찰가가 낙찰가가 되며, 서비스에 별도로 표시되는
          마감·확정 입찰 규칙이 함께 적용됩니다. 낙찰자가 확정되고 회사가 그 결과를
          알린 때 구매계약이 성립합니다.
        </p>
        <p className="mt-3">
          공정한 경매 운영을 위해 제출한 입찰은 원칙적으로 임의 취소할 수 없습니다.
          다만 착오 입찰, 시스템 오류 또는 관계 법령에 따른 계약 취소·청약철회 사유가
          있는 경우 운영팀에 즉시 알려야 하며, 이 조항은 소비자의 법정 권리를 제한하지
          않습니다.
        </p>
        <p className="mt-3">
          입찰 조작 여부를 누구나 확인할 수 있도록 각 상품의 입찰 기록에는 회원이
          설정한 공개 닉네임, 입찰 시각과 입찰 금액을 마스킹 없이 표시합니다. 회원은
          입찰 전에 이 공개 범위를 확인하며, 운영 화면에서도 확정된 입찰 기록을 임의로
          수정하는 기능은 제공하지 않습니다.
        </p>
      </>
    ),
  },
  {
    title: "제5조 가격과 결제",
    content: (
      <p>
        상품 가격은 상품 카드에 원화로 표시되는 시작 가격, 현재 입찰가 또는 최종
        낙찰가입니다. 회원은 결제 전에 최종 상품 금액, 배송비, 결제기한과 결제수단을
        확인할 수 있습니다. 결제수단은 결제 화면에서 제공되는 PG사의 방식을 따르며,
        결제 오류나 중복 결제가 확인되면 운영팀이 확인 후 취소 또는 환급합니다.
      </p>
    ),
  },
  {
    title: "제6조 배송",
    content: (
      <p>
        회원은 정확한 수령인, 연락처와 배송지를 입력해야 합니다. 구체적인 배송비와
        예상 공급 시기는 상품 또는 결제 안내에서 고지합니다. 천재지변, 택배사 사정
        등으로 배송이 지연되는 경우 회사는 확인 가능한 방법으로 진행 상황을 알립니다.
      </p>
    ),
  },
  {
    title: "제7조 취소·반품·환불과 청약철회",
    content: (
      <p>
        취소, 반품, 교환, 환불과 청약철회의 기간·비용·제한 사유는 관계 법령과
        <Link href="/refund" className="mx-1 font-black underline underline-offset-2">
          취소·반품·환불 정책
        </Link>
        을 따릅니다. 중고품, 단일 재고 또는 경매 상품이라는 이유만으로 법정
        청약철회권을 일률적으로 제한하지 않습니다.
      </p>
    ),
  },
  {
    title: "제8조 미성년자 이용",
    content: (
      <p>
        미성년자가 상품을 구매하려면 법정대리인의 동의를 받아야 합니다.
        법정대리인의 동의 없이 체결한 계약은 미성년자 본인 또는 법정대리인이 관계
        법령에 따라 취소할 수 있습니다.
      </p>
    ),
  },
  {
    title: "제9조 서비스의 변경과 중단",
    content: (
      <p>
        회사는 점검, 보안 대응 또는 불가항력으로 서비스를 일시 중단할 수 있으며
        가능한 경우 사전에 알립니다. 회사의 고의 또는 과실로 회원에게 손해가 발생한
        경우 관계 법령에 따라 책임을 부담합니다.
      </p>
    ),
  },
  {
    title: "제10조 개인정보와 분쟁 처리",
    content: (
      <p>
        개인정보 처리에 관한 사항은
        <Link href="/privacy" className="mx-1 font-black underline underline-offset-2">
          개인정보처리방침
        </Link>
        을 따릅니다. 회원은 사이트 내 운영팀 1:1 상담으로 불만과 분쟁 조정을 요청할
        수 있습니다. 이 약관보다 관계 법령이 소비자에게 유리한 경우에는 관계 법령을
        우선 적용합니다.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <main className="theme-app-shell min-h-dvh px-4 py-8 sm:px-6 sm:py-12">
      <article className="theme-panel mx-auto max-w-4xl rounded-[2rem] border px-5 py-7 shadow-sm sm:px-10 sm:py-10">
        <p className="text-xs font-black tracking-[0.18em] text-[var(--accent-text)]">
          NINETY-NINE · DAMINE VINTAGE
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[var(--text-strong)]">
          서비스 이용약관
        </h1>
        <p className="mt-4 break-keep font-bold leading-7 text-[var(--text-muted)]">
          상품 상태와 가격 결정 방식, 결제·배송 및 소비자 권리를 안내합니다.
        </p>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-black text-[var(--text-strong)]">
                {section.title}
              </h2>
              <div className="mt-3 break-keep font-medium leading-7 text-[var(--text-muted)]">
                {section.content}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-9 border-t border-[var(--border)] pt-6 text-sm font-bold leading-6 text-[var(--text-muted)]">
          <p>공고일자·시행일자: 2026년 7월 18일</p>
          <Link
            href="/"
            className="mt-4 inline-flex rounded-xl border border-[var(--border)] px-4 py-2 text-[var(--text-strong)]"
          >
            서비스로 돌아가기
          </Link>
        </div>
      </article>
    </main>
  );
}
