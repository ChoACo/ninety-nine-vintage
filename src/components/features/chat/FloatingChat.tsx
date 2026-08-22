"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Clock3, MessageCircle, Send, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const FAQS = ["보관함 이용 방법", "묶음 배송 기준", "경매 취소 규정"] as const;

function isBusinessHours(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short", hour: "2-digit", hour12: false }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return weekday !== "Sat" && weekday !== "Sun" && hour >= 10 && hour < 18;
}

export function FloatingChat({ basePath = "" }: { basePath?: "" | "/m" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, []);
  const available = useMemo(() => now ? isBusinessHours(now) : true, [now]);
  if (/^\/(?:m\/)?(?:chat|admin)(?:\/|$)/u.test(pathname)) return null;
  const chatHref = `${basePath}/chat${draft.trim() ? `?draft=${encodeURIComponent(draft.trim())}` : ""}`;
  return <>
    <AnimatePresence>
      {open && <motion.aside animate={{ opacity: 1, scale: 1, y: 0 }} aria-label="실시간 상담" className="fixed bottom-36 right-4 z-[120] w-[min(23rem,calc(100vw-2rem))] origin-bottom-right overflow-hidden rounded-3xl border border-line bg-paper text-ink shadow-2xl sm:bottom-24 sm:right-6" exit={{ opacity: 0, scale: 0.94, y: 12 }} initial={{ opacity: 0, scale: 0.94, y: 12 }} transition={{ duration: 0.22, ease: "easeOut" }}>
        <header className="flex items-start justify-between bg-ink p-5 text-paper"><div><p className="text-[10px] font-bold tracking-[0.14em] opacity-60">NINETY-NINE SUPPORT</p><h2 className="mt-2 text-lg font-black">무엇을 도와드릴까요?</h2></div><button aria-label="상담창 닫기" className="grid size-9 place-items-center rounded-xl hover:bg-white/10" onClick={() => setOpen(false)} type="button"><X size={18} /></button></header>
        <div className="p-5">
          <p className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-xs font-bold ${available ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}><Clock3 size={14} />{available ? "상담 운영 중 · 평일 10:00–18:00" : "운영 시간 외 접수 중 (순차 답변)"}</p>
          <p className="mt-5 text-[11px] font-bold text-muted">빠른 도움말</p>
          <div className="mt-2 flex flex-wrap gap-2">{FAQS.map((faq) => <button className="rounded-full border border-line bg-surface px-3 py-2 text-[10px] font-bold hover:border-ink" key={faq} onClick={() => setDraft(faq)} type="button">{faq}</button>)}</div>
          <label className="mt-5 block text-[11px] font-bold">문의 내용<textarea className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-line bg-paper p-3 text-xs font-normal outline-none focus:border-ink focus:ring-2 focus:ring-ink/10" maxLength={500} onChange={(event) => { setDraft(event.target.value); event.currentTarget.style.height = "auto"; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`; }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && draft.trim()) { event.preventDefault(); window.location.assign(chatHref); } }} placeholder="문의 내용을 미리 적어주세요. Enter로 상담 화면으로 이동합니다." value={draft} /></label>
          <Link className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-xs font-bold text-paper" href={chatHref}><Send size={14} /> 1:1 상담 시작</Link>
          <p className="mt-3 text-[10px] leading-4 text-muted">메시지는 매장을 선택한 뒤 전송되며, 상담방 접근 권한은 서버에서 다시 확인합니다.</p>
        </div>
      </motion.aside>}
    </AnimatePresence>
    <motion.button animate={{ rotate: open ? 90 : 0, scale: open ? 0.96 : 1 }} aria-expanded={open} aria-haspopup="dialog" aria-label={open ? "실시간 상담 닫기" : "실시간 상담 열기"} className="fixed bottom-20 right-4 z-[121] grid size-14 place-items-center rounded-full bg-ink text-paper shadow-xl shadow-black/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 sm:bottom-6 sm:right-6" onClick={() => setOpen((current) => !current)} transition={{ duration: 0.22, ease: "easeOut" }} type="button">{open ? <X size={21} /> : <MessageCircle size={22} />}</motion.button>
  </>;
}
