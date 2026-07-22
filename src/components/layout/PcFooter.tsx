"use client";

import Link from "next/link";
import { useState } from "react";
import { CacheConsentSettings } from "@/components/layout/CacheConsentBanner";
import { UiModeSwitcher } from "@/components/mobile/UiModeSwitcher";

export function PcFooter() {
  const [open, setOpen] = useState(false);
  return <footer className="border-t border-line bg-surface text-ink"><div className="mx-auto max-w-[1680px] px-10 py-10 xl:px-12"><div className="grid grid-cols-4 gap-8"><section><Link className="text-xs font-black tracking-[0.12em]" href="/home">NINETY-NINE VINTAGE</Link><p className="mt-4 text-xs leading-5 text-muted">시간을 다시 입는 빈티지 경매 플랫폼</p><p className="mt-2 text-xs text-muted">고객센터 0507-1494-3519</p><p className="mt-1 text-xs text-muted">ninety-nine@kakao.com</p></section><section><p className="text-xs font-bold tracking-[0.1em]">서비스 안내</p><div className="mt-4 grid gap-2 text-xs text-muted"><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/refund">환불·취소 정책</Link></div></section><section><p className="text-xs font-bold tracking-[0.1em]">내 계정</p><div className="mt-4 grid gap-2 text-xs text-muted"><Link href="/account">내 정보</Link><Link href="/chat">상담·채팅</Link><Link href="/sold">판매 완료 아카이브</Link></div></section><section><button className="flex w-full items-center justify-between text-left text-xs font-bold tracking-[0.1em]" onClick={() => setOpen((value) => !value)} type="button"><span>사업자 정보</span><span aria-hidden="true">{open ? "−" : "+"}</span></button>{open && <div className="mt-4 space-y-1 text-xs leading-5 text-muted"><p>상호: 나인티 나인 빈티지</p><p>대표: 이영준</p><p>사업자등록번호: 875-07-03297</p><p>업태/종목: 소매 / 의류</p><p>부산광역시 수영구 수미로50번길 37-1, 1층</p></div>}<UiModeSwitcher className="mt-5" targetMode="mobile" /></section></div><div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5"><p className="text-[10px] text-muted">© 2026 NINETY-NINE VINTAGE. 모든 권리 보유.</p><CacheConsentSettings /></div></div></footer>;
}
