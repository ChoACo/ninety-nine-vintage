import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { SimpleModeToggle } from "@/components/features/accessibility/SimpleModeToggle";
import { MobilePwaControls } from "@/components/features/pwa/MobilePwaControls";
import { CacheConsentSettings } from "@/components/layout/CacheConsentBanner";

export function SiteSettingsPage({ surface }: { surface: "desktop" | "mobile" }) {
  const basePath = surface === "mobile" ? "/m" : "";
  const headingClass = surface === "mobile"
    ? "mt-3 text-3xl font-black tracking-[-.08em]"
    : "mt-3 text-4xl font-black tracking-[-.08em]";

  return (
    <div className={surface === "desktop" ? "mx-auto max-w-3xl" : undefined}>
      <header className="border-b border-ink pb-5">
        <p className="eyebrow text-muted">사이트 설정</p>
        <h1 className={headingClass}>설정</h1>
        <p className="mt-3 text-sm leading-6 text-muted">알림과 기기에 저장되는 공개 캐시를 관리합니다.</p>
      </header>
      <div className="mt-5 divide-y divide-line border-y border-line">
        <section className="py-5">
          <h2 className="text-sm font-black">이용 모드</h2>
          <p className="mt-2 text-xs leading-5 text-muted">큰 글자와 큰 버튼으로 쇼핑 핵심 메뉴만 표시합니다.</p>
          <div className="mt-4 max-w-md"><SimpleModeToggle detailed /></div>
        </section>
        {surface === "mobile" && (
          <section className="py-5">
            <h2 className="text-sm font-black">앱·알림</h2>
            <p className="mt-2 text-xs leading-5 text-muted">모바일 상태창에서 결제·입찰·배송 알림을 받습니다.</p>
            <div className="mt-4 max-w-md"><MobilePwaControls detailed /></div>
          </section>
        )}
        <section className="py-5">
          <h2 className="text-sm font-black">캐시 관리</h2>
          <p className="mt-2 text-xs leading-5 text-muted">공개 상품 이미지와 정적 리소스의 기기 저장 동의를 다시 설정합니다.</p>
          <div className="mt-4"><CacheConsentSettings /></div>
        </section>
        <details className="group py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between py-5 text-sm font-black">
            <span>서비스 안내 · 고객센터 · 사업자 정보</span>
            <ChevronDown className="shrink-0 transition-transform group-open:rotate-180" size={18} />
          </summary>
          <div className="grid gap-6 border-t border-line py-5 sm:grid-cols-3">
            <section>
              <h2 className="text-sm font-black">서비스 안내</h2>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold">
                <Link href={`${basePath}/notices`}>공지사항 · 이용 가이드</Link>
                <Link href={`${basePath}/privacy`}>개인정보처리방침</Link>
                <Link href={`${basePath}/terms`}>이용약관</Link>
                <Link href={`${basePath}/refund`}>환불·취소 정책</Link>
              </div>
            </section>
            <section>
              <h2 className="text-sm font-black">고객센터</h2>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs leading-5 text-muted">
                <p>전화 0507-1494-3519</p>
                <p>이메일 ninety-nine@kakao.com</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold">
                <Link href={`${basePath}/account`}>내 정보</Link>
                <Link href={`${basePath}/chat`}>상담·채팅</Link>
              </div>
            </section>
            <section>
              <h2 className="text-sm font-black">사업자 정보</h2>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs leading-5 text-muted">
                <p>상호: 나인티 나인 빈티지</p>
                <p>대표: 이영준</p>
                <p>사업자등록번호: 875-07-03297</p>
                <p>업태/종목: 소매 / 의류</p>
                <p>부산광역시 수영구 수미로50번길 37-1, 1층</p>
              </div>
            </section>
          </div>
          <p className="border-t border-line py-4 text-[10px] text-muted">© 2026 NINETY-NINE VINTAGE. 모든 권리 보유.</p>
        </details>
      </div>
    </div>
  );
}
