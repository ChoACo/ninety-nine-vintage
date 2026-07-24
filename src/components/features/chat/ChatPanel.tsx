"use client";

import { ChevronRight, MessageCircle, Send, Store } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ChatStore {
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

interface ChatConversation {
  id: string;
  store_id: string | null;
  status: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  conversation_type: string;
  subject: string | null;
}

interface ChatPanelProps {
  basePath?: "" | "/m";
  surface?: "desktop" | "mobile";
}

function messageError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const problem = payload as { error?: string; message?: string };
  return problem.message ?? problem.error ?? fallback;
}

export function ChatPanel({
  basePath = "",
  surface = "desktop",
}: ChatPanelProps) {
  const router = useRouter();
  const [stores, setStores] = useState<ChatStore[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

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
        `/api/chat?conversationId=${encodeURIComponent(conversationId)}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        conversation?: ChatConversation;
        messages?: ChatMessage[];
      } | null;
      if (!response.ok || !payload?.conversation) {
        throw new Error(messageError(payload, "상담을 불러오지 못했습니다."));
      }
      setConversation(payload.conversation);
      setSelectedStoreId(payload.conversation.store_id);
      setMessages(payload.messages ?? []);
      await markRead(conversationId, accessToken);
    },
    [markRead],
  );

  const loadIndex = useCallback(async () => {
    const session = (await getSupabaseBrowserClient().auth.getSession()).data
      .session;
    setToken(session?.access_token ?? null);
    setUserId(session?.user.id ?? null);
    if (!session?.access_token) return;

    const response = await fetch("/api/chat", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as {
      stores?: ChatStore[];
      conversations?: ChatConversation[];
    } | null;
    if (!response.ok || !payload) {
      throw new Error(messageError(payload, "매장 상담 목록을 불러오지 못했습니다."));
    }

    const nextStores = payload.stores ?? [];
    const nextConversations = payload.conversations ?? [];
    setStores(nextStores);
    setConversations(nextConversations);

    const params = new URLSearchParams(window.location.search);
    const requestedConversationId = params.get("conversationId");
    const requestedStoreId = params.get("storeId");
    if (requestedConversationId) {
      await loadMessages(requestedConversationId, session.access_token);
      return;
    }

    const nextStoreId =
      requestedStoreId ??
      selectedStoreId ??
      nextConversations[0]?.store_id ??
      nextStores[0]?.id ??
      null;
    setSelectedStoreId(nextStoreId);
    const nextConversation =
      nextConversations.find((item) => item.store_id === nextStoreId) ?? null;
    setConversation(nextConversation);
    if (nextConversation) {
      await loadMessages(nextConversation.id, session.access_token);
    } else {
      setMessages([]);
    }
  }, [loadMessages, selectedStoreId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadIndex().catch((error: unknown) =>
        setNotice(
          error instanceof Error ? error.message : "상담을 불러오지 못했습니다.",
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadIndex]);

  useEffect(() => {
    const reload = () => {
      if (token && conversation?.id) {
        void loadMessages(conversation.id, token).catch(() => undefined);
      } else {
        void loadIndex().catch(() => undefined);
      }
    };
    window.addEventListener("ninety-nine:chat-message", reload);
    return () => window.removeEventListener("ninety-nine:chat-message", reload);
  }, [conversation?.id, loadIndex, loadMessages, token]);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedStoreId) ?? null,
    [selectedStoreId, stores],
  );

  const selectStore = async (storeId: string) => {
    setSelectedStoreId(storeId);
    setNotice("");
    const nextConversation =
      conversations.find((item) => item.store_id === storeId) ?? null;
    setConversation(nextConversation);
    const nextUrl = `${basePath}/chat?storeId=${encodeURIComponent(storeId)}`;
    router.replace(nextUrl, { scroll: false });
    if (nextConversation && token) {
      try {
        await loadMessages(nextConversation.id, token);
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "상담을 불러오지 못했습니다.",
        );
      }
    } else {
      setMessages([]);
    }
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!message.trim() || !token || !selectedStoreId || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversationId: conversation?.id,
          storeId: selectedStoreId,
          body: message,
          clientNonce: crypto.randomUUID(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: ChatMessage;
      } | null;
      if (!response.ok || !payload?.message) {
        throw new Error(messageError(payload, "메시지를 보내지 못했습니다."));
      }
      setMessages((current) => [...current, payload.message as ChatMessage]);
      setMessage("");
      await loadIndex();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "메시지를 보내지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`grid border border-line ${
        surface === "desktop"
          ? "min-h-[620px] grid-cols-[280px_1fr]"
          : "min-h-[70svh] grid-cols-1"
      }`}
    >
      <aside
        className={`bg-surface ${
          surface === "desktop"
            ? "border-r border-line p-5"
            : "border-b border-line p-4"
        }`}
      >
        <p className="eyebrow text-muted">매장별 상담</p>
        <p className="mt-3 text-xs leading-5 text-muted">
          문의할 매장을 선택하면 해당 매장 운영자와 연결됩니다.
        </p>
        <div
          className={`mt-4 grid gap-2 ${
            surface === "mobile"
              ? "max-h-44 grid-cols-2 overflow-y-auto"
              : "max-h-[480px] overflow-y-auto"
          }`}
        >
          {stores.map((store) => {
            const thread = conversations.find(
              (item) => item.store_id === store.id,
            );
            const active = selectedStoreId === store.id;
            return (
              <button
                className={`flex min-w-0 items-center gap-3 border p-3 text-left ${
                  active
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-paper hover:border-ink"
                }`}
                key={store.id}
                onClick={() => void selectStore(store.id)}
                type="button"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-current/20">
                  <Store size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold">
                    {store.name}
                  </span>
                  <span className="mt-1 block truncate text-[10px] opacity-60">
                    {thread?.last_message_preview ?? "새 상담 시작"}
                  </span>
                </span>
                <ChevronRight className="shrink-0 opacity-50" size={14} />
              </button>
            );
          })}
          {token && stores.length === 0 && (
            <p className="border border-line bg-paper p-4 text-xs text-muted">
              현재 상담 가능한 매장이 없습니다.
            </p>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-col">
        <div
          className={`border-b border-line ${
            surface === "desktop" ? "p-6" : "p-4"
          }`}
        >
          <p className="flex items-center gap-2 text-xs font-bold">
            <MessageCircle size={15} />
            {selectedStore?.name ?? "매장을 선택하세요"}
          </p>
          <p className="mt-2 text-[11px] text-muted">
            상품 문의를 보내면 상품 정보도 이 매장 상담방에 함께 표시됩니다.
          </p>
        </div>

        <div
          className={`min-h-64 flex-1 space-y-4 overflow-y-auto ${
            surface === "desktop" ? "p-6" : "p-4"
          }`}
        >
          {!token && (
            <div className="bg-surface p-4 text-xs leading-5">
              상담을 시작하려면{" "}
              <Link
                className="font-bold underline"
                href={`${basePath}/account/login?next=${encodeURIComponent(
                  `${basePath}/chat`,
                )}`}
              >
                로그인
              </Link>
              이 필요합니다.
            </div>
          )}
          {token && selectedStoreId && messages.length === 0 && (
            <div className="bg-surface p-4 text-xs leading-5">
              {selectedStore?.name} 운영자에게 궁금한 내용을 남겨주세요.
            </div>
          )}
          {messages.map((item) => (
            <article
              className={`max-w-[85%] p-4 text-xs leading-5 ${
                surface === "desktop" ? "max-w-md" : ""
              } ${
                item.sender_id === userId
                  ? "ml-auto bg-ink text-paper"
                  : "bg-surface"
              }`}
              key={item.id}
            >
              {item.product_id && (
                <Link
                  className="mb-3 flex items-center gap-3 border border-current/20 p-2"
                  href={`${basePath}/auction/${item.product_id}`}
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
                    <span className="block text-[9px] font-bold opacity-60">
                      상품 문의
                    </span>
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
          className={`flex border-t border-line ${
            surface === "desktop" ? "gap-3 p-5" : "gap-2 p-3"
          }`}
          onSubmit={send}
        >
          <input
            aria-label="문의 메시지"
            className={`min-w-0 flex-1 border border-line bg-paper text-xs outline-none focus:border-ink disabled:bg-surface ${
              surface === "desktop" ? "px-4" : "px-3"
            }`}
            disabled={!token || !selectedStoreId || busy}
            maxLength={2_000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={
              token
                ? selectedStoreId
                  ? "메시지를 입력하세요"
                  : "먼저 매장을 선택하세요"
                : "로그인 후 이용할 수 있습니다"
            }
            value={message}
          />
          <button
            aria-label="메시지 보내기"
            className="grid size-11 shrink-0 place-items-center bg-ink text-paper disabled:opacity-40"
            disabled={
              !token || !selectedStoreId || busy || !message.trim()
            }
            type="submit"
          >
            <Send size={15} />
          </button>
        </form>
      </section>
    </div>
  );
}
