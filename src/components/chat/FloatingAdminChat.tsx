"use client";

import { Fragment, FormEvent, useEffect, useRef, useState } from "react";
import { useMemberSupportChat } from "@/src/hooks/useSupportChat";
import {
  MAX_SUPPORT_MESSAGE_LENGTH,
  type SupportViewerRole,
} from "@/src/lib/supabase/supportChat";
import {
  formatKoreanDate,
  formatKoreanTime,
  getKoreanDateKey,
} from "@/src/utils/formatters";

const MEMBER_QUICK_QUESTIONS = [
  { icon: "📏", label: "실측 사이즈가 궁금해요" },
  { icon: "🔎", label: "오염이나 하자가 있나요?" },
  { icon: "🏦", label: "계좌이체 입금 완료했습니다" },
] as const;

export interface FloatingAdminChatProps {
  userId: string | null;
  role: SupportViewerRole | null;
  hidden?: boolean;
}

export function FloatingAdminChat({ userId, role, hidden = false }: FloatingAdminChatProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!userId || role !== "member" || hidden) return null;

  return (
    <>
      {isOpen ? (
        <MemberFloatingChat
          key={userId}
          userId={userId}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={`${isOpen ? "hidden md:flex" : "flex"} fixed bottom-[calc(6.25rem+env(safe-area-inset-bottom))] right-4 z-[71] min-h-12 items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--accent)] px-3.5 text-sm font-black text-[var(--accent-contrast)] shadow-[0_12px_30px_rgba(20,19,18,0.24)] transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--accent-hover)] hover:shadow-lg active:scale-[0.98] md:bottom-6 md:right-6`}
        aria-expanded={isOpen}
        aria-controls="floating-support-chat"
        aria-label={isOpen ? "운영팀 상담 닫기" : "운영팀 상담 열기"}
      >
        <span aria-hidden="true">
          {isOpen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><path d="M5 5.5h14v10H9l-4 3v-13Z" strokeLinejoin="round" /></svg>
          )}
        </span>
        <span className="hidden sm:inline">운영팀 문의</span>
      </button>
    </>
  );
}

