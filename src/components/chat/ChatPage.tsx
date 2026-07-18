"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  useEmployeeSupportChat,
  useMemberSupportThreads,
} from "@/src/hooks/useSupportChat";
import {
  MAX_SUPPORT_MESSAGE_LENGTH,
  isSupportStaffRole,
  type SupportViewerRole,
} from "@/src/lib/supabase/supportChat";
import { formatKoreanTime } from "@/src/utils/formatters";
import { StaffChatInbox } from "./StaffChatInbox";

export interface ChatPageProps {
  userId: string | null;
  role: SupportViewerRole | null;
  onRequestSignIn?: () => void;
}

export function ChatPage({ userId, role, onRequestSignIn }: ChatPageProps) {
  if (!userId) {
    return (
      <ChatAccessState
        title="로그인이 필요한 상담이에요"
        description="카카오 로그인 후 운영팀과 나눈 비공개 대화만 확인할 수 있어요."
        actionLabel="로그인하기"
        onAction={onRequestSignIn}
      />
    );
  }

  if (!role) {
    return <ChatAccessState title="로그인 정보를 확인하고 있어요" description="잠시만 기다려 주세요." loading />;
  }

  if (isSupportStaffRole(role)) {
    return <StaffChatInbox key={userId} staffId={userId} role={role} />;
  }

  if (role === "employee") {
    return <EmployeeChat key={userId} userId={userId} />;
  }

  return <MemberChat key={userId} userId={userId} />;
}

function MemberChat({ userId }: { userId: string }) {
  const chat = useMemberSupportThreads(userId);
  return <ParticipantChat userId={userId} chat={chat} internal={false} />;
}

function EmployeeChat({ userId }: { userId: string }) {
  const chat = useEmployeeSupportChat(userId);
  return <ParticipantChat userId={userId} chat={chat} internal />;
}

