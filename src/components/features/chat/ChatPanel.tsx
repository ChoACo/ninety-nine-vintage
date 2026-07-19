"use client";

import { MessageCircle, Send } from "lucide-react";
import { useState } from "react";

export function ChatPanel() {
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  return <div className="grid min-h-[620px] border border-line lg:grid-cols-[260px_1fr]"><aside className="border-b border-line bg-surface p-5 lg:border-b-0 lg:border-r"><p className="eyebrow text-muted">SUPPORT / INBOX</p><div className="mt-8 border border-ink bg-paper p-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-ink text-paper"><MessageCircle size={16} /></span><div><p className="text-xs font-bold">NINETY-NINE SUPPORT</p><p className="mt-1 text-[10px] text-emerald-700">운영자 온라인</p></div></div><p className="mt-4 text-[11px] leading-5 text-muted">상품, 입금, 보관과 배송에 대해 문의해 주세요.</p></div></aside><section className="flex flex-col"><div className="border-b border-line p-6"><p className="text-xs font-bold">통합 상담방</p><p className="mt-2 text-[11px] text-muted">상품·주문 정보를 함께 보내면 더 빠르게 확인할 수 있습니다.</p></div><div className="flex-1 space-y-4 p-6"><div className="max-w-md bg-surface p-4 text-xs leading-5">안녕하세요. 궁금한 상품이나 주문번호를 남겨주시면 담당 운영자가 확인합니다.<span className="mt-2 block text-[10px] text-muted">NINETY-NINE · 방금 전</span></div>{sent.map((value) => <div className="ml-auto max-w-md bg-ink p-4 text-xs leading-5 text-paper" key={value}>{value}<span className="mt-2 block text-[10px] text-zinc-400">나 · 방금 전</span></div>)}</div><form className="flex gap-3 border-t border-line p-5" onSubmit={(event) => { event.preventDefault(); if (!message.trim()) return; setSent((values) => [...values, message.trim()]); setMessage(""); }}><input aria-label="문의 메시지" className="min-w-0 flex-1 border border-line bg-paper px-4 text-xs outline-none focus:border-ink" onChange={(event) => setMessage(event.target.value)} placeholder="메시지를 입력하세요" value={message} /><button aria-label="메시지 보내기" className="grid size-11 place-items-center bg-ink text-paper" type="submit"><Send size={15} /></button></form></section></div>;
}