function MemberFloatingChat({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const chat = useMemberSupportChat(userId);
  const [draft, setDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  const messageCount = chat.messages.length;
  const markRead = chat.markRead;

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    if (chat.isUnread) void markRead();
  }, [chat.isUnread, markRead, messageCount]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

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

  const isClosed = chat.conversation?.status === "closed";

  const handleQuickQuestion = async (question: string) => {
    if (isClosed || chat.isSending) return;

    try {
      await chat.sendMessage(question);
    } catch {
      // The hook exposes a user-facing error message.
    }
  };

  return (
    <>
      <section
        id="floating-support-chat"
        role="dialog"
        aria-label="운영팀 비공개 상담"
        className="fixed inset-0 z-[70] flex h-dvh max-h-none origin-bottom-right flex-col overflow-hidden overscroll-none border-0 bg-[var(--surface-raised)] shadow-[0_28px_90px_rgba(0,0,0,0.34)] md:inset-auto md:bottom-20 md:right-6 md:max-h-[min(72dvh,620px)] md:w-[400px] md:rounded-2xl md:border"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)]/95 px-4 pb-3 pt-[max(.75rem,env(safe-area-inset-top))] backdrop-blur-xl md:py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4.5"><path d="M5 5.5h14v10H9l-4 3v-13Z" strokeLinejoin="round" /></svg></span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-black text-[var(--text-strong)]">나인티 나인 빈티지 운영팀</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3" aria-hidden="true"><rect x="5.5" y="10" width="13" height="9" rx="2" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" strokeLinecap="round" /></svg>회원님만 볼 수 있는 비공개 상담</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)] transition-all duration-200 hover:border-[var(--border-strong)] hover:text-[var(--text-strong)] active:scale-[0.98] md:size-8" aria-label="상담 닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" /></svg></button>
        </header>

        {chat.error && (
          <div role="alert" className="border-b border-[var(--border)] bg-[var(--danger-surface)] px-4 py-2 text-xs font-bold text-[var(--danger-text)]">{chat.error}</div>
        )}

        <div ref={messagesRef} className="min-h-0 flex-1 touch-pan-y space-y-3 overflow-y-auto overscroll-contain bg-[var(--surface)] px-4 py-4 scroll-pb-28 [scrollbar-gutter:stable]" aria-live="polite">
          {chat.isLoading ? (
            <FloatingMessageSkeleton />
          ) : chat.messages.length === 0 ? (
            <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]/70 px-5 py-7 text-center shadow-sm backdrop-blur-xl">
              <span className="pointer-events-none absolute -right-7 -top-8 text-[88px] font-black leading-none text-[var(--text-muted)] opacity-[0.045]" aria-hidden="true">99</span>
              <span className="relative mx-auto grid size-10 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4.5"><path d="M5 5.5h14v10H9l-4 3v-13Z" strokeLinejoin="round" /><path d="M9 10.5h6" strokeLinecap="round" /></svg></span>
              <p className="relative mt-3 text-sm font-black tracking-[-0.02em] text-[var(--text-strong)]">무엇을 도와드릴까요?</p>
              <p className="relative mt-1 text-xs font-semibold leading-5 text-[var(--text-muted)]">아래 간편 질문을 누르거나 문의 내용을 남겨주세요.</p>
            </div>
          ) : (
            chat.messages.map((message, index) => {
              const isMine = message.senderId === userId;
              const dateKey = getKoreanDateKey(message.createdAt);
              const previousDateKey =
                index > 0
                  ? getKoreanDateKey(chat.messages[index - 1].createdAt)
                  : null;
              const showDateDivider = dateKey !== previousDateKey;

              return (
                <Fragment key={message.id}>
                  {showDateDivider ? (
                    <div
                      className="flex items-center gap-3 py-2"
                      data-chat-date-divider={dateKey}
                      role="separator"
                    >
                      <span className="h-px flex-1 bg-[var(--border)]" />
                      <time
                        dateTime={dateKey}
                        className="shrink-0 font-mono text-[9px] font-bold tabular-nums tracking-tight text-[var(--text-muted)]"
                      >
                        {formatKoreanDate(message.createdAt, {
                          includeWeekday: false,
                        })}
                      </time>
                      <span className="h-px flex-1 bg-[var(--border)]" />
                    </div>
                  ) : null}
                  <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                    <div className={`flex max-w-[86%] flex-col ${isMine ? "items-end" : "items-start"}`}>
                      {!isMine ? <span className="mb-1 px-1 text-[10px] font-bold text-[var(--text-muted)]">운영팀</span> : null}
                      <p className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] font-medium leading-5.5 shadow-sm ${
                        isMine
                          ? "rounded-br-md bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                          : "rounded-bl-md border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-strong)]"
                      }`}>{message.body}</p>
                      <time dateTime={message.createdAt} className="mt-1 px-1 font-mono text-[9px] font-medium tabular-nums tracking-tight text-[var(--text-muted)]">{formatKoreanTime(message.createdAt)}</time>
                    </div>
                  </div>
                </Fragment>
              );
            })
          )}
        </div>

        {isClosed ? (
          <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
            <p className="text-xs font-bold text-[var(--text-muted)]">이전 상담이 종료되었습니다.</p>
            <button
              type="button"
              onClick={() => void chat.reopenConversation()}
              disabled={chat.isReopening}
              className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-black text-[var(--accent-contrast)] transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {chat.isReopening ? "여는 중…" : "새 문의 시작"}
            </button>
          </div>
        ) : null}

        <form onSubmit={handleSend} className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-raised)] px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3 md:p-3">
          <div className="-mx-1 mb-2 flex touch-pan-x snap-x snap-mandatory gap-1.5 overflow-x-auto overscroll-x-contain scroll-smooth px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="간편 질문">
            {MEMBER_QUICK_QUESTIONS.map((question) => (
              <button
                key={question.label}
                type="button"
                data-support-quick-question={question.label}
                onClick={() => void handleQuickQuestion(question.label)}
                disabled={isClosed || chat.isSending}
                className="inline-flex min-h-11 shrink-0 snap-start items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-[11px] font-bold text-[var(--text-muted)] transition-all duration-200 ease-out hover:border-[var(--border-strong)] hover:bg-[var(--surface)] hover:text-[var(--text-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span aria-hidden="true">{question.icon}</span>
                {question.label}
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--input-surface)] p-2 shadow-sm transition-all duration-200 focus-within:border-[var(--border-strong)] focus-within:ring-2 focus-within:ring-[var(--accent-surface)]">
            <label htmlFor="floating-support-message" className="sr-only">운영팀에 보낼 메시지</label>
            <textarea
              id="floating-support-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
              rows={2}
              disabled={isClosed || chat.isSending}
              placeholder={isClosed ? "종료된 상담입니다." : "문의 내용을 입력하세요"}
              className="w-full resize-none border-0 bg-transparent px-1.5 py-1 text-sm font-medium leading-6 text-[var(--text-strong)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed"
            />
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--border)] px-1 pt-2">
              <span className="font-mono text-[10px] font-bold tabular-nums tracking-tight text-[var(--text-muted)]">{draft.length.toLocaleString("ko-KR")} / {MAX_SUPPORT_MESSAGE_LENGTH.toLocaleString("ko-KR")}</span>
              <button type="submit" disabled={!draft.trim() || chat.isSending || isClosed} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 text-xs font-black text-[var(--accent-contrast)] shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--accent-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
                {chat.isSending ? "전송 중…" : "보내기"}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Z" strokeLinejoin="round" /><path d="M7 12h14" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>
        </form>
      </section>
    </>
  );
}

function FloatingMessageSkeleton() {
  return (
    <div role="status" aria-label="상담을 불러오는 중" className="space-y-3 py-3">
      <span className="sr-only">상담을 불러오는 중…</span>
      <div className="commerce-skeleton h-12 w-3/4 rounded-2xl rounded-bl-sm" />
      <div className="commerce-skeleton ml-auto h-14 w-1/2 rounded-2xl rounded-br-sm" />
      <div className="commerce-skeleton h-10 w-2/3 rounded-2xl rounded-bl-sm" />
    </div>
  );
}
