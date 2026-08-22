"use client";

import { ChevronDown, MessageSquareText } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface Conversation { id: string; conversation_type: string; last_message_at: string | null; last_message_preview: string | null; last_sender_id: string | null; product_title_snapshot?: string | null }
interface Message { body: string; created_at: string; id: string; sender_id: string | null }
interface Attachment { id: string; messageId: string; signedUrl: string }

export function InquiryList({ revision = 0 }: { revision?: number }) {
  const { session } = useSupabaseSession();
  const token = session?.access_token;
  const userId = session?.user.id;
  const [items, setItems] = useState<Conversation[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({});
  const load = useCallback(async () => {
    if (!token) return;
    const response = await fetch("/api/chat", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = response.ok ? await response.json() as { conversations?: Conversation[] } : {};
    setItems((payload.conversations ?? []).filter((item) => item.conversation_type === "product" || Boolean(item.last_message_at)));
  }, [token]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load, revision]);

  const toggle = async (id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!token || messages[id]) return;
    const [response, attachmentResponse] = await Promise.all([
      fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      fetch(`/api/chat/attachments?conversationId=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
    ]);
    if (response.ok) { const payload = await response.json() as { messages?: Message[] }; setMessages((current) => ({ ...current, [id]: payload.messages ?? [] })); }
    if (attachmentResponse.ok) { const payload = await attachmentResponse.json() as { attachments?: Attachment[] }; setAttachments((current) => ({ ...current, [id]: payload.attachments ?? [] })); }
  };
  if (!session) return null;
  return <section className="rounded-3xl border border-line bg-paper p-5 sm:p-7"><div className="border-b border-ink pb-4"><p className="eyebrow text-muted">MY / 1:1 문의</p><h2 className="mt-2 text-2xl font-black">내 문의 내역</h2></div>
    {items.length === 0 ? <div className="grid place-items-center py-16 text-center"><MessageSquareText className="text-muted" size={34} /><p className="mt-3 text-sm font-bold">접수한 문의가 없습니다.</p></div> : <div className="divide-y divide-line">{items.map((item) => {
      const answered = item.last_sender_id !== userId;
      const thread = messages[item.id] ?? [];
      const own = thread.filter((message) => message.sender_id === userId);
      const responses = thread.filter((message) => message.sender_id !== userId);
      const threadAttachments = attachments[item.id] ?? [];
      const renderImages = (messageId: string) => { const images = threadAttachments.filter((attachment) => attachment.messageId === messageId); return images.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{images.map((image, index) => <a href={image.signedUrl} key={image.id} rel="noreferrer" target="_blank"><Image alt={`문의 첨부 이미지 ${index + 1}`} className="size-24 rounded-lg object-cover" height={96} src={image.signedUrl} unoptimized width={96} /></a>)}</div> : null; };
      return <article key={item.id}><button aria-expanded={openId === item.id} className="flex w-full items-start justify-between gap-4 py-5 text-left" onClick={() => void toggle(item.id)} type="button"><span className="min-w-0"><span className={answered ? "inline-flex rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-white" : "inline-flex rounded-full border border-amber-500 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-600"}>{answered ? "답변 완료" : "답변 대기"}</span><strong className="mt-3 block truncate text-sm">{item.product_title_snapshot ?? item.last_message_preview ?? "고객 문의"}</strong><time className="mt-1 block text-[10px] text-muted">{item.last_message_at ? new Date(item.last_message_at).toLocaleString("ko-KR") : ""}</time></span><ChevronDown className={`mt-2 shrink-0 transition-transform ${openId === item.id ? "rotate-180" : ""}`} size={17} /></button>{openId === item.id && <div className="pb-6"><div className="space-y-3">{own.map((message) => <div className="rounded-xl border border-line p-4 text-xs leading-6" key={message.id}><p className="whitespace-pre-wrap">{message.body}</p>{renderImages(message.id)}</div>)}</div>{responses.length > 0 && <div className="mt-3 rounded-xl border border-line bg-surface p-4"><p className="text-[10px] font-black tracking-[0.12em] text-muted">NINETY-NINE OFFICIAL RESPONSE</p>{responses.map((message) => <div key={message.id}><p className="mt-3 whitespace-pre-wrap text-xs leading-6">{message.body}</p>{renderImages(message.id)}</div>)}</div>}</div>}</article>;
    })}</div>}
  </section>;
}
