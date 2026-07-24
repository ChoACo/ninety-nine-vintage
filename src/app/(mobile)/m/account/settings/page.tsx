import type { Metadata } from "next";
import Link from "next/link";
import { NicknameSettings } from "@/components/account/NicknameSettings";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { AuthStatus } from "@/components/layout/AuthStatus";
import { CacheConsentSettings } from "@/components/layout/CacheConsentBanner";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { MobilePwaControls } from "@/components/features/pwa/MobilePwaControls";

export const metadata: Metadata = { title: "설정", robots: { follow: false, index: false } };

export default function MobileSettingsPage() {
  return <MemberAccountBoundary basePath="/m" returnTo="/m/account/settings"><div><header className="border-b border-ink pb-5"><p className="eyebrow text-muted">내 정보 / 설정</p><h1 className="mt-3 text-3xl font-black tracking-[-.08em]">간편 설정</h1></header><div className="mt-5"><NicknameSettings /></div><div className="mt-5 divide-y divide-line border-y border-line"><section className="py-5"><h2 className="text-sm font-black">앱·알림</h2><p className="mt-2 text-xs leading-5 text-muted">모바일 홈 화면에 앱을 설치하고 새 소식을 받습니다.</p><div className="mt-4"><MobilePwaControls detailed /></div></section><section className="py-5"><h2 className="text-sm font-black">화면</h2><p className="mt-2 text-xs leading-5 text-muted">색상 테마를 변경합니다.</p><div className="mt-4"><ThemeToggle className="w-full" showLabel /></div></section><section className="py-5"><h2 className="text-sm font-black">로그인·계정</h2><div className="mt-4"><AuthStatus basePath="/m" /></div></section><section className="py-5"><h2 className="text-sm font-black">저장 공간</h2><p className="mt-2 text-xs leading-5 text-muted">공개 상품 이미지 캐시 동의를 다시 설정할 수 있습니다.</p><div className="mt-4"><CacheConsentSettings /></div></section><section className="grid gap-3 py-5 text-xs font-bold"><Link href="/m/privacy">개인정보처리방침</Link><Link href="/m/terms">이용약관</Link><Link href="/m/refund">환불·취소 정책</Link></section></div></div></MemberAccountBoundary>;
}
