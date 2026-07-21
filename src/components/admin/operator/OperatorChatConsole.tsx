"use client";

import { Send } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Conversation { id: string; member_id: string; status: string; subject: string | null; last_message_at: string | null; last_message_preview: string | null; }
interface Member { id: string; display_name: string | null; }
interface ChatMessage { id: string; body: string; sender_id: string | null; created_at: string; }

function conversationStatusLabel(status: string) {
  if (status === "open") return "상담 중";
  if (status === "closed") return "상담 완료";
  if (status === "waiting") return "답변 대기";
  return status;
}

export function OperatorChatConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [staffId, setStaffId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadInbox = async (accessToken: string) => {
    const response = await fetch("/api/admin/operator/chat", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json() as { conversations?: Conversation[]; members?: Member[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "상담함을 불러오지 못했습니다.");
    setConversations(payload.conversations ?? []); setMembers(payload.members ?? []);
    setSelected((current) => current && (payload.conversations ?? []).some((item) => item.id === current) ? current : payload.conversations?.[0]?.id ?? null);
  };

  const loadMessages = async (conversationId: string, accessToken: string) => {
    const response = await fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json() as { messages?: ChatMessage[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "메시지를 불러오지 못했습니다.");
    setMessages(payload.messages ?? []);
  };

  useEffect(() => { void (async () => { try { const session = (await getSupabaseBrowserClient().auth.getSession()).data.session; setToken(session?.access_token ?? null); setStaffId(session?.user.id ?? null); if (session) await loadInbox(session.access_token); } catch (error) { setNotice(error instanceof Error ? error.message : "상담함을 불러오지 못했습니다."); } })(); }, []);
  useEffect(() => { const timer = window.setTimeout(() => { if (token && selected) void loadMessages(selected, token).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "메시지를 불러오지 못했습니다.")); else setMessages([]); }, 0); return () => window.clearTimeout(timer); }, [selected, token]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault(); if (!token || !selected || !message.trim() || busy) return;
    setBusy(true); setNotice("");
    try { const response = await fetch("/api/admin/operator/chat", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ conversationId: selected, body: message, clientNonce: crypto.randomUUID() }) }); const payload = await response.json() as { message?: ChatMessage; error?: string }; if (!response.ok || !payload.message) throw new Error(payload.error ?? "메시지를 보내지 못했습니다."); setMessages((current) => [...current, payload.message as ChatMessage]); setMessage(""); await loadInbox(token); } catch (error) { setNotice(error instanceof Error ? error.message : "메시지를 보내지 못했습니다."); } finally { setBusy(false); }
  };

  const memberName = (id: string) => members.find((member) => member.id === id)?.display_name || "회원";
  return (
    <div className="grid grid-cols-1 border border-line md:min-h-[620px] md:grid-cols-[260px_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="border-b border-line md:border-b-0 md:border-r">
        <div className="border-b border-line p-4 sm:p-5">
          <p className="eyebrow text-muted">운영자 / 상담 목록</p>
          <p className="mt-3 text-sm font-bold">담당 회원 상담</p>
        </div>
        <div className="max-h-64 divide-y divide-line overflow-y-auto md:max-h-none">
          {conversations.map((conversation) => (
            <button
              className={`block w-full p-4 text-left sm:p-5 ${selected === conversation.id ? "bg-ink text-paper" : "hover:bg-surface"}`}
              key={conversation.id}
              onClick={() => setSelected(conversation.id)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold">{memberName(conversation.member_id)}</span>
                <span className="text-[10px] opacity-60">{conversationStatusLabel(conversation.status)}</span>
              </div>
              <p className="mt-2 truncate text-[11px] opacity-70">{conversation.subject || conversation.last_message_preview || "상담"}</p>
            </button>
          ))}
          {conversations.length === 0 && <p className="p-6 text-xs text-muted">배정된 상담이 없습니다.</p>}
        </div>
      </aside>
      <section className="flex min-h-[480px] min-w-0 flex-col">
        <div className="border-b border-line p-4 sm:p-6">
          <p className="text-xs font-bold">{selected ? memberName(conversations.find((item) => item.id === selected)?.member_id ?? "") : "상담을 선택하세요"}</p>
          <p className="mt-2 text-[11px] text-muted">회원의 상품·주문 문의에 답변합니다.</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {!token && <p className="bg-surface p-4 text-xs">운영자 로그인이 필요합니다.</p>}
          {token && !selected && <p className="bg-surface p-4 text-xs">위 목록에서 상담을 선택하세요.</p>}
          {messages.map((item) => (
            <div className={`max-w-[85%] p-4 text-xs leading-5 sm:max-w-md ${item.sender_id === staffId ? "ml-auto bg-ink text-paper" : "bg-surface"}`} key={item.id}>
              {item.body}
              <span className="mt-2 block text-[10px] opacity-60">{new Date(item.created_at).toLocaleString("ko-KR")}</span>
            </div>
          ))}
          {notice && <p className="text-xs text-red-700">{notice}</p>}
        </div>
        <form className="flex gap-2 border-t border-line p-3 sm:gap-3 sm:p-5" onSubmit={send}>
          <input aria-label="회원 답변" className="min-w-0 flex-1 border border-line bg-paper px-3 text-xs outline-none focus:border-ink disabled:bg-surface sm:px-4" disabled={!token || !selected || busy} onChange={(event) => setMessage(event.target.value)} placeholder="답변을 입력하세요" value={message} />
          <button aria-label="답변 보내기" className="grid size-11 shrink-0 place-items-center bg-ink text-paper disabled:opacity-40" disabled={!token || !selected || busy || !message.trim()} type="submit"><Send size={15} /></button>
        </form>
      </section>
    </div>
  );
}
