"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useStaffSupportInbox } from "@/src/hooks/useSupportChat";
import {
  fetchSupportOperators,
  MAX_SUPPORT_MESSAGE_LENGTH,
  type SupportOperator,
  type SupportStaffRole,
} from "@/src/lib/supabase/supportChat";
import { formatKoreanTime } from "@/src/utils/formatters";

interface StaffChatInboxProps {
  staffId: string;
  role: SupportStaffRole;
}

type InboxFilter = "all" | "unread" | "open" | "closed";

const filters: Array<{ value: InboxFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "unread", label: "안 읽음" },
  { value: "open", label: "상담 중" },
  { value: "closed", label: "종료" },
];

export function StaffChatInbox({ staffId, role }: StaffChatInboxProps) {
  const isAuditMode = role === "admin";
  const [operators, setOperators] = useState<SupportOperator[]>([]);
  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(
    role === "operator" ? staffId : null,
  );
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const inboxOperatorId = role === "operator" ? staffId : selectedOperatorId;
  const chat = useStaffSupportInbox(staffId, inboxOperatorId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [draft, setDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuditMode) return;

    let active = true;
    void fetchSupportOperators()
      .then((items) => {
        if (!active) return;
        setOperators(items);
        setSelectedOperatorId((current) =>
          current && items.some((item) => item.id === current)
            ? current
            : items[0]?.id ?? null,
        );
        setOperatorError(null);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setOperatorError(
          loadError instanceof Error
            ? loadError.message
            : "운영자 목록을 불러오지 못했어요.",
        );
      });

    return () => {
      active = false;
    };
  }, [isAuditMode, staffId]);

  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

    return chat.conversations.filter((conversation) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "unread" && conversation.isUnread) ||
        conversation.status === filter;
      const memberName = conversation.member?.displayName ?? conversation.memberId;
      const matchesQuery =
        !normalizedQuery ||
        memberName.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
        conversation.lastMessagePreview
          ?.toLocaleLowerCase("ko-KR")
          .includes(normalizedQuery);

      return matchesFilter && Boolean(matchesQuery);
    });
  }, [chat.conversations, filter, query]);

  const selectedConversationId = chat.selectedConversation?.id;
  const messageCount = chat.messages.length;
  const markRead = chat.markRead;

  useEffect(() => {
    if (!selectedConversationId) return;
    void markRead();
  }, [markRead, messageCount, selectedConversationId]);

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat.messages.length, chat.selectedConversationId]);

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || chat.isSending || isAuditMode) return;

    try {
      await chat.sendMessage(text);
      setDraft("");
    } catch {
      // The hook exposes a user-facing error message.
    }
  };

  if (chat.isLoading) {
    return <ChatState message="상담 대화함을 불러오는 중이에요…" />;
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-[#dfd3c7] bg-white/90 shadow-[0_24px_70px_rgba(91,70,53,0.12)]">
      <div className="grid min-h-[650px] lg:grid-cols-[350px_1fr]">
        <aside className="border-b border-[#eadfd5] bg-[#fff8f0] lg:border-b-0 lg:border-r">
          <div className="border-b border-[#eadfd5] p-5">
            <p className="text-xs font-black tracking-[0.16em] text-[#b96d5d]">
              {isAuditMode ? "OPERATOR INBOX REVIEW" : "OPERATOR SUPPORT"}
            </p>
            <h2 className="mt-1 text-2xl font-black text-[#473d36]">
              {isAuditMode ? "운영자별 상담함" : "내 상담함"}
            </h2>
            <p className="mt-1 text-sm font-bold text-[#85766c]">
              {isAuditMode
                ? "운영자를 선택해 배정된 대화를 읽기 전용으로 확인합니다."
                : "내게 배정된 회원 문의와 내부 대화만 표시됩니다."}
            </p>

            {isAuditMode ? (
              <div className="mt-4" aria-label="확인할 운영자 상담함">
                <p className="mb-2 text-sm font-black text-[#6f6057]">운영자 선택</p>
                <div className="flex flex-wrap gap-2">
                  {operators.map((operator) => (
                    <button
                      key={operator.id}
                      type="button"
                      onClick={() => setSelectedOperatorId(operator.id)}
                      className={`rounded-full px-3 py-2 text-sm font-black ${
                        selectedOperatorId === operator.id
                          ? "bg-[#6f7f72] text-white"
                          : "border border-[#ddcfc3] bg-white text-[#6f6057]"
                      }`}
                    >
                      {operator.displayName}
                    </button>
                  ))}
                </div>
                {operatorError ? (
                  <p className="mt-2 text-sm font-bold text-[#a85143]" role="alert">
                    {operatorError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <label htmlFor="support-search" className="sr-only">
              회원 또는 메시지 검색
            </label>
            <input
              id="support-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="회원명 또는 메시지 검색"
              className="mt-4 w-full rounded-xl border border-[#dfd1c4] bg-white px-3 py-2.5 text-base text-[#4d423b] outline-none focus:border-[#d78371] focus:ring-4 focus:ring-[#f3d9d2]"
            />

            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="상담 필터">
              {filters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  className={`rounded-full px-3 py-1.5 text-sm font-black ${
                    filter === item.value
                      ? "bg-[#d97d6b] text-white"
                      : "border border-[#e2d5c9] bg-white text-[#75665c]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[440px] space-y-1 overflow-y-auto p-2 lg:max-h-[495px]">
            {visibleConversations.length === 0 ? (
              <p className="m-3 rounded-2xl border border-dashed border-[#ddcfc3] bg-white/65 p-5 text-center text-sm font-bold leading-6 text-[#81736a]">
                조건에 맞는 상담이 없습니다.
              </p>
            ) : (
              visibleConversations.map((conversation) => {
                const memberName =
                  conversation.member?.displayName ??
                  `${conversation.conversationType === "internal" ? "직원" : "회원"} ${conversation.memberId.slice(0, 6)}`;
                const selected = conversation.id === chat.selectedConversationId;

                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => chat.selectConversation(conversation.id)}
                    className={`w-full rounded-2xl p-3 text-left transition ${
                      selected
                        ? "bg-white shadow-[0_8px_24px_rgba(97,73,55,0.10)]"
                        : "hover:bg-white/70"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[17px] font-black text-[#4c413a]">
                        {memberName}
                      </span>
                      {conversation.isUnread && (
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#df725f]" aria-label="안 읽음" />
                      )}
                      <span className="ml-auto shrink-0 text-xs font-bold text-[#92847a]">
                        {conversation.lastMessageAt
                          ? formatKoreanTime(conversation.lastMessageAt)
                          : "새 상담"}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-sm font-medium text-[#75685f]">
                      {conversation.lastMessagePreview ?? "아직 메시지가 없습니다."}
                    </span>
                    <span className="mt-1 block truncate text-xs font-bold text-[#9a756b]">
                      {conversation.conversationType === "product"
                        ? `상품 문의 · ${conversation.subject ?? "상품"}`
                        : conversation.conversationType === "internal"
                          ? "직원 내부 대화"
                          : "일반 상담"}
                    </span>
                    <span className="mt-2 flex items-center justify-between text-xs font-bold">
                      <span className={conversation.status === "open" ? "text-[#438262]" : "text-[#91857d]"}>
                        {conversation.status === "open" ? "상담 중" : "상담 종료"}
                      </span>
                      <span className="text-[#9a756b]">
                        {conversation.assignedStaffId === staffId
                          ? "내 담당"
                          : conversation.assignedStaff?.displayName ?? "담당 운영자"}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {!chat.selectedConversation ? (
          <ChatState message="왼쪽에서 상담을 선택해 주세요." compact />
        ) : (
          <div className="flex min-h-[560px] min-w-0 flex-col bg-[linear-gradient(180deg,#fffdf9_0%,#fff8f1_100%)]">
            <header className="flex flex-wrap items-center gap-3 border-b border-[#eadfd5] bg-white/75 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-black text-[#493f38]">
                  {chat.selectedConversation.member?.displayName ??
                    `${chat.selectedConversation.conversationType === "internal" ? "직원" : "회원"} ${chat.selectedConversation.memberId.slice(0, 6)}`}
                </h3>
                <p className="text-sm font-bold text-[#887a70]">
                  {chat.selectedConversation.conversationType === "internal"
                    ? "직원과 지정 운영자만 볼 수 있는 내부 대화"
                    : chat.selectedConversation.conversationType === "product"
                      ? `상품 문의 · ${chat.selectedConversation.subject ?? "상품"}`
                      : "회원과 담당 운영자만 볼 수 있는 비공개 상담"}
                </p>
              </div>
              {!isAuditMode ? (
                <button
                  type="button"
                  onClick={() =>
                    void chat.changeConversation({
                      status:
                        chat.selectedConversation?.status === "open" ? "closed" : "open",
                    })
                  }
                  disabled={chat.isUpdating}
                  className="rounded-xl bg-[#6f7f72] px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                >
                  {chat.selectedConversation.status === "open" ? "대화 종료" : "다시 열기"}
                </button>
              ) : (
                <span className="rounded-full bg-[#eee8e2] px-3 py-1.5 text-xs font-black text-[#75685f]">
                  읽기 전용
                </span>
              )}
            </header>

            {chat.error && (
              <div role="alert" className="border-b border-[#efc4ba] bg-[#fff0ec] px-5 py-2 text-sm font-bold text-[#a85143]">
                {chat.error}
              </div>
            )}

            <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-6" aria-live="polite">
              {chat.isMessagesLoading ? (
                <p className="text-center text-sm font-bold text-[#887a70]">메시지를 불러오는 중…</p>
              ) : chat.messages.length === 0 ? (
                <p className="mx-auto max-w-sm rounded-2xl border border-dashed border-[#dfd2c7] bg-white/70 p-5 text-center text-sm font-bold leading-6 text-[#7d7067]">
                  아직 메시지가 없습니다. 첫 안내를 보내보세요.
                </p>
              ) : (
                chat.messages.map((message) => {
                  const isStaffMessage = message.senderId !== chat.selectedConversation?.memberId;
                  const isMine = message.senderId === staffId;

                  return (
                    <div key={message.id} className={`flex ${isStaffMessage ? "justify-end" : "justify-start"}`}>
                      <div className={`flex max-w-[82%] flex-col ${isStaffMessage ? "items-end" : "items-start"}`}>
                        <span className="mb-1 px-1 text-xs font-bold text-[#8f8178]">
                          {isMine
                            ? "나"
                            : isStaffMessage
                              ? "담당 운영자"
                              : chat.selectedConversation?.conversationType === "internal"
                                ? "직원"
                                : "회원"}
                        </span>
                        <p className={`whitespace-pre-wrap break-words rounded-[1.25rem] px-4 py-3 text-[16px] leading-7 shadow-sm ${
                          isStaffMessage
                            ? "rounded-br-md bg-[#d97d6b] text-white"
                            : "rounded-bl-md border border-[#e5d9ce] bg-white text-[#51463f]"
                        }`}>
                          {message.body}
                        </p>
                        <time dateTime={message.createdAt} className="mt-1 px-1 text-xs font-medium text-[#91847b]">
                          {formatKoreanTime(message.createdAt)}
                        </time>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {isAuditMode ? (
              <div className="border-t border-[#eadfd5] bg-[#f4efe9] p-4 text-center text-sm font-bold text-[#75685f]">
                감사 화면에서는 대화를 읽을 수만 있으며 메시지를 보낼 수 없습니다.
              </div>
            ) : (
            <form onSubmit={handleSend} className="border-t border-[#eadfd5] bg-white/85 p-4">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
                rows={2}
                disabled={chat.selectedConversation.status === "closed" || chat.isSending}
                placeholder={chat.selectedConversation.status === "closed" ? "종료된 상담입니다." : "답변을 입력하세요"}
                className="w-full resize-none rounded-2xl border border-[#dfd2c7] bg-[#fffdf9] px-4 py-3 text-[16px] leading-6 text-[#4f453f] outline-none focus:border-[#d78371] focus:ring-4 focus:ring-[#f4dbd4] disabled:cursor-not-allowed disabled:bg-[#f3eee9]"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-[#91847b]">{draft.length.toLocaleString("ko-KR")} / {MAX_SUPPORT_MESSAGE_LENGTH.toLocaleString("ko-KR")}</span>
                <button
                  type="submit"
                  disabled={!draft.trim() || chat.isSending || chat.selectedConversation.status === "closed"}
                  className="rounded-xl bg-[#d97d6b] px-5 py-2.5 text-base font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {chat.isSending ? "전송 중…" : "답변 보내기"}
                </button>
              </div>
            </form>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ChatState({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <div className={`grid place-items-center bg-[#fffaf4] p-8 text-center ${compact ? "min-h-[420px]" : "min-h-[650px] rounded-[2rem] border border-[#e6d9ce]"}`}>
      <p className="text-[17px] font-bold text-[#7d7067]">{message}</p>
    </div>
  );
}
