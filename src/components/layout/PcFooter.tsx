"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Mail, Phone } from "lucide-react";
import { useState } from "react";
import { CacheConsentSettings } from "@/components/layout/CacheConsentBanner";

export function PcFooter() {
  const [open, setOpen] = useState(false);
  const businessDetails = [
    ["상호", "나인티 나인 빈티지"],
    ["대표", "이영준"],
    ["사업자등록번호", "875-07-03297"],
    ["업태 / 종목", "소매 / 의류"],
    ["사업장 주소", "부산광역시 수영구 수미로50번길 37-1, 1층"],
  ] as const;
  return (
    <footer className="overflow-x-hidden border-t border-line bg-surface text-ink">
      <div className="mx-auto w-full max-w-full overflow-hidden px-5 py-12 sm:px-8 xl:max-w-[1440px] xl:px-10">
        <div className="flex w-full min-w-0 max-w-full flex-col gap-6 overflow-hidden md:grid md:grid-cols-[1.2fr_.8fr_.8fr_1.5fr] md:gap-10">
          <section className="min-w-0">
            <Link className="text-xs font-black tracking-[0.12em]" href="/home">
              NINETY-NINE VINTAGE
            </Link>
            <p className="mt-4 break-words text-xs leading-relaxed text-muted">
              시간을 다시 입는 빈티지 경매 플랫폼
            </p>
            <div className="mt-4 grid gap-2 text-xs">
              <a
                className="flex min-w-0 items-start gap-2 break-words text-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
                href="tel:050714943519"
              >
                <Phone
                  className="mt-0.5 shrink-0"
                  size={14}
                  strokeWidth={1.75}
                />{" "}
                <span className="break-words">0507-1494-3519</span>
              </a>
              <a
                className="flex min-w-0 items-start gap-2 break-words text-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
                href="mailto:ninety-nine@kakao.com"
              >
                <Mail
                  className="mt-0.5 shrink-0"
                  size={14}
                  strokeWidth={1.75}
                />{" "}
                <span className="break-words">ninety-nine@kakao.com</span>
              </a>
            </div>
          </section>
          <section className="min-w-0">
            <p className="break-keep break-words text-xs font-bold tracking-[0.1em]">
              서비스 안내
            </p>
            <div className="mt-4 grid gap-3 break-keep break-words text-xs leading-relaxed text-muted">
              <Link className="hover:text-ink" href="/terms">
                이용약관
              </Link>
              <Link className="hover:text-ink" href="/privacy">
                개인정보처리방침
              </Link>
              <Link className="hover:text-ink" href="/refund">
                환불·취소 정책
              </Link>
            </div>
          </section>
          <section className="min-w-0">
            <p className="break-keep break-words text-xs font-bold tracking-[0.1em]">
              내 계정
            </p>
            <div className="mt-4 grid gap-3 break-keep break-words text-xs leading-relaxed text-muted">
              <Link className="hover:text-ink" href="/my">
                내 정보
              </Link>
              <Link className="hover:text-ink" href="/my/orders">
                주문·배송
              </Link>
              <Link className="hover:text-ink" href="/my/vault">
                보관함
              </Link>
              <Link className="hover:text-ink" href="/chat">
                상담·채팅
              </Link>
            </div>
          </section>
          <section className="min-w-0">
            <button
              aria-controls="business-details"
              aria-expanded={open}
              className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-xl text-left text-xs font-bold tracking-[0.1em] focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-4"
              onClick={() => setOpen((value) => !value)}
              type="button"
            >
              <span className="break-keep break-words">사업자 정보</span>
              <ChevronDown
                className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                size={16}
                strokeWidth={1.75}
              />
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.dl
                  animate={{ height: "auto", opacity: 1 }}
                  className="mt-4 grid grid-cols-1 gap-x-3 gap-y-2 overflow-hidden break-keep break-words text-xs leading-relaxed text-muted sm:grid-cols-[minmax(5.5rem,7rem)_minmax(0,1fr)] sm:gap-x-4"
                  exit={{ height: 0, opacity: 0 }}
                  id="business-details"
                  initial={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: "easeOut" }}
                >
                  {businessDetails.map(([label, value]) => (
                    <div className="contents" key={label}>
                      <dt className="break-keep text-muted">{label}</dt>
                      <dd className="min-w-0 break-keep break-words text-ink">
                        {value}
                      </dd>
                    </div>
                  ))}
                </motion.dl>
              )}
            </AnimatePresence>
          </section>
        </div>
        <div className="mt-10 flex flex-col items-start gap-4 border-t border-line pt-5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <p className="pt-1 break-words text-[10px] leading-relaxed text-muted">
            © 2026 NINETY-NINE VINTAGE. 모든 권리 보유.
          </p>
          <CacheConsentSettings />
        </div>
      </div>
    </footer>
  );
}