function ParticipantChat({
  userId,
  chat,
  internal,
}: {
  userId: string;
  chat:
    | ReturnType<typeof useMemberSupportThreads>
    | ReturnType<typeof useEmployeeSupportChat>;
  internal: boolean;
}) {
  const [draft, setDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  const conversationId = chat.conversation?.id;
  const messageCount = chat.messages.length;
  const markRead = chat.markRead;

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    if (conversationId) void markRead();
  }, [conversationId, markRead, messageCount]);

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || chat.isSending) return;

    try {
      await chat.sendMessage(text);
      setDraft("");
    } catch {
      // The hook exposes a user-facing error message.
    }
  };

  if (chat.isLoading) {
    return (
      <ChatAccessState
        title="운영팀 대화를 불러오는 중이에요…"
        description={
          internal
            ? "지정 운영자와의 내부 대화를 준비하고 있습니다."
            : "회원님의 비공개 상담함을 준비하고 있습니다."
        }
        loading
      />
    );
  }

  if (!chat.conversation && chat.error) {
    return (
      <ChatAccessState
        title="상담함을 열지 못했어요"
        description={chat.error ?? "잠시 후 다시 시도해 주세요."}
        actionLabel="다시 시도"
        onAction={() => void chat.retry()}
      />
    );
  }

  const isClosed = chat.conversation?.status === "closed";

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--panel-shadow)]">
      <div className="flex min-h-[620px] flex-col bg-[var(--surface)]">
        <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)]/90 px-4 py-3.5 sm:flex-nowrap md:px-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5"><path d="M5 5.5h14v10H9l-4 3v-13Z" strokeLinejoin="round" /><path d="M9 10.5h6" strokeLinecap="round" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black tracking-[0.18em] text-[var(--accent-text)]">PRIVATE SUPPORT</p>
            <h2 className="mt-0.5 truncate text-base font-black tracking-[-0.025em] text-[var(--text-strong)] sm:text-lg">
              {internal ? "담당 운영자 내부 대화" : "나인티 나인 빈티지 운영팀"}
            </h2>
            <p className="mt-0.5 truncate text-xs font-semibold text-[var(--text-muted)]">
              {internal
                ? "이 대화는 직원 본인과 지정 운영자만 볼 수 있어요."
                : "이 대화는 회원님과 담당 운영자만 볼 수 있어요."}
            </p>
          </div>
          <span className={`rounded-md border px-2.5 py-1.5 text-[10px] font-black ${isClosed ? "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]" : "border-[var(--border)] bg-[var(--success-surface)] text-[var(--success-text)]"}`}>
            {isClosed ? "상담 종료" : chat.conversation ? "상담 중" : "새 문의"}
          </span>
          {isClosed ? (
            <button
              type="button"
              onClick={() => void chat.reopenConversation()}
              disabled={chat.isReopening}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-black text-[var(--accent-contrast)] shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {chat.isReopening ? "여는 중…" : "새 문의 시작"}
            </button>
          ) : null}
        </header>

        {chat.error && (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--danger-surface)] px-5 py-2.5 text-xs font-bold text-[var(--danger-text)]">
            <span>{chat.error}</span>
            <button type="button" onClick={() => void chat.retry()} className="shrink-0 underline">
              다시 시도
            </button>
          </div>
        )}

        {!internal && "conversations" in chat && chat.conversations.length > 0 ? (
          <nav
            aria-label="내 상담 대화"
            className="flex gap-1.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface-raised)]/70 px-4 py-2.5 [scrollbar-gutter:stable] md:px-6"
          >
            {chat.conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => chat.selectConversation(conversation.id)}
                className={`relative shrink-0 rounded-md border px-3 py-1.5 text-xs font-black transition-all duration-200 ease-out hover:scale-[1.02] ${
                  conversation.id === chat.selectedConversationId
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm"
                    : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
                }`}
              >
                {conversation.conversationType === "product"
                  ? `상품 · ${conversation.subject ?? "문의"}`
                  : "일반 상담"}
                {conversation.isUnread ? (
                  <span
                    className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-[var(--surface-raised)] bg-[var(--accent-text)]"
                    aria-label="안 읽은 메시지"
                  />
                ) : null}
              </button>
            ))}
          </nav>
        ) : null}

        {!internal && chat.conversation?.conversationType === "product" ? (
          <div className="border-b border-[var(--border)] bg-[var(--surface-muted)]/55 px-4 py-2.5 md:px-6">
            <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-2.5">
              {chat.conversation.productImageUrlSnapshot ? (
                // The Storage public URL is dynamic per product and is shown
                // as a small, lazy-loaded support-context thumbnail.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={chat.conversation.productImageUrlSnapshot}
                  alt={`${chat.conversation.productTitleSnapshot ?? chat.conversation.subject ?? "문의 상품"} 사진`}
                  loading="lazy"
                  className="size-12 shrink-0 rounded-md border border-[var(--border)] object-cover"
                />
              ) : (
                <span
                  className="grid size-12 shrink-0 place-items-center rounded-md bg-[var(--surface-muted)] text-lg"
                  aria-hidden="true"
                >
                  🧥
                </span>
              )}
              <div className="min-w-0">
                <p className="text-[9px] font-black tracking-[0.14em] text-[var(--accent-text)]">
                  문의한 상품
                </p>
                <p className="mt-0.5 line-clamp-1 text-sm font-black text-[var(--text-strong)]">
                  {chat.conversation.productTitleSnapshot ??
                    chat.conversation.subject ??
                    "문의 상품"}
                </p>
                <p className="mt-0.5 font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
                  상품번호 {chat.conversation.productId?.slice(0, 8) ?? "확인 불가"}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5 [scrollbar-gutter:stable] sm:px-6" aria-live="polite">
          {"isMessagesLoading" in chat && chat.isMessagesLoading ? (
            <ParticipantMessageSkeleton />
          ) : chat.messages.length === 0 ? (
            <div className="mx-auto mt-10 max-w-md rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)]/65 p-7 text-center">
              <span className="mx-auto grid size-10 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="M5 5.5h14v10H9l-4 3v-13Z" strokeLinejoin="round" /><path d="M9 10.5h6" strokeLinecap="round" /></svg></span>
              <p className="mt-3 text-sm font-black text-[var(--text-strong)]">
                {internal ? "담당 운영자에게 내부 메시지를 남겨주세요" : "운영팀에 궁금한 점을 남겨주세요"}
              </p>
              <p className="mt-1.5 break-keep text-xs font-semibold leading-5 text-[var(--text-muted)]">
                {internal
                  ? "이 내용은 일반 회원 화면에 표시되지 않습니다."
                  : "주문, 입찰, 배송과 관련된 문의에 순서대로 답변드려요."}
              </p>
            </div>
          ) : (
            chat.messages.map((message) => {
              const isMine = message.senderId === userId;

              return (
                <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                  <div className={`flex max-w-[82%] flex-col ${isMine ? "items-end" : "items-start"}`}>
                    {!isMine && (
                      <span className="mb-1 px-1 text-[10px] font-bold text-[var(--text-muted)]">
                        {internal ? "담당 운영자" : "운영팀"}
                      </span>
                    )}
                    <p className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm font-medium leading-6 shadow-sm ${
                      isMine
                        ? "rounded-br-sm bg-[var(--accent)] text-[var(--accent-contrast)]"
                        : "rounded-bl-sm border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-strong)]"
                    }`}>
                      {message.body}
                    </p>
                    <time className="mt-1 px-1 font-mono text-[9px] font-medium tabular-nums text-[var(--text-muted)]" dateTime={message.createdAt}>
                      {formatKoreanTime(message.createdAt)}
                    </time>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={handleSend} className="border-t border-[var(--border)] bg-[var(--surface-raised)] p-3.5 md:px-5">
          <label htmlFor="support-message" className="sr-only">운영팀에 보낼 메시지</label>
          <textarea
            id="support-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
            rows={2}
            disabled={isClosed || chat.isSending}
            placeholder={isClosed ? "종료된 상담입니다. 운영팀이 다시 열면 메시지를 보낼 수 있어요." : "문의 내용을 입력하세요"}
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3.5 py-2.5 text-sm font-medium leading-6 text-[var(--text-strong)] outline-none transition-all duration-200 placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)]"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">{draft.length.toLocaleString("ko-KR")} / {MAX_SUPPORT_MESSAGE_LENGTH.toLocaleString("ko-KR")}</span>
            <button
              type="submit"
              disabled={!draft.trim() || chat.isSending || isClosed}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-black text-[var(--accent-contrast)] shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--accent-hover)] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
            >
              {chat.isSending ? "전송 중…" : "보내기"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function ParticipantMessageSkeleton() {
  return (
    <div role="status" aria-label="대화 내용을 불러오는 중" className="space-y-4 py-3">
      <span className="sr-only">대화 내용을 불러오는 중…</span>
      <div className="commerce-skeleton h-14 w-2/3 rounded-2xl rounded-bl-sm" />
      <div className="commerce-skeleton ml-auto h-16 w-1/2 rounded-2xl rounded-br-sm" />
      <div className="commerce-skeleton h-12 w-3/5 rounded-2xl rounded-bl-sm" />
    </div>
  );
}

function ChatAccessState({
  title,
  description,
  actionLabel,
  onAction,
  loading = false,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}) {
  return (
    <section className="grid min-h-[420px] place-items-center rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-8 text-center shadow-[var(--panel-shadow)]">
      <div className="max-w-md">
        {loading ? (
          <div role="status" aria-label={title} className="mx-auto w-72 max-w-full space-y-3">
            <span className="commerce-skeleton mx-auto block size-10 rounded-lg" />
            <span className="commerce-skeleton mx-auto block h-5 w-52 rounded" />
            <span className="commerce-skeleton mx-auto block h-3 w-64 max-w-full rounded" />
          </div>
        ) : (
          <span className="mx-auto grid size-11 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="M5 5.5h14v10H9l-4 3v-13Z" strokeLinejoin="round" /><path d="M9 10.5h6" strokeLinecap="round" /></svg></span>
        )}
        {!loading ? <h2 className="mt-4 text-xl font-black tracking-[-0.03em] text-[var(--text-strong)]">{title}</h2> : null}
        {!loading ? <p className="mt-2 break-keep text-sm font-semibold leading-6 text-[var(--text-muted)]">{description}</p> : null}
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="mt-5 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-black text-[var(--accent-contrast)] shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--accent-hover)] hover:shadow-md">
            {actionLabel}
          </button>
        )}
      </div>
    </section>
  );
}
