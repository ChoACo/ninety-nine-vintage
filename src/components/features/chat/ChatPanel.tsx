"use client";

import Link from "next/link";
import { MessageCircle, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ChatMessage { id: string; body: string; sender_id: string | null; created_at: string; }
interface ChatConversation {
  id: string;
  status: string;
  last_message_at: string | null;
  conversation_type?: string;
  product_title_snapshot?: string | null;
  subject?: string | null;
}

export function ChatPanel() {
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      setToken(session?.access_token ?? null);
      setUserId(session?.user.id ?? null);
      if (!session?.access_token) return;
      const conversationId = new URLSearchParams(window.location.search).get("conversationId");
      const endpoint = conversationId
        ? `/api/chat?conversationId=${encodeURIComponent(conversationId)}`
        : "/api/chat";
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      const payload = await response.json() as { conversation?: ChatConversation; messages?: ChatMessage[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "상담을 불러오지 못했습니다.");
      setConversation(payload.conversation ?? null);
      setMessages(payload.messages ?? []);
    } catch (error) { setNotice(error instanceof Error ? error.message : "상담을 불러오지 못했습니다."); }
  };
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, []);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim() || !token || busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ conversationId: conversation?.id, body: message, clientNonce: crypto.randomUUID() }) });
      const payload = await response.json() as { message?: ChatMessage; error?: string };
      if (!response.ok || !payload.message) throw new Error(payload.error ?? "메시지를 보내지 못했습니다.");
      setMessages((current) => [...current, payload.message as ChatMessage]);
      setMessage("");
      if (!conversation) void load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "메시지를 보내지 못했습니다."); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-[70svh] grid-cols-1 border border-line md:min-h-[620px] md:grid-cols-[240px_1fr] lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-line bg-surface p-4 md:border-b-0 md:border-r md:p-5">
        <p className="eyebrow text-muted">고객 상담 / 받은 메시지</p>
        <div className="mt-4 border border-ink bg-paper p-4 md:mt-8">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-ink text-paper">
              <MessageCircle size={16} />
            </span>
            <div>
              <p className="text-xs font-bold">나인티나인 고객 상담</p>
              <p className="mt-1 text-[10px] text-emerald-700">운영자 온라인</p>
            </div>
          </div>
          <p className="mt-4 text-[11px] leading-5 text-muted">
            상품, 입금, 보관과 배송에 대해 문의해 주세요.
          </p>
        </div>
      </aside>
      <section className="flex min-w-0 flex-col">
        <div className="border-b border-line p-4 sm:p-6">
          <p className="text-xs font-bold">
            {conversation?.conversation_type === "product"
              ? conversation.product_title_snapshot ||
                conversation.subject ||
                "상품 문의"
              : "통합 상담방"}
          </p>
          <p className="mt-2 text-[11px] text-muted">
            {conversation?.conversation_type === "product"
              ? "이 상품에 연결된 문의와 답변입니다."
              : "상품·주문 정보를 함께 보내면 더 빠르게 확인할 수 있습니다."}
          </p>
        </div>
        <div className="min-h-64 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {!token && (
            <div className="bg-surface p-4 text-xs leading-5">
              상담을 시작하려면{" "}
              <Link
                className="font-bold underline"
                href="/account/login?next=%2Fchat"
              >
                카카오 로그인
              </Link>
              이 필요합니다.
            </div>
          )}
          {token && messages.length === 0 && (
            <div className="bg-surface p-4 text-xs leading-5">
              아직 상담 메시지가 없습니다. 궁금한 상품이나 주문번호를
              남겨주세요.
            </div>
          )}
          {messages.map((item) => (
            <div
              className={`max-w-[85%] p-4 text-xs leading-5 sm:max-w-md ${item.sender_id === userId ? "ml-auto bg-ink text-paper" : "bg-surface"}`}
              key={item.id}
            >
              {item.body}
              <span className="mt-2 block text-[10px] opacity-60">
                {new Date(item.created_at).toLocaleString("ko-KR")}
              </span>
            </div>
          ))}
          {notice && <p className="text-xs text-red-700">{notice}</p>}
        </div>
        <form
          className="flex gap-2 border-t border-line p-3 sm:gap-3 sm:p-5"
          onSubmit={send}
        >
          <input
            aria-label="문의 메시지"
            className="min-w-0 flex-1 border border-line bg-paper px-3 text-xs outline-none focus:border-ink disabled:bg-surface sm:px-4"
            disabled={!token || busy}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={token ? "메시지를 입력하세요" : "로그인 후 이용할 수 있습니다"}
            value={message}
          />
          <button
            aria-label="메시지 보내기"
            className="grid size-11 shrink-0 place-items-center bg-ink text-paper disabled:opacity-40"
            disabled={!token || busy || !message.trim()}
            type="submit"
          >
            <Send size={15} />
          </button>
        </form>
      </section>
    </div>
  );
}
