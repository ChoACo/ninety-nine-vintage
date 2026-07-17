"use client";

import { FormEvent, useMemo, useState } from "react";
import type { ChatThread } from "@/src/types/auction";
import { formatKoreanTime } from "@/src/utils/formatters";

interface ChatPageProps {
  threads: ChatThread[];
  onSendMessage: (threadId: string, text: string) => void | Promise<void>;
}

export function ChatPage({ threads, onSendMessage }: ChatPageProps) {
  const [selectedId, setSelectedId] = useState(threads[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? threads[0],
    [selectedId, threads],
  );

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();

    if (!text || !selectedThread || isSending) return;

    setIsSending(true);
    try {
      await onSendMessage(selectedThread.id, text);
      setDraft("");
    } finally {
      setIsSending(false);
    }
  };

  if (!selectedThread) {
    return (
      <section className="rounded-[2rem] border border-[#eadfd2] bg-white/80 p-10 text-center text-[#85776e]">
        아직 시작된 대화가 없어요.
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-[#eadfd2] bg-white/85 shadow-[0_24px_70px_rgba(118,92,68,0.09)] backdrop-blur">
      <div className="grid min-h-[620px] lg:grid-cols-[320px_1fr]">
        <aside className="border-b border-[#eee3d7] bg-[#fffaf4] lg:border-b-0 lg:border-r">
          <div className="px-6 pb-4 pt-7">
            <p className="text-xs font-semibold tracking-[0.18em] text-[#c27768]">PRIVATE CHAT</p>
            <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-[#453d38]">대화함</h2>
            <p className="mt-1 text-base text-[#8c7e74]">운영자와 경매 소식을 나눠보세요.</p>
          </div>

          <div className="flex gap-2 overflow-x-auto px-3 pb-4 lg:block lg:space-y-1 lg:overflow-visible">
            {threads.map((thread) => {
              const isActive = thread.id === selectedThread.id;

              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedId(thread.id)}
                  className={`relative flex min-w-[270px] items-center gap-3 rounded-2xl p-3 text-left transition lg:min-w-0 lg:w-full ${
                    isActive
                      ? "bg-white shadow-[0_10px_32px_rgba(108,82,60,0.1)]"
                      : "hover:bg-white/70"
                  }`}
                  aria-pressed={isActive}
                >
                  <span
                    className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-sm font-bold text-white"
                    style={{ backgroundColor: thread.accent }}
                    aria-hidden="true"
                  >
                    {thread.initials}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[17px] font-bold text-[#4f453f]">{thread.name}</span>
                      <time
                        dateTime={thread.lastMessageAt}
                        className="shrink-0 text-sm font-medium text-[#8f8178]"
                      >
                        {formatKoreanTime(thread.lastMessageAt)}
                      </time>
                    </span>
                    <span className="mt-0.5 block text-base font-bold text-[#81766f]">
                      공식 상담 채널
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-base text-[#756960]">{thread.lastMessage}</span>
                      {thread.unread > 0 && (
                        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[#ee8f7d] px-1.5 text-sm font-bold text-white">
                          {thread.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="flex min-h-[520px] flex-col bg-[linear-gradient(180deg,#fffdf9_0%,#fff8f1_100%)]">
          <header className="flex items-center gap-3 border-b border-[#eee4da] bg-white/70 px-5 py-4 backdrop-blur md:px-7">
            <span
              className="grid h-11 w-11 place-items-center rounded-2xl text-sm font-bold text-white"
              style={{ backgroundColor: selectedThread.accent }}
              aria-hidden="true"
            >
              {selectedThread.initials}
            </span>
            <div>
              <h3 className="text-[17px] font-bold text-[#4a403a]">{selectedThread.name}</h3>
              <p className="mt-0.5 text-base font-bold text-[#81766f]">
                메시지를 남기면 확인 후 답변드려요
              </p>
            </div>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-7 md:px-8" aria-live="polite">
            <p className="mx-auto w-fit rounded-full bg-[#efe8df] px-3 py-1 text-[11px] font-medium text-[#8c7c70]">
              오늘
            </p>

            {selectedThread.messages.map((message) => {
              const isMine = message.sender === "me";
              const sentTime = new Intl.DateTimeFormat("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(new Date(message.sentAt));

              return (
                <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[82%] ${isMine ? "items-end" : "items-start"} flex flex-col`}>
                    <p
                      className={`whitespace-pre-line rounded-[1.35rem] px-4 py-3 text-[17px] leading-7 shadow-sm ${
                        isMine
                          ? "rounded-br-md bg-[#e98775] text-white"
                          : "rounded-bl-md border border-[#eadfd5] bg-white text-[#554a43]"
                      }`}
                    >
                      {message.text}
                    </p>
                    <time className="mt-1.5 px-1 text-[10px] text-[#9c8e84]" dateTime={message.sentAt}>
                      {sentTime}
                    </time>
                  </div>
                </div>
              );
            })}
          </div>

          <form onSubmit={handleSend} className="border-t border-[#eee3d9] bg-white/80 p-4 md:p-5">
            <div className="flex items-center gap-2 rounded-2xl border border-[#e8dbcf] bg-[#fffdf9] p-2 focus-within:border-[#df9a89] focus-within:ring-4 focus-within:ring-[#f6ded7]">
              <label htmlFor="chat-message" className="sr-only">
                메시지 입력
              </label>
              <input
                id="chat-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="메시지를 입력하세요"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[17px] text-[#51463f] outline-none placeholder:text-[#b4a69c]"
              />
              <button
                type="submit"
                disabled={!draft.trim() || isSending}
                className="rounded-xl bg-[#e98775] px-4 py-2.5 text-base font-bold text-white transition hover:bg-[#d97867] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSending ? "전송 중" : "보내기"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
