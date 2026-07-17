import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "개인정보처리방침 | 나인티나인 빈티지 · 다미네 구제",
  description: "나인티나인 빈티지(다미네 구제)의 개인정보 수집 및 이용 방침",
};

const policySections = [
  {
    title: "1. 수집하는 개인정보와 이용 목적",
    content: (
      <>
        <p>
          서비스는 필요한 범위에서만 개인정보를 처리합니다. 카카오 로그인으로
          가입할 때 아래 항목을 필수로 제공받으며, 이메일과 카카오계정 전화번호는
          요청하거나 저장하지 않습니다.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-[#e4d6ca] text-left text-sm">
            <thead className="bg-[#f5e9df] text-[#55453b]">
              <tr>
                <th className="px-4 py-3 font-black">구분</th>
                <th className="px-4 py-3 font-black">항목</th>
                <th className="px-4 py-3 font-black">필수 여부</th>
                <th className="px-4 py-3 font-black">이용 목적</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eee3da] bg-white/80">
              <tr>
                <td className="px-4 py-3 font-bold">카카오 로그인</td>
                <td className="px-4 py-3">카카오 앱별 회원번호</td>
                <td className="px-4 py-3 font-black">필수</td>
                <td className="px-4 py-3">로그인, 회원 식별, 중복 가입 방지</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold">카카오 로그인</td>
                <td className="px-4 py-3">이름</td>
                <td className="px-4 py-3 font-black">필수</td>
                <td className="px-4 py-3">회원 확인, 고객 상담, 거래 분쟁 대응</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold">카카오 로그인</td>
                <td className="px-4 py-3">성별</td>
                <td className="px-4 py-3 font-black">필수</td>
                <td className="px-4 py-3">성별 기준 상품 운영 및 회원 서비스 분석</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold">카카오 로그인</td>
                <td className="px-4 py-3">출생연도</td>
                <td className="px-4 py-3 font-black">필수</td>
                <td className="px-4 py-3">연령대별 경매 안내와 이용자 보호</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold">배송 신청 시 직접 입력</td>
                <td className="px-4 py-3">수령인, 배송 연락처, 배송지</td>
                <td className="px-4 py-3">배송 신청 시 필수</td>
                <td className="px-4 py-3">낙찰 상품 배송과 배송 문의 처리</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 rounded-2xl bg-[#f7eee7] px-4 py-3 font-bold text-[#6f5b4e]">
          배송 연락처는 회원이 배송을 신청할 때 직접 입력하는 정보이며, 카카오계정
          전화번호 동의항목과는 무관합니다.
        </p>
      </>
    ),
  },
  {
    title: "2. 보유 및 이용 기간",
    content: (
      <p>
        회원 정보는 회원 탈퇴 시까지 보유하고 지체 없이 삭제합니다. 다만 전자상거래
        등 관계 법령에서 일정 기간 보관을 요구하는 거래·분쟁 기록은 해당 법정 기간
        동안 분리 보관한 뒤 삭제합니다.
      </p>
    ),
  },
  {
    title: "3. 개인정보의 제3자 제공",
    content: (
      <p>
        서비스는 이용자의 동의 또는 법령상 근거가 있는 경우를 제외하고 개인정보를
        제3자에게 제공하지 않습니다. 카카오에서 제공받은 정보는 이 방침에 적힌 목적
        안에서만 사용합니다.
      </p>
    ),
  },
  {
    title: "4. 개인정보 처리의 위탁",
    content: (
      <p>
        서비스 운영을 위해 Supabase에 회원 인증·데이터베이스·파일 저장 및 실시간
        통신 처리를, Vercel에 웹 애플리케이션 배포와 전송 처리를 위탁합니다. 수탁자는
        서비스 제공에 필요한 범위에서만 정보를 처리하도록 관리합니다.
      </p>
    ),
  },
  {
    title: "5. 이용자의 권리와 행사 방법",
    content: (
      <p>
        회원은 내 정보에서 본인 정보를 확인할 수 있고, 운영팀 문의를 통해 정정·삭제·
        처리정지를 요청할 수 있습니다. 회원 탈퇴를 하면 로그인 계정과 연결된 회원
        프로필이 삭제되며, 법령상 보관 대상은 별도로 분리됩니다.
      </p>
    ),
  },
  {
    title: "6. 파기 절차 및 방법",
    content: (
      <p>
        보유 목적이 끝난 개인정보는 복구할 수 없는 방법으로 삭제합니다. 전자 파일은
        데이터베이스와 저장소에서 안전하게 삭제하고, 출력물이 있는 경우 분쇄 또는
        소각합니다.
      </p>
    ),
  },
  {
    title: "7. 안전성 확보 조치",
    content: (
      <p>
        접근 권한 최소화, 관리자·운영자 권한 분리, 데이터베이스 행 단위 접근정책,
        암호화 통신, 비밀키 서버 보관, 접속 기록 점검을 적용합니다. 카카오 액세스
        토큰은 회원 정보 동기화 직후 폐기하고 데이터베이스에 저장하지 않습니다.
      </p>
    ),
  },
  {
    title: "8. 개인정보 보호책임 및 문의",
    content: (
      <p>
        개인정보 보호 담당: 나인티나인 빈티지 운영팀. 개인정보 관련 문의,
        열람·정정·삭제 요청은 서비스의 <strong>운영팀 문의</strong>를 통해 접수할 수
        있습니다.
      </p>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main className="theme-app-shell min-h-dvh px-4 py-8 sm:px-6 sm:py-12">
      <article className="theme-panel mx-auto max-w-4xl rounded-[2rem] border px-5 py-7 shadow-sm sm:px-10 sm:py-10">
        <p className="text-xs font-black tracking-[0.18em] text-[var(--accent-text)]">
          NINETY-NINE · DAMINE VINTAGE
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[var(--text-strong)]">
          개인정보처리방침
        </h1>
        <p className="mt-4 break-keep font-bold leading-7 text-[var(--text-muted)]">
          나인티나인 빈티지(다미네 구제)는 이용자의 개인정보를 소중히 다루며, 필요한
          정보만 투명하게 처리합니다.
        </p>
        <div className="mt-7 space-y-7">
          {policySections.map((section) => (
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
        <div className="mt-8 border-t border-[var(--border)] pt-6 text-sm font-bold leading-6 text-[var(--text-muted)]">
          <p>공고일자: 2026년 7월 17일 · 시행일자: 2026년 7월 17일</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-xl bg-[var(--accent-surface)] px-4 py-2 text-[var(--accent-text)]"
            >
              카카오 회원가입 안내
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
