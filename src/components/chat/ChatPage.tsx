"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useMemberSupportChat } from "@/src/hooks/useSupportChat";
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
    return <ChatAccessState title="로그인 정보를 확인하고 있어요" description="잠시만 기다려 주세요." />;
  }

  if (isSupportStaffRole(role)) {
    return <StaffChatInbox key={userId} staffId={userId} role={role} />;
  }

  return <MemberChat key={userId} userId={userId} />;
}

function MemberChat({ userId }: { userId: string }) {
  const chat = useMemberSupportChat(userId);
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
    return <ChatAccessState title="운영팀 대화를 불러오는 중이에요…" description="회원님의 비공개 상담함을 준비하고 있습니다." />;
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
    <section className="overflow-hidden rounded-[2rem] border border-[#eadfd2] bg-white/85 shadow-[0_24px_70px_rgba(118,92,68,0.09)] backdrop-blur">
      <div className="flex min-h-[620px] flex-col bg-[linear-gradient(180deg,#fffdf9_0%,#fff8f1_100%)]">
        <header className="flex items-center gap-4 border-b border-[#eee4da] bg-[#fff8f0]/90 px-5 py-5 md:px-8">
          <span className="grid h-13 w-13 shrink-0 place-items-center rounded-2xl bg-[#cf7b69] text-sm font-black text-white" aria-hidden="true">
            운영
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black tracking-[0.16em] text-[#bd6f5e]">PRIVATE SUPPORT</p>
            <h2 className="mt-0.5 text-xl font-black text-[#493f38]">다미네 운영팀</h2>
            <p className="mt-0.5 text-sm font-bold text-[#81746b]">이 대화는 회원님과 운영팀만 볼 수 있어요.</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${isClosed ? "bg-[#ece7e2] text-[#81766e]" : "bg-[#e4f1e8] text-[#4a7758]"}`}>
            {isClosed ? "상담 종료" : chat.conversation ? "상담 중" : "새 문의"}
          </span>
          {isClosed ? (
            <button
              type="button"
              onClick={() => void chat.reopenConversation()}
              disabled={chat.isReopening}
              className="rounded-xl bg-[#df806f] px-3 py-2 text-sm font-black text-white disabled:opacity-50"
            >
              {chat.isReopening ? "여는 중…" : "새 문의 시작"}
            </button>
          ) : null}
        </header>

        {chat.error && (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-[#f0c9bf] bg-[#fff0ec] px-5 py-2.5 text-sm font-bold text-[#a75042]">
            <span>{chat.error}</span>
            <button type="button" onClick={() => void chat.retry()} className="shrink-0 underline">
              다시 시도
            </button>
          </div>
        )}

        <div ref={messagesRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-7 md:px-8" aria-live="polite">
          {chat.messages.length === 0 ? (
            <div className="mx-auto mt-12 max-w-md rounded-3xl border border-dashed border-[#ddcfc3] bg-white/70 p-7 text-center">
              <p className="text-lg font-black text-[#564a42]">운영팀에 궁금한 점을 남겨주세요</p>
              <p className="mt-2 break-keep text-sm font-bold leading-6 text-[#82746a]">주문, 입찰, 배송과 관련된 문의에 순서대로 답변드려요.</p>
            </div>
          ) : (
            chat.messages.map((message) => {
              const isMine = message.senderId === userId;

              return (
                <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                  <div className={`flex max-w-[82%] flex-col ${isMine ? "items-end" : "items-start"}`}>
                    {!isMine && <span className="mb-1 px-1 text-xs font-bold text-[#8e8076]">운영팀</span>}
                    <p className={`whitespace-pre-wrap break-words rounded-[1.35rem] px-4 py-3 text-[17px] leading-7 shadow-sm ${
                      isMine
                        ? "rounded-br-md bg-[#e18472] text-white"
                        : "rounded-bl-md border border-[#eadfd5] bg-white text-[#554a43]"
                    }`}>
                      {message.body}
                    </p>
                    <time className="mt-1.5 px-1 text-xs font-medium text-[#91847b]" dateTime={message.createdAt}>
                      {formatKoreanTime(message.createdAt)}
                    </time>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={handleSend} className="border-t border-[#eee3d9] bg-white/85 p-4 md:p-5">
          <label htmlFor="support-message" className="sr-only">운영팀에 보낼 메시지</label>
          <textarea
            id="support-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
            rows={2}
            disabled={isClosed || chat.isSending}
            placeholder={isClosed ? "종료된 상담입니다. 운영팀이 다시 열면 메시지를 보낼 수 있어요." : "문의 내용을 입력하세요"}
            className="w-full resize-none rounded-2xl border border-[#e1d4c8] bg-[#fffdf9] px-4 py-3 text-[17px] leading-7 text-[#51463f] outline-none placeholder:text-[#a99b91] focus:border-[#df917f] focus:ring-4 focus:ring-[#f5ded7] disabled:cursor-not-allowed disabled:bg-[#f3eee9]"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-[#91847b]">{draft.length.toLocaleString("ko-KR")} / {MAX_SUPPORT_MESSAGE_LENGTH.toLocaleString("ko-KR")}</span>
            <button
              type="submit"
              disabled={!draft.trim() || chat.isSending || isClosed}
              className="rounded-xl bg-[#df806f] px-5 py-2.5 text-base font-black text-white transition hover:bg-[#cf705f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {chat.isSending ? "전송 중…" : "보내기"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function ChatAccessState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className="grid min-h-[420px] place-items-center rounded-[2rem] border border-[#eadfd2] bg-white/80 p-8 text-center shadow-[0_20px_60px_rgba(93,72,56,0.08)]">
      <div className="max-w-md">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-[#fff0e7] text-3xl" aria-hidden="true">💬</span>
        <h2 className="mt-5 text-2xl font-black text-[#493f38]">{title}</h2>
        <p className="mt-2 break-keep text-[17px] font-bold leading-7 text-[#82746a]">{description}</p>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="mt-6 rounded-xl bg-[#df806f] px-6 py-3 text-[17px] font-black text-white">
            {actionLabel}
          </button>
        )}
      </div>
    </section>
  );
}
