"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { ChatThread } from "@/src/types/auction";
import { formatKoreanTime } from "@/src/utils/formatters";

interface FloatingAdminChatProps {
  thread: ChatThread | undefined;
  onSendMessage: (threadId: string, text: string) => void | Promise<void>;
}

export function FloatingAdminChat({ thread, onSendMessage }: FloatingAdminChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const messagesElement = messagesRef.current;
    if (messagesElement) {
      messagesElement.scrollTop = messagesElement.scrollHeight;
    }
  }, [isOpen, thread?.messages.length]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();

    if (!thread || !text || isSending) return;

    setIsSending(true);
    try {
      await onSendMessage(thread.id, text);
      setDraft("");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <section
        id="floating-admin-chat"
        role="dialog"
        aria-label="관리자 직통 1대1 채팅"
        aria-hidden={!isOpen}
        className={`fixed inset-x-3 bottom-[10.75rem] z-[70] flex max-h-[min(68dvh,560px)] origin-bottom-right flex-col overflow-hidden rounded-[1.6rem] border border-[#d9cec4] bg-[#fffdf9] shadow-[0_24px_80px_rgba(52,43,37,0.28)] transition-all duration-200 ease-out sm:left-auto sm:right-5 sm:w-[390px] md:bottom-24 md:right-6 ${
          isOpen
            ? "translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-3 scale-95 opacity-0"
        }`}
      >
        <header className="flex items-center gap-3 border-b border-[#e9ddd2] bg-[#fff5ec] px-4 py-3.5">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-base font-black text-white shadow-sm"
            style={{ backgroundColor: thread?.accent ?? "#d98775" }}
            aria-hidden="true"
          >
            {thread?.initials ?? "다미"}
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-black text-[#493f39]">
              {thread?.name ?? "다미네 구제 관리자"}
            </h2>
            <p
              className={`mt-0.5 text-base font-bold ${
                thread?.online ? "text-[#3f8068]" : "text-[#81766f]"
              }`}
            >
              {thread?.online ? "🟢 온라인" : "⚪ 오프라인"}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#dfd2c7] bg-white text-2xl font-medium text-[#675a52] transition hover:bg-[#f5ebe2] focus:outline-none focus:ring-4 focus:ring-[#efd8cf]"
            aria-label="관리자 채팅 닫기"
          >
            ×
          </button>
        </header>

        <div
          ref={messagesRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[linear-gradient(180deg,#fffdfa_0%,#fff8f1_100%)] px-4 py-4"
          aria-live="polite"
        >
          {!thread || thread.messages.length === 0 ? (
            <p className="rounded-2xl border border-[#eadfd5] bg-white px-4 py-5 text-center text-[17px] leading-7 text-[#74675f]">
              궁금한 내용을 남겨주세요.
              <br />
              관리자가 확인 후 답변해 드려요.
            </p>
          ) : (
            thread.messages.map((message) => {
              const isMine = message.sender === "me";

              return (
                <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                  <div className={`flex max-w-[86%] flex-col ${isMine ? "items-end" : "items-start"}`}>
                    <p
                      className={`whitespace-pre-line rounded-[1.2rem] px-3.5 py-2.5 text-[17px] leading-6 shadow-sm ${
                        isMine
                          ? "rounded-br-md bg-[#e98775] text-white"
                          : "rounded-bl-md border border-[#eadfd5] bg-white text-[#554a43]"
                      }`}
                    >
                      {message.text}
                    </p>
                    <time
                      dateTime={message.sentAt}
                      className="mt-1 px-1 text-sm font-medium text-[#8f8178]"
                    >
                      {formatKoreanTime(message.sentAt)}
                    </time>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={handleSend} className="border-t border-[#e9ddd2] bg-white p-3">
          <label htmlFor="floating-chat-message" className="sr-only">
            관리자에게 보낼 메시지
          </label>
          <div className="flex items-center gap-2 rounded-2xl border border-[#dfd2c7] bg-[#fffdf9] p-1.5 focus-within:border-[#db8c7a] focus-within:ring-4 focus-within:ring-[#f5ded7]">
            <input
              id="floating-chat-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="문의 내용을 입력하세요"
              disabled={!thread || isSending}
              className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[17px] text-[#4f453f] outline-none placeholder:text-[#a99b91] disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!thread || !draft.trim() || isSending}
              className="min-h-11 shrink-0 rounded-xl bg-[#df806f] px-4 text-[17px] font-black text-white transition hover:bg-[#cf705f] focus:outline-none focus:ring-4 focus:ring-[#f2d0c8] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSending ? "전송 중" : "보내기"}
            </button>
          </div>
        </form>
      </section>

      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="fixed bottom-[6.25rem] right-4 z-[71] flex min-h-16 items-center gap-2 rounded-full border-2 border-white bg-[#df806f] px-4 text-[17px] font-black text-white shadow-[0_14px_38px_rgba(136,76,63,0.32)] transition hover:-translate-y-0.5 hover:bg-[#cf705f] focus:outline-none focus:ring-4 focus:ring-[#efc7bd] md:bottom-6 md:right-6"
        aria-expanded={isOpen}
        aria-controls="floating-admin-chat"
        aria-label={isOpen ? "관리자 직통 채팅 닫기" : "관리자 직통 채팅 열기"}
      >
        <span className="text-2xl" aria-hidden="true">
          {isOpen ? "×" : "💬"}
        </span>
        <span className="hidden sm:inline">관리자 직통</span>
        {!isOpen && Boolean(thread?.unread) && (
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white px-1.5 text-sm font-black text-[#c65f50]">
            {thread?.unread}
          </span>
        )}
      </button>
    </>
  );
}
