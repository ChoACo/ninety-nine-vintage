"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useMemberSupportChat } from "@/src/hooks/useSupportChat";
import {
  MAX_SUPPORT_MESSAGE_LENGTH,
  type SupportViewerRole,
} from "@/src/lib/supabase/supportChat";
import { formatKoreanTime } from "@/src/utils/formatters";

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
        className="fixed bottom-[6.25rem] right-4 z-[71] flex min-h-12 items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--accent)] px-3.5 text-sm font-black text-[var(--accent-contrast)] shadow-[0_12px_30px_rgba(20,19,18,0.24)] transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--accent-hover)] hover:shadow-lg md:bottom-6 md:right-6"
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

  return (
    <>
      <section
        id="floating-support-chat"
        role="dialog"
        aria-label="운영팀 비공개 상담"
        className="fixed inset-x-3 bottom-[10.25rem] z-[70] flex max-h-[min(68dvh,560px)] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-[0_24px_80px_rgba(20,19,18,0.3)] sm:left-auto sm:right-5 sm:w-[390px] md:bottom-20 md:right-6"
      >
        <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4.5"><path d="M5 5.5h14v10H9l-4 3v-13Z" strokeLinejoin="round" /></svg></span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-black text-[var(--text-strong)]">나인티 나인 빈티지 운영팀</h2>
            <p className="mt-0.5 text-xs font-semibold text-[var(--text-muted)]">회원님만 볼 수 있는 비공개 상담</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)] transition-all duration-200 hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]" aria-label="상담 닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" /></svg></button>
        </header>

        {chat.error && (
          <div role="alert" className="border-b border-[var(--border)] bg-[var(--danger-surface)] px-4 py-2 text-xs font-bold text-[var(--danger-text)]">{chat.error}</div>
        )}

        <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[var(--surface)] px-4 py-4 [scrollbar-gutter:stable]" aria-live="polite">
          {chat.isLoading ? (
            <FloatingMessageSkeleton />
          ) : chat.messages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-6 text-center"><span className="mx-auto grid size-9 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--text-muted)]" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4"><path d="M5 5.5h14v10H9l-4 3v-13Z" strokeLinejoin="round" /></svg></span><p className="mt-3 text-sm font-black text-[var(--text-strong)]">첫 문의를 남겨주세요</p><p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-muted)]">운영팀이 확인 후 이곳에서 답변해 드립니다.</p></div>
          ) : (
            chat.messages.map((message) => {
              const isMine = message.senderId === userId;
              return (
                <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                  <div className={`flex max-w-[86%] flex-col ${isMine ? "items-end" : "items-start"}`}>
                    <p className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm font-medium leading-6 shadow-sm ${
                      isMine
                        ? "rounded-br-sm bg-[var(--accent)] text-[var(--accent-contrast)]"
                        : "rounded-bl-sm border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-strong)]"
                    }`}>{message.body}</p>
                    <time dateTime={message.createdAt} className="mt-1 px-1 font-mono text-[9px] font-medium tabular-nums text-[var(--text-muted)]">{formatKoreanTime(message.createdAt)}</time>
                  </div>
                </div>
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

        <form onSubmit={handleSend} className="border-t border-[var(--border)] bg-[var(--surface-raised)] p-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
            rows={2}
            disabled={isClosed || chat.isSending}
            placeholder={isClosed ? "종료된 상담입니다." : "문의 내용을 입력하세요"}
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 py-2 text-sm font-medium leading-6 text-[var(--text-strong)] outline-none transition-all duration-200 focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)] disabled:bg-[var(--surface-muted)]"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">{draft.length.toLocaleString("ko-KR")} / {MAX_SUPPORT_MESSAGE_LENGTH.toLocaleString("ko-KR")}</span>
            <button type="submit" disabled={!draft.trim() || chat.isSending || isClosed} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-black text-[var(--accent-contrast)] shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--accent-hover)] disabled:opacity-40">
              {chat.isSending ? "전송 중…" : "보내기"}
            </button>
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
