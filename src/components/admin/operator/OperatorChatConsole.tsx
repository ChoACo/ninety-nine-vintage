"use client";

import { MessageCircle, Send, Store } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Conversation {
  id: string;
  member_id: string;
  store_id: string | null;
  conversation_type: "general" | "product" | "internal";
  status: string;
  subject: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
}

interface Member {
  id: string;
  display_name: string | null;
}

interface SupportStore {
  id: string;
  name: string;
  slug: string;
}

interface ChatMessage {
  id: string;
  body: string;
  sender_id: string | null;
  created_at: string;
  product_id: string | null;
  product_title_snapshot: string | null;
  product_image_url_snapshot: string | null;
}

const CANNED_RESPONSES = [
  "안녕하세요. 문의하신 내용을 확인하고 있습니다. 잠시만 기다려 주세요.",
  "보관 상품은 보관함에서 선택한 뒤 묶음 배송을 요청할 수 있습니다.",
  "결제 확인 후 상품 준비 상태로 순차 변경되며 변경 시 알림을 보내드립니다.",
] as const;

function conversationStatusLabel(status: string) {
  return status === "closed" ? "상담 완료" : "상담 중";
}

function problemMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const problem = payload as { error?: string; message?: string };
  return problem.message ?? problem.error ?? fallback;
}

