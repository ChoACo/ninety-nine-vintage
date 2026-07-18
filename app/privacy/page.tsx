import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "개인정보처리방침 | 나인티 나인 빈티지",
  description: "나인티 나인 빈티지의 개인정보 수집 및 이용 방침",
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
              <tr>
                <td className="px-4 py-3 font-bold">계좌이체 안내·입금 확인 시</td>
                <td className="px-4 py-3">
                  낙찰 상품, 최종 결제금액, 계좌 안내 요청 시각, 입금 진행·확정
                  상태와 처리 시각, 입금 확정 처리자
                </td>
                <td className="px-4 py-3">계좌 안내·입금 확인 시 필수</td>
                <td className="px-4 py-3">
                  입금 확인, 중복 결제 방지, 배송 가능 상태 전환, 취소·환불 및 거래
                  분쟁 대응
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold">서비스 이용 시 자동 생성</td>
                <td className="px-4 py-3">
                  공개 닉네임, 최근 접속 시각, 상품별 입찰 시각·입찰 금액
                </td>
                <td className="px-4 py-3">서비스 이용 시</td>
                <td className="px-4 py-3">
                  현재 접속 회원 표시, 전체 입찰 기록·낙찰 결과의 투명한 공개와 조작
                  방지
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold">접속·기능 이용 시 자동 생성</td>
                <td className="px-4 py-3">
                  접속 IP, 세션·요청 식별자, 로그인·접속 시각, 브라우저·운영체제 등
                  접속 환경(User-Agent), 이용 기능과 처리 결과 기록
                </td>
                <td className="px-4 py-3">서비스 이용 시</td>
                <td className="px-4 py-3">
                  로그인 상태 유지, 장애 분석, 부정 로그인·비정상 입찰·결제 남용 방지,
                  거래 분쟁 대응
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 rounded-2xl bg-[#f7eee7] px-4 py-3 font-bold text-[#6f5b4e]">
          배송 연락처는 회원이 배송을 신청할 때 직접 입력하는 정보이며, 카카오계정
          전화번호 동의항목과는 무관합니다.
        </p>
        <p className="mt-3 rounded-2xl bg-[#f7eee7] px-4 py-3 font-bold text-[#6f5b4e]">
          현재 수동 계좌이체 단계에서 서비스는 회원의 출금 계좌번호나 입금자명을
          별도 입력받아 데이터베이스에 저장하지 않습니다. 운영자는 사업용 계좌의 실제
          입금 내역과 낙찰 금액을 확인한 뒤 결제 완료 상태만 기록합니다.
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
        동안 분리 보관한 뒤 삭제합니다. 서비스 활동 기록과 운영 총책임자·운영자·직원의
        시스템 접근·관리 기록, 로그 열람 승인·차단 조작 기록은 최소 1년 보관하고, 일반 회원의
        접속 IP와 세션·요청 식별 기록은 생성일부터 90일 보관한 뒤 안전하게 삭제합니다.
        다만 진행 중인 부정 이용 조사나 분쟁 대응에 필요한 기록은 해당 절차가 끝날
        때까지 별도로 보존할 수 있습니다. 온라인 표시는 서버가 확인한 최근 접속 시각이 75초 이내인
        경우에만 로그인 회원에게 제공하며, 운영 총책임자와 직원 계정은 표시하지
        않습니다.
      </p>
    ),
  },
  {
    title: "3. 접속·활동 기록의 접근과 동의",
    content: (
      <div className="space-y-3">
        <p>
          원본 접속 IP와 세션·요청 식별 정보는 보안 확인이 필요한 운영 총책임자만
          열람할 수 있으며 운영자와 직원의 일반 업무 화면에는 제공하지 않습니다.
          업무상 공유가 필요하면 총책임자가 목적과 범위를 먼저 승인하고, 회원 식별자와
          IP 일부를 가리거나 통계 형태로 바꾼 최소 정보만 제공합니다. 이용자 동의 또는
          법령상 근거 없이 원본 기록을 외부에 제공하지 않습니다.
        </p>
        <p>
          회원이 본인 기록을 요청하면 운영 총책임자가 요청 목적과 기간을 확인한 뒤
          승인하며, 요청 접수 시점 이전 기록의 마스킹된 결과만 최대 24시간 열람할 수
          있습니다. 다른 회원의 기록은 요청 회원과 기록 대상 회원이 서로 다른 경우
          기록 대상자의 사전 동의와 운영 총책임자의 승인이 모두 완료되어야 합니다.
          동의나 승인이 거절되면 제공하지 않고, 정보 주체가 동의 후 어느 시점이든
          철회하면 이미 확인한 내용을 회수할 수는 없지만 승인 절차 또는 이후 추가
          열람을 즉시 중단합니다. 이 경우에도 이름·회원 식별자·IP와 기기 정보는 필요한
          범위만 남기고 가립니다.
        </p>
        <p>
          운영 총책임자의 기록 열람·요청 승인·차단 등록과 변경은 오남용과 해킹 방지,
          분쟁 확인을 위한 업무에만 사용할 수 있습니다. 각 조작에는 실제 총책임자 ID,
          대상, 시각, 목적과 처리 결과가 변경할 수 없는 감사 기록으로 남으며, 운영자나
          직원에게 이 권한을 위임하지 않습니다.
        </p>
        <p>
          새로운 개인정보를 수집하거나 이용 목적·보유 기간·제공 대상을 바꿀 때에는
          적용 전에 내용을 알리고 필요한 동의를 받습니다. 필수 동의와 선택 동의를
          구분하며, 이용자는 동의를 거부할 수 있습니다. 필수 항목을 거부하면 해당 기능
          이용이 제한될 수 있지만 선택 항목 거부를 이유로 기본 서비스를 제한하지
          않습니다.
        </p>
      </div>
    ),
  },
  {
    title: "4. 개인정보의 제3자 제공",
    content: (
      <p>
        서비스는 이용자의 동의 또는 법령상 근거가 있는 경우를 제외하고 개인정보를
        제3자에게 제공하지 않습니다. 카카오에서 제공받은 정보는 이 방침에 적힌 목적
        안에서만 사용합니다.
      </p>
    ),
  },
  {
    title: "5. 개인정보 처리의 위탁",
    content: (
      <p>
        서비스 운영을 위해 Supabase에 회원 인증·데이터베이스·파일 저장 및 실시간
        통신 처리를, Vercel에 웹 애플리케이션 배포와 전송 처리를 위탁합니다. 현재
        수동 계좌이체 운영 중에는 포트원(PortOne) 결제 연동으로 회원 결제정보를
        전송하지 않습니다. 향후 PG 결제를 재활성화하면 적용 전에 결제 화면과 이
        방침을 통해 알리고, 포트원에 신용카드·간편결제·가상계좌 결제 연동과 결제상태
        확인 처리를 위탁합니다. 수탁자는 서비스 제공에 필요한 범위에서만 정보를
        처리하도록 관리합니다.
      </p>
    ),
  },
  {
    title: "6. 이용자의 권리와 행사 방법",
    content: (
      <p>
        회원은 내 정보에서 본인 정보를 확인할 수 있고, 운영팀 문의를 통해 본인과
        연결된 접속·활동 기록의 열람과 개인정보의 정정·삭제·처리정지를 요청할 수
        있습니다. 본인 확인 후 지체 없이 처리하며, 다른 이용자의 권리나 서비스 보안,
        진행 중인 부정 이용 조사에 영향을 주는 부분은 관계 법령에 따라 가림 처리하거나
        열람 범위를 제한하고 그 사유를 안내합니다. 회원 탈퇴를 하면 로그인 계정과
        연결된 회원 프로필이 삭제되며, 법령상 보관 대상은 별도로 분리됩니다.
      </p>
    ),
  },
  {
    title: "7. 파기 절차 및 방법",
    content: (
      <p>
        보유 목적이 끝난 개인정보는 복구할 수 없는 방법으로 삭제합니다. 전자 파일은
        데이터베이스와 저장소에서 안전하게 삭제하고, 출력물이 있는 경우 분쇄 또는
        소각합니다.
      </p>
    ),
  },
  {
    title: "8. 안전성 확보 조치",
    content: (
      <div className="space-y-3">
        <p>
          접근 권한 최소화, 운영 업무별 권한 분리, 데이터베이스 행 단위 접근정책,
          암호화 통신, 비밀키 서버 보관, 접속 기록 점검을 적용합니다. 카카오 액세스
          토큰은 회원 정보 동기화 직후 폐기하고 데이터베이스에 저장하지 않습니다.
        </p>
        <p>
          운영 총책임자는 비정상 접속이나 해킹 정황이 확인된 경우 세션별 접속 시각과
          IP 기록을 근거로 IP 또는 CIDR 차단 규칙을 등록할 수 있습니다. 차단 사유와
          적용 범위를 확인하고 공유 네트워크의 정상 이용자가 함께 제한되지 않도록
          최소 범위로 설정하며, 필요하면 만료일·사유를 수정하거나 차단을 해제합니다.
          생성·수정·해제 이력은 감사 기록으로 남깁니다.
        </p>
      </div>
    ),
  },
  {
    title: "9. 개인정보 보호책임 및 문의",
    content: (
      <div className="space-y-2">
        <p>개인정보 보호 담당: 나인티 나인 빈티지 운영팀</p>
        <p>
          전화: <a href="tel:0507-1494-3519" className="font-black underline underline-offset-2">0507-1494-3519</a>
          {" · "}
          이메일: <a href="mailto:ninety-nine@kakao.com" className="font-black underline underline-offset-2">ninety-nine@kakao.com</a>
        </p>
        <p>
          개인정보 관련 문의와 열람·정정·삭제 요청은 위 연락처 또는 서비스의
          <strong> 운영팀 문의</strong>를 통해 접수할 수 있습니다.
        </p>
      </div>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main className="theme-app-shell min-h-dvh px-4 py-8 sm:px-6 sm:py-12">
      <article className="theme-panel mx-auto max-w-4xl rounded-[2rem] border px-5 py-7 shadow-sm sm:px-10 sm:py-10">
        <p className="text-xs font-black tracking-[0.18em] text-[var(--accent-text)]">
          NINETY-NINE VINTAGE
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[var(--text-strong)]">
          개인정보처리방침
        </h1>
        <p className="mt-4 break-keep font-bold leading-7 text-[var(--text-muted)]">
          나인티 나인 빈티지는 이용자의 개인정보를 소중히 다루며, 필요한
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
          <p>개인정보처리자: 나인티 나인 빈티지 · 대표자 이영준</p>
          <p className="mt-1">공고일자: 2026년 7월 18일 · 시행일자: 2026년 7월 18일</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/terms"
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-[var(--text-strong)]"
            >
              이용약관
            </Link>
            <Link
              href="/refund"
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-[var(--text-strong)]"
            >
              취소·환불 정책
            </Link>
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
