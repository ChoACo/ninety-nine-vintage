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
import {
  clientErrorFromPayload,
  getClientErrorDetails,
  reportClientError,
} from "@/lib/clientErrors";
import { OnboardingChatPanel } from "@/components/features/chat/OnboardingChatPanel";
import {
  ImageAttachmentPicker,
  uploadSupportImages,
  type PendingSupportImage,
} from "@/components/features/chat/ImageAttachmentPicker";

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
  last_sender_id: string | null;
  peer_read_at: string | null;
}

interface ChatAttachment {
  id: string;
  messageId: string;
  signedUrl: string;
}

interface ChatPanelProps {
  basePath?: "" | "/m";
  surface?: "desktop" | "mobile";
}

export function ChatPanel({
  basePath = "",
  surface = "desktop",
}: ChatPanelProps) {
  const router = useRouter();
  const [stores, setStores] = useState<ChatStore[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ChatConversation | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [retryMessage, setRetryMessage] = useState<{
    body: string;
    clientNonce: string;
  } | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingSupportImage[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

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
      const [response, attachmentResponse] = await Promise.all([
        fetch(
          `/api/chat?conversationId=${encodeURIComponent(conversationId)}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
          },
        ),
        fetch(
          `/api/chat/attachments?conversationId=${encodeURIComponent(conversationId)}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
          },
        ),
      ]);
      const payload = (await response.json().catch(() => null)) as {
        code?: string;
        conversation?: ChatConversation;
        error?: string;
        message?: string;
        messages?: ChatMessage[];
        stage?: string;
      } | null;
      if (!response.ok || !payload?.conversation) {
        throw clientErrorFromPayload(
          payload,
          "상담을 불러오지 못했습니다.",
          response.status,
        );
      }
      setConversation(payload.conversation);
      setSelectedStoreId(payload.conversation.store_id);
      setMessages(payload.messages ?? []);
      if (attachmentResponse.ok) {
        const attachmentPayload = (await attachmentResponse.json()) as {
          attachments?: ChatAttachment[];
        };
        setAttachments(attachmentPayload.attachments ?? []);
      } else {
        setAttachments([]);
      }
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
      code?: string;
      stores?: ChatStore[];
      conversations?: ChatConversation[];
      error?: string;
      message?: string;
      stage?: string;
    } | null;
    if (!response.ok || !payload) {
      throw clientErrorFromPayload(
        payload,
        "매장 상담 목록을 불러오지 못했습니다.",
        response.status,
      );
    }

    const nextStores = payload.stores ?? [];
    const nextConversations = payload.conversations ?? [];
    setStores(nextStores);
    setConversations(nextConversations);

    const params = new URLSearchParams(window.location.search);
    const requestedConversationId = params.get("conversationId");
    const requestedStoreId = params.get("storeId");
    const requestedStoreContext = params.get("storeContext");
    const requestedProductId = params.get("productId");
    const requestedDraft = params.get("draft");
    if (requestedDraft && requestedDraft.length <= 500)
      setMessage(requestedDraft);
    if (requestedConversationId) {
      await loadMessages(requestedConversationId, session.access_token);
      return;
    }

    let contextualStoreId =
      requestedStoreId ??
      nextStores.find(
        (store) =>
          store.id === requestedStoreContext ||
          store.slug === requestedStoreContext,
      )?.id ??
      null;
    if (!contextualStoreId && requestedProductId) {
      const productResponse = await fetch(
        `/api/products/${encodeURIComponent(requestedProductId)}`,
        { cache: "no-store" },
      );
      if (productResponse.ok) {
        const productPayload = (await productResponse.json()) as {
          product?: { storeId?: string | null };
        };
        contextualStoreId = nextStores.some(
          (store) => store.id === productPayload.product?.storeId,
        )
          ? (productPayload.product?.storeId ?? null)
          : null;
      }
    }
    const nextStoreId =
      contextualStoreId ??
      selectedStoreId ??
      nextConversations[0]?.store_id ??
      null;
    setSelectedStoreId(nextStoreId);
    setRefreshError("");
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
      void loadIndex().catch((error: unknown) => {
        const fallback = "상담을 불러오지 못했습니다.";
        setNotice(getClientErrorDetails(error, fallback).message);
        reportClientError(error, {
          dedupeKey: "member-chat-initial-load",
          fallback,
        });
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadIndex]);

  const handleRefreshFailure = useCallback((error: unknown) => {
    const fallback = "새 메시지를 불러오지 못했습니다.";
    setRefreshError(fallback);
    reportClientError(error, {
      dedupeKey: "member-chat-realtime-refresh",
      fallback,
    });
  }, []);

  useEffect(() => {
    const reload = () => {
      if (token && conversation?.id) {
        void loadMessages(conversation.id, token)
          .then(() => setRefreshError(""))
          .catch(handleRefreshFailure);
      } else {
        void loadIndex().catch(handleRefreshFailure);
      }
    };
    window.addEventListener("ninety-nine:chat-message", reload);
    return () => window.removeEventListener("ninety-nine:chat-message", reload);
  }, [conversation?.id, handleRefreshFailure, loadIndex, loadMessages, token]);

  const retryRefresh = () => {
    if (token && conversation?.id) {
      void loadMessages(conversation.id, token)
        .then(() => setRefreshError(""))
        .catch(handleRefreshFailure);
      return;
    }
    void loadIndex().catch(handleRefreshFailure);
  };

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedStoreId) ?? null,
    [selectedStoreId, stores],
  );
  const conversationStores = useMemo(
    () =>
      stores.filter((store) =>
        conversations.some((item) => item.store_id === store.id),
      ),
    [conversations, stores],
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
          error instanceof Error
            ? error.message
            : "상담을 불러오지 못했습니다.",
        );
      }
    } else {
      setMessages([]);
    }
  };

  const send = async (
    event?: FormEvent<HTMLFormElement>,
    retry: { body: string; clientNonce: string } | null = null,
  ) => {
    event?.preventDefault();
    const outgoing = retry?.body ?? message.trim();
    if (!outgoing || !token || !selectedStoreId || busy) return;
    const clientNonce = retry?.clientNonce ?? crypto.randomUUID();
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
          body: outgoing,
          clientNonce,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        code?: string;
        error?: string;
        message?: ChatMessage | string;
        conversation?: ChatConversation;
        stage?: string;
      } | null;
      const conversationId = payload?.conversation?.id ?? conversation?.id;
      if (!response.ok || typeof payload?.message !== "object" || !conversationId) {
        throw clientErrorFromPayload(
          payload,
          "메시지를 보내지 못했습니다.",
          response.status,
        );
      }
      setMessages((current) => [...current, payload.message as ChatMessage]);
      if (pendingImages.length > 0) {
        await uploadSupportImages({
          token,
          conversationId,
          messageId: payload.message.id,
          images: pendingImages,
        });
        pendingImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
        setPendingImages([]);
      }
      setMessage("");
      setRetryMessage(null);
      await loadIndex();
    } catch (error) {
      setRetryMessage({ body: outgoing, clientNonce });
      const fallback = "메시지를 보내지 못했습니다.";
      setNotice(getClientErrorDetails(error, fallback).message);
      reportClientError(error, {
        dedupeKey: "member-chat-send",
        fallback,
        userMessage: "메시지를 보내지 못했습니다. 다시 시도해 주세요.",
        visibility: "always",
      });
    } finally {
      setBusy(false);
    }
  };

  const responseStatus = (thread: ChatConversation | null) => {
    if (!thread || thread.conversation_type !== "product") return null;
    return thread.last_sender_id === userId ? "답변 대기" : "답변 도착";
  };

  const peerReadStatus = (thread: ChatConversation | null) => {
    if (
      !thread ||
      thread.last_sender_id !== userId ||
      !thread.last_message_at
    ) {
      return null;
    }
    return thread.peer_read_at && thread.peer_read_at >= thread.last_message_at
      ? "상대 읽음"
      : "전송됨";
  };

  return (
    <div className="grid min-h-[70svh] grid-cols-1 border border-line md:min-h-[620px] md:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
      <aside className="border-b border-line bg-surface p-4 md:border-b-0 md:border-r md:p-5">
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
          {conversationStores.map((store) => {
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
                    {thread?.last_message_preview}
                  </span>
                  {responseStatus(thread ?? null) && (
                    <span className="mt-1 block text-[9px] font-bold opacity-70">
                      {responseStatus(thread ?? null)} ·{" "}
                      {peerReadStatus(thread ?? null) ?? "내가 읽음"}
                    </span>
                  )}
                </span>
                <ChevronRight className="shrink-0 opacity-50" size={14} />
              </button>
            );
          })}
          {token && conversationStores.length === 0 && (
            <p className="border border-line bg-paper p-4 text-xs text-muted">
              아직 시작된 상담이 없습니다. 상품 상세의 문의하기에서 상담을
              시작할 수 있습니다.
            </p>
          )}
        </div>
        <div className="mt-4">
          <OnboardingChatPanel />
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
          {responseStatus(conversation) && (
            <p className="mt-2 text-[10px] font-bold text-muted">
              {selectedStore?.name} · {responseStatus(conversation)} ·{" "}
              {peerReadStatus(conversation) ?? "내가 읽음"}
            </p>
          )}
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
              {attachments.some(
                (attachment) => attachment.messageId === item.id,
              ) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {attachments
                    .filter((attachment) => attachment.messageId === item.id)
                    .map((attachment, index) => (
                      <a
                        href={attachment.signedUrl}
                        key={attachment.id}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <Image
                          alt={`상담 첨부 이미지 ${index + 1}`}
                          className="size-28 rounded-lg object-cover"
                          height={112}
                          src={attachment.signedUrl}
                          unoptimized
                          width={112}
                        />
                      </a>
                    ))}
                </div>
              )}
              <time className="mt-2 block text-[10px] opacity-60">
                {new Date(item.created_at).toLocaleString("ko-KR")}
              </time>
            </article>
          ))}
          {notice && (
            <div
              className="flex items-center justify-between gap-3 text-xs font-bold text-red-700"
              role="alert"
            >
              <span>{notice}</span>
              {retryMessage && (
                <button
                  className="shrink-0 underline"
                  disabled={busy}
                  onClick={() => void send(undefined, retryMessage)}
                  type="button"
                >
                  같은 내용 재전송
                </button>
              )}
            </div>
          )}
          {refreshError && (
            <div
              className="flex min-h-11 flex-wrap items-center justify-between gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900"
              role="alert"
            >
              <span>{refreshError}</span>
              <button
                className="min-h-11 border border-amber-400 px-4 active:scale-[.98]"
                onClick={retryRefresh}
                type="button"
              >
                다시 불러오기
              </button>
            </div>
          )}
        </div>

        <form
          className={`border-t border-line ${surface === "desktop" ? "p-5" : "p-3"}`}
          onSubmit={send}
        >
          <ImageAttachmentPicker
            disabled={!token || !selectedStoreId || busy}
            images={pendingImages}
            maxCount={1}
            onChange={setPendingImages}
            onError={setNotice}
          />
          <div
            className={`mt-3 flex ${surface === "desktop" ? "gap-3" : "gap-2"}`}
          >
            <textarea
              aria-label="문의 메시지"
              className={`max-h-36 min-h-11 min-w-0 flex-1 resize-none border border-line bg-paper py-3 text-xs outline-none focus:border-ink disabled:bg-surface ${
                surface === "desktop" ? "px-4" : "px-3"
              }`}
              disabled={!token || !selectedStoreId || busy}
              maxLength={2_000}
              onChange={(event) => {
                setMessage(event.target.value);
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 144)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
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
              disabled={!token || !selectedStoreId || busy || !message.trim()}
              type="submit"
            >
              <Send size={15} />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