export function OperatorChatConsole({
  basePath = "/admin/operator/chat",
  staffLabel = "운영자",
  conversationType = "all",
}: Readonly<{
  basePath?: "/admin/operator/chat" | "/admin/operator/inquiries" | "/admin/employee/inquiries";
  staffLabel?: string;
  conversationType?: "all" | "product";
}>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [stores, setStores] = useState<SupportStore[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [staffId, setStaffId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [inquiryQuery, setInquiryQuery] = useState("");

  const markRead = useCallback(
    async (conversationId: string, accessToken: string) => {
      await fetch("/api/chat/read", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ conversationId }),
      });
      window.dispatchEvent(new Event("ninety-nine:chat-read"));
    },
    [],
  );

  const loadMessages = useCallback(
    async (conversationId: string, accessToken: string) => {
      const response = await fetch(
        `/api/admin/operator/chat?conversationId=${encodeURIComponent(
          conversationId,
        )}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        messages?: ChatMessage[];
      } | null;
      if (!response.ok || !payload) {
        throw new Error(problemMessage(payload, "메시지를 불러오지 못했습니다."));
      }
      setMessages(payload.messages ?? []);
      await markRead(conversationId, accessToken);
    },
    [markRead],
  );

  const loadInbox = useCallback(
    async (accessToken: string, preferredId?: string | null) => {
      const typeQuery =
        conversationType === "product" ? "?type=product" : "";
      const response = await fetch(`/api/admin/operator/chat${typeQuery}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        conversations?: Conversation[];
        members?: Member[];
        stores?: SupportStore[];
      } | null;
      if (!response.ok || !payload) {
        throw new Error(problemMessage(payload, "상담함을 불러오지 못했습니다."));
      }
      const nextConversations = payload.conversations ?? [];
      setConversations(nextConversations);
      setMembers(payload.members ?? []);
      setStores(payload.stores ?? []);
      setSelected((current) => {
        const candidate = preferredId ?? current;
        return candidate &&
          nextConversations.some((item) => item.id === candidate)
          ? candidate
          : nextConversations[0]?.id ?? null;
      });
    },
    [conversationType],
  );

  const ensureRequestedConversation = useCallback(
    async (accessToken: string) => {
      const memberId = searchParams.get("memberId");
      const storeId = searchParams.get("storeId");
      const requestedConversationId = searchParams.get("conversationId");
      if (memberId && storeId) {
        const response = await fetch("/api/admin/operator/chat", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "ensure",
            memberId,
            storeId,
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          conversation?: Conversation;
        } | null;
        if (!response.ok || !payload?.conversation) {
          throw new Error(
            problemMessage(payload, "회원 채팅방을 만들지 못했습니다."),
          );
        }
        await loadInbox(accessToken, payload.conversation.id);
        router.replace(
          `${basePath}?conversationId=${encodeURIComponent(
            payload.conversation.id,
          )}`,
          { scroll: false },
        );
        return;
      }
      await loadInbox(accessToken, requestedConversationId);
    },
    [basePath, loadInbox, router, searchParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const session = (
            await getSupabaseBrowserClient().auth.getSession()
          ).data.session;
          setToken(session?.access_token ?? null);
          setStaffId(session?.user.id ?? null);
          if (session) {
            await ensureRequestedConversation(session.access_token);
          }
        } catch (error) {
          setNotice(
            error instanceof Error
              ? error.message
              : "상담함을 불러오지 못했습니다.",
          );
        }
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ensureRequestedConversation]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (token && selected) {
        void loadMessages(selected, token).catch((error: unknown) =>
          setNotice(
            error instanceof Error
              ? error.message
              : "메시지를 불러오지 못했습니다.",
          ),
        );
      } else {
        setMessages([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMessages, selected, token]);

  useEffect(() => {
    const reload = () => {
      if (!token) return;
      void loadInbox(token, selected).catch(() => undefined);
      if (selected) {
        void loadMessages(selected, token).catch(() => undefined);
      }
    };
    window.addEventListener("ninety-nine:chat-message", reload);
    return () => window.removeEventListener("ninety-nine:chat-message", reload);
  }, [loadInbox, loadMessages, selected, token]);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !selected || !message.trim() || busy) return;
    const draft = message.trim();
    const optimisticId = `optimistic:${crypto.randomUUID()}`;
    const optimisticMessage: ChatMessage = { id: optimisticId, body: draft, sender_id: staffId, created_at: new Date().toISOString(), product_id: null, product_title_snapshot: null, product_image_url_snapshot: null };
    setBusy(true);
    setNotice("");
    setMessages((current) => [...current, optimisticMessage]);
    setMessage("");
    try {
      const response = await fetch("/api/admin/operator/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversationId: selected,
          body: draft,
          clientNonce: crypto.randomUUID(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: ChatMessage;
      } | null;
      if (!response.ok || !payload?.message) {
        throw new Error(problemMessage(payload, "메시지를 보내지 못했습니다."));
      }
      setMessages((current) => current.map((item) => item.id === optimisticId ? payload.message as ChatMessage : item));
      await loadInbox(token, selected);
    } catch (error) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setMessage(draft);
      setNotice(
        error instanceof Error ? error.message : "메시지를 보내지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const memberName = useCallback(
    (id: string) =>
      members.find((member) => member.id === id)?.display_name || "회원",
    [members],
  );
  const storeName = useCallback(
    (id: string | null) =>
      stores.find((store) => store.id === id)?.name || "매장",
    [stores],
  );
  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selected) ?? null,
    [conversations, selected],
  );
  const visibleConversations = useMemo(() => conversations
    .filter((item) => {
      const query = inquiryQuery.trim().toLocaleLowerCase("ko-KR");
      if (!query) return true;
      return [item.subject, item.last_message_preview, memberName(item.member_id)].some((value) => value?.toLocaleLowerCase("ko-KR").includes(query));
    })
    .toSorted((left, right) => Number(left.status === "closed") - Number(right.status === "closed") || String(right.last_message_at).localeCompare(String(left.last_message_at))), [conversations, inquiryQuery, memberName]);

  const selectConversation = (conversationId: string) => {
    setSelected(conversationId);
    router.replace(
      `${basePath}?conversationId=${encodeURIComponent(
        conversationId,
      )}`,
      { scroll: false },
    );
  };

  return (
    <div className="grid grid-cols-1 border border-line md:min-h-[620px] md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="border-b border-line md:border-b-0 md:border-r">
        <div className="border-b border-line p-4 sm:p-5">
          <p className="eyebrow text-muted">
            {conversationType === "product"
              ? `${staffLabel} / 상품 문의`
              : `${staffLabel} / 매장 채팅`}
          </p>
          <p className="mt-3 text-sm font-bold">
            {conversationType === "product"
              ? "상품 문의 관리"
              : "담당 매장 회원 상담"}
          </p>
          <input aria-label="문의 검색" className="mt-4 h-11 w-full border border-line bg-paper px-3 text-xs outline-none focus:border-ink" onChange={(event) => setInquiryQuery(event.target.value)} placeholder="회원·제목·내용 검색" value={inquiryQuery} />
        </div>
        <div className="max-h-72 divide-y divide-line overflow-y-auto md:max-h-[560px]">
          {visibleConversations.map((conversation) => (
            <button
              className={`block w-full p-4 text-left sm:p-5 ${
                selected === conversation.id
                  ? "bg-ink text-paper"
                  : "hover:bg-surface"
              }`}
              key={conversation.id}
              onClick={() => selectConversation(conversation.id)}
              type="button"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="truncate text-xs font-bold">
                  {memberName(conversation.member_id)}
                </span>
                <span className="shrink-0 text-[10px] opacity-60">
                  {conversationStatusLabel(conversation.status)}
                </span>
              </span>
              <span className="mt-2 flex items-center gap-1 text-[10px] font-bold opacity-70">
                <Store size={11} />
                {conversation.conversation_type === "internal"
                  ? "내부 운영 대화"
                  : conversation.conversation_type === "product" ? `상품 문의 · ${storeName(conversation.store_id)}` : storeName(conversation.store_id)}
              </span>
              <span className="mt-2 block truncate text-[11px] opacity-70">
                {conversation.last_message_preview || "새 상담"}
              </span>
            </button>
          ))}
          {visibleConversations.length === 0 && (
            <p className="p-6 text-xs text-muted">
              {conversationType === "product"
                ? "새 상품 문의가 없습니다."
                : "담당 매장에 연결된 상담이 없습니다."}
            </p>
          )}
        </div>
      </aside>

      <section className="flex min-h-[480px] min-w-0 flex-col">
        <div className="border-b border-line p-4 sm:p-6">
          <p className="flex items-center gap-2 text-xs font-bold">
            <MessageCircle size={15} />
            {selectedConversation
              ? memberName(selectedConversation.member_id)
              : "상담을 선택하세요"}
          </p>
          <p className="mt-2 text-[11px] text-muted">
            {selectedConversation
              ? selectedConversation.conversation_type === "internal"
                ? "직원과 담당 운영자의 내부 운영 대화"
                : selectedConversation.conversation_type === "product"
                  ? `${storeName(selectedConversation.store_id)} · 상품 정보가 연결된 문의`
                  : `${storeName(selectedConversation.store_id)} · 회원의 일반 및 주문 문의`
              : "회원 보관함의 채팅하기 버튼으로도 바로 연결할 수 있습니다."}
          </p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {!token && (
            <p className="bg-surface p-4 text-xs">
              {staffLabel} 로그인이 필요합니다.
            </p>
          )}
          {token && !selected && (
            <p className="bg-surface p-4 text-xs">
              왼쪽 목록에서 상담을 선택하세요.
            </p>
          )}
          {messages.map((item) => (
            <article
              className={`max-w-[85%] p-4 text-xs leading-5 sm:max-w-md ${
                item.sender_id === staffId
                  ? "ml-auto bg-ink text-paper"
                  : "bg-surface"
              }`}
              key={item.id}
            >
              {item.product_id && (
                <Link
                  className="mb-3 flex items-center gap-3 border border-current/20 p-2"
                  href={`/auction/${item.product_id}`}
                >
                  {item.product_image_url_snapshot && (
                    <Image
                      alt=""
                      className="size-12 shrink-0 object-cover"
                      height={48}
                      src={item.product_image_url_snapshot}
                      width={48}
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block text-[9px] opacity-60">상품 문의</span>
                    <span className="mt-1 block truncate text-[11px] font-bold">
                      {item.product_title_snapshot ?? "상품 상세보기"}
                    </span>
                  </span>
                </Link>
              )}
              <p className="whitespace-pre-wrap break-words">{item.body}</p>
              <time className="mt-2 block text-[10px] opacity-60">
                {new Date(item.created_at).toLocaleString("ko-KR")}
              </time>
            </article>
          ))}
          {notice && (
            <p className="text-xs font-bold text-red-700" role="alert">
              {notice}
            </p>
          )}
        </div>
        <form
          className="grid gap-2 border-t border-line p-3 sm:grid-cols-[180px_minmax(0,1fr)_44px] sm:gap-3 sm:p-5"
          onSubmit={send}
        >
          <select aria-label="빠른 답변 템플릿" className="min-h-11 border border-line bg-paper px-3 text-xs" disabled={!token || !selected || busy} onChange={(event) => { if (event.target.value) setMessage(event.target.value); event.currentTarget.value = ""; }} defaultValue=""><option value="">빠른 답변</option>{CANNED_RESPONSES.map((template, index) => <option key={template} value={template}>템플릿 {index + 1}</option>)}</select>
          <input
            aria-label="회원 답변"
            className="min-w-0 flex-1 border border-line bg-paper px-3 text-xs outline-none focus:border-ink disabled:bg-surface sm:px-4"
            disabled={!token || !selected || busy}
            maxLength={2_000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="답변을 입력하세요"
            value={message}
          />
          <button
            aria-label="답변 보내기"
            className="grid size-11 shrink-0 place-items-center bg-ink text-paper disabled:opacity-40"
            disabled={!token || !selected || busy || !message.trim()}
            type="submit"
          >
            <Send size={15} />
          </button>
        </form>
      </section>
    </div>
  );
}
