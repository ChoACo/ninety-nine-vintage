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
        className="fixed bottom-[6.25rem] right-4 z-[71] flex min-h-16 items-center gap-2 rounded-full border-2 border-white bg-[#df806f] px-4 text-[17px] font-black text-white shadow-[0_14px_38px_rgba(136,76,63,0.32)] md:bottom-6 md:right-6"
        aria-expanded={isOpen}
        aria-controls="floating-support-chat"
        aria-label={isOpen ? "운영팀 상담 닫기" : "운영팀 상담 열기"}
      >
        <span className="text-2xl" aria-hidden="true">{isOpen ? "×" : "💬"}</span>
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
        className="fixed inset-x-3 bottom-[10.75rem] z-[70] flex max-h-[min(68dvh,560px)] origin-bottom-right flex-col overflow-hidden rounded-[1.6rem] border border-[#d9cec4] bg-[#fffdf9] shadow-[0_24px_80px_rgba(52,43,37,0.28)] sm:left-auto sm:right-5 sm:w-[390px] md:bottom-24 md:right-6"
      >
        <header className="flex items-center gap-3 border-b border-[#e9ddd2] bg-[#fff5ec] px-4 py-3.5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#d47d6b] text-sm font-black text-white" aria-hidden="true">운영</span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-black text-[#493f39]">다미네 운영팀</h2>
            <p className="mt-0.5 text-sm font-bold text-[#81766f]">회원님만 볼 수 있는 비공개 상담</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full border border-[#dfd2c7] bg-white text-xl text-[#675a52]" aria-label="상담 닫기">×</button>
        </header>

        {chat.error && (
          <div role="alert" className="bg-[#fff0ec] px-4 py-2 text-sm font-bold text-[#a75042]">{chat.error}</div>
        )}

        <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[linear-gradient(180deg,#fffdfa_0%,#fff8f1_100%)] px-4 py-4" aria-live="polite">
          {chat.isLoading ? (
            <p className="py-8 text-center text-sm font-bold text-[#81766f]">상담을 불러오는 중…</p>
          ) : chat.messages.length === 0 ? (
            <p className="rounded-2xl border border-[#eadfd5] bg-white px-4 py-5 text-center text-[16px] font-bold leading-7 text-[#74675f]">궁금한 내용을 남기면 운영팀이 확인 후 답변해 드려요.</p>
          ) : (
            chat.messages.map((message) => {
              const isMine = message.senderId === userId;
              return (
                <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                  <div className={`flex max-w-[86%] flex-col ${isMine ? "items-end" : "items-start"}`}>
                    <p className={`whitespace-pre-wrap break-words rounded-[1.2rem] px-3.5 py-2.5 text-[16px] leading-6 shadow-sm ${
                      isMine
                        ? "rounded-br-md bg-[#df806f] text-white"
                        : "rounded-bl-md border border-[#eadfd5] bg-white text-[#554a43]"
                    }`}>{message.body}</p>
                    <time dateTime={message.createdAt} className="mt-1 px-1 text-xs font-medium text-[#8f8178]">{formatKoreanTime(message.createdAt)}</time>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {isClosed ? (
          <div className="flex items-center justify-between gap-3 border-t border-[#eadfd5] bg-[#fff5ec] px-4 py-3">
            <p className="text-sm font-bold text-[#7d6e65]">이전 상담이 종료되었습니다.</p>
            <button
              type="button"
              onClick={() => void chat.reopenConversation()}
              disabled={chat.isReopening}
              className="shrink-0 rounded-xl bg-[#df806f] px-3 py-2 text-sm font-black text-white disabled:opacity-50"
            >
              {chat.isReopening ? "여는 중…" : "새 문의 시작"}
            </button>
          </div>
        ) : null}

        <form onSubmit={handleSend} className="border-t border-[#e9ddd2] bg-white p-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
            rows={2}
            disabled={isClosed || chat.isSending}
            placeholder={isClosed ? "종료된 상담입니다." : "문의 내용을 입력하세요"}
            className="w-full resize-none rounded-2xl border border-[#dfd2c7] bg-[#fffdf9] px-3 py-2 text-[16px] leading-6 text-[#4f453f] outline-none focus:border-[#db8c7a] focus:ring-4 focus:ring-[#f5ded7] disabled:bg-[#f3eee9]"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#91847b]">{draft.length} / {MAX_SUPPORT_MESSAGE_LENGTH}</span>
            <button type="submit" disabled={!draft.trim() || chat.isSending || isClosed} className="rounded-xl bg-[#df806f] px-4 py-2 text-[15px] font-black text-white disabled:opacity-40">
              {chat.isSending ? "전송 중…" : "보내기"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
