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
  const [isMobileConversationOpen, setIsMobileConversationOpen] = useState(false);
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
    return <ChatInboxSkeleton />;
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--panel-shadow)]">
      <div className="grid min-h-[650px] md:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] lg:grid-cols-[330px_1fr]">
        <aside
          className={`${isMobileConversationOpen ? "hidden md:block" : "block"} border-b border-[var(--border)] bg-[var(--surface-muted)]/55 md:border-b-0 md:border-r`}
        >
          <div className="border-b border-[var(--border)] p-4">
            <p className="text-[10px] font-black tracking-[0.18em] text-[var(--accent-text)]">
              {isAuditMode ? "OPERATOR INBOX REVIEW" : "OPERATOR SUPPORT"}
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black tracking-[-0.035em] text-[var(--text-strong)]">
              {isAuditMode ? "운영자별 상담함" : "내 상담함"}
            </h2>
              <span className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 font-mono text-[10px] font-black tabular-nums text-[var(--text-muted)]">
                {chat.conversations.length.toLocaleString("ko-KR")}
              </span>
            </div>
            <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-muted)]">
              {isAuditMode
                ? "운영자를 선택해 배정된 대화를 읽기 전용으로 확인합니다."
                : "내게 배정된 회원 문의와 내부 대화만 표시됩니다."}
            </p>

            {isAuditMode ? (
              <div className="mt-3" aria-label="확인할 운영자 상담함">
                <p className="mb-1.5 text-xs font-black text-[var(--text-strong)]">운영자 선택</p>
                <div className="flex flex-wrap gap-1.5">
                  {operators.map((operator) => (
                    <button
                      key={operator.id}
                      type="button"
                      onClick={() => {
                        setSelectedOperatorId(operator.id);
                        setIsMobileConversationOpen(false);
                      }}
                      className={`rounded-md border px-2.5 py-1.5 text-xs font-black transition-all duration-200 ease-out hover:scale-[1.02] ${
                        selectedOperatorId === operator.id
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm"
                          : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
                      }`}
                    >
                      {operator.displayName}
                    </button>
                  ))}
                </div>
                {operatorError ? (
                  <p className="mt-2 text-xs font-bold text-[var(--danger-text)]" role="alert">
                    {operatorError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <label htmlFor="support-search" className="sr-only">
              회원 또는 메시지 검색
            </label>
            <div className="relative mt-3">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]">
                <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" strokeLinecap="round" />
              </svg>
              <input
                id="support-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="회원명 또는 메시지 검색"
                className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] py-2 pl-9 pr-3 text-sm font-semibold text-[var(--text-strong)] outline-none transition-all duration-200 focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)]"
              />
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1" aria-label="상담 필터">
              {filters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-black transition-all duration-200 ease-out ${
                    filter === item.value
                      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                      : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[440px] overflow-y-auto p-2 [scrollbar-gutter:stable] md:max-h-[495px]">
            {visibleConversations.length === 0 ? (
              <ChatEmptyState title="조건에 맞는 상담이 없습니다" description="검색어 또는 상담 상태 필터를 변경해 보세요." compact />
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
                    onClick={() => {
                      chat.selectConversation(conversation.id);
                      setIsMobileConversationOpen(true);
                    }}
                    className={`group w-full rounded-lg border-l-2 px-3 py-2.5 text-left transition-all duration-200 ease-out ${
                      selected
                        ? "border-l-[var(--accent-text)] bg-[var(--surface-raised)] shadow-sm"
                        : "border-l-transparent hover:bg-[var(--surface-raised)]/70"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-black text-[var(--text-strong)]">
                        {memberName}
                      </span>
                      {conversation.isUnread && (
                        <span className="size-2 shrink-0 rounded-full bg-[var(--accent-text)] shadow-[0_0_0_3px_var(--accent-surface)]" aria-label="안 읽음" />
                      )}
                      <span className="ml-auto shrink-0 font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
                        {conversation.lastMessageAt
                          ? formatKoreanTime(conversation.lastMessageAt)
                          : "새 상담"}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-xs font-medium text-[var(--text-muted)]">
                      {conversation.lastMessagePreview ?? "아직 메시지가 없습니다."}
                    </span>
                    <span className="mt-1 block truncate text-[10px] font-bold text-[var(--accent-text)]">
                      {conversation.conversationType === "product"
                        ? `상품 문의 · ${conversation.subject ?? "상품"}`
                        : conversation.conversationType === "internal"
                          ? "직원 내부 대화"
                          : "일반 상담"}
                    </span>
                    <span className="mt-1.5 flex items-center justify-between text-[10px] font-bold">
                      <span className={conversation.status === "open" ? "text-[var(--success-text)]" : "text-[var(--text-muted)]"}>
                        {conversation.status === "open" ? "상담 중" : "상담 종료"}
                      </span>
                      <span className="text-[var(--text-muted)]">
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
          <div className="hidden md:block">
            <ChatState message="왼쪽에서 상담을 선택해 주세요." compact />
          </div>
        ) : (
          <div
            className={`${isMobileConversationOpen ? "flex" : "hidden"} min-h-[560px] min-w-0 flex-col bg-[var(--surface)] md:flex`}
          >
            <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)]/90 px-4 py-3.5 sm:px-5">
              <button
                type="button"
                onClick={() => setIsMobileConversationOpen(false)}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-left text-xs font-black text-[var(--accent-text)] transition-all duration-200 hover:border-[var(--border-strong)] md:hidden"
                aria-label="상담 목록으로 돌아가기"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-4 w-4"
                >
                  <path
                    d="m15 18-6-6 6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                상담 목록
              </button>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-black tracking-[-0.02em] text-[var(--text-strong)]">
                  {chat.selectedConversation.member?.displayName ??
                    `${chat.selectedConversation.conversationType === "internal" ? "직원" : "회원"} ${chat.selectedConversation.memberId.slice(0, 6)}`}
                </h3>
                <p className="mt-0.5 truncate text-xs font-semibold text-[var(--text-muted)]">
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
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs font-black text-[var(--text-strong)] transition-all duration-200 ease-out hover:scale-[1.02] hover:border-[var(--border-strong)] hover:shadow-sm disabled:opacity-50"
                >
                  {chat.selectedConversation.status === "open" ? "대화 종료" : "다시 열기"}
                </button>
              ) : (
                <span className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-[10px] font-black text-[var(--text-muted)]">
                  읽기 전용
                </span>
              )}
            </header>

            {chat.selectedConversation.conversationType === "product" ? (
              <div className="border-b border-[var(--border)] bg-[var(--surface-muted)]/55 px-4 py-2.5 sm:px-5">
                <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-2.5">
                  {chat.selectedConversation.productImageUrlSnapshot ? (
                    // The Storage public URL is dynamic per product and is shown
                    // as a small, lazy-loaded support-context thumbnail.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={chat.selectedConversation.productImageUrlSnapshot}
                      alt={`${chat.selectedConversation.productTitleSnapshot ?? chat.selectedConversation.subject ?? "문의 상품"} 사진`}
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
                      PRODUCT INQUIRY
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-sm font-black text-[var(--text-strong)]">
                      {chat.selectedConversation.productTitleSnapshot ??
                        chat.selectedConversation.subject ??
                        "문의 상품"}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
                      상품번호 {chat.selectedConversation.productId?.slice(0, 8) ?? "확인 불가"}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {chat.error && (
              <div role="alert" className="border-b border-[var(--border)] bg-[var(--danger-surface)] px-5 py-2 text-xs font-bold text-[var(--danger-text)]">
                {chat.error}
              </div>
            )}

            <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5 [scrollbar-gutter:stable] sm:px-6" aria-live="polite">
              {chat.isMessagesLoading ? (
                <MessageSkeleton />
              ) : chat.messages.length === 0 ? (
                <ChatEmptyState title="아직 메시지가 없습니다" description="첫 안내를 보내 상담을 시작해 보세요." />
              ) : (
                chat.messages.map((message) => {
                  const isStaffMessage = message.senderId !== chat.selectedConversation?.memberId;
                  const isMine = message.senderId === staffId;

                  return (
                    <div key={message.id} className={`flex ${isStaffMessage ? "justify-end" : "justify-start"}`}>
                      <div className={`flex max-w-[82%] flex-col ${isStaffMessage ? "items-end" : "items-start"}`}>
                        <span className="mb-1 px-1 text-[10px] font-bold text-[var(--text-muted)]">
                          {isMine
                            ? "나"
                            : isStaffMessage
                              ? "담당 운영자"
                              : chat.selectedConversation?.conversationType === "internal"
                                ? "직원"
                                : "회원"}
                        </span>
                        <p className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm font-medium leading-6 shadow-sm ${
                          isStaffMessage
                            ? "rounded-br-sm bg-[var(--accent)] text-[var(--accent-contrast)]"
                            : "rounded-bl-sm border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-strong)]"
                        }`}>
                          {message.body}
                        </p>
                        <time dateTime={message.createdAt} className="mt-1 px-1 font-mono text-[9px] font-medium tabular-nums text-[var(--text-muted)]">
                          {formatKoreanTime(message.createdAt)}
                        </time>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {isAuditMode ? (
              <div className="border-t border-[var(--border)] bg-[var(--surface-muted)] p-3 text-center text-xs font-bold text-[var(--text-muted)]">
                감사 화면에서는 대화를 읽을 수만 있으며 메시지를 보낼 수 없습니다.
              </div>
            ) : (
            <form onSubmit={handleSend} className="border-t border-[var(--border)] bg-[var(--surface-raised)] p-3.5">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
                rows={2}
                disabled={chat.selectedConversation.status === "closed" || chat.isSending}
                placeholder={chat.selectedConversation.status === "closed" ? "종료된 상담입니다." : "답변을 입력하세요"}
                className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3.5 py-2.5 text-sm font-medium leading-6 text-[var(--text-strong)] outline-none transition-all duration-200 focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)]"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">{draft.length.toLocaleString("ko-KR")} / {MAX_SUPPORT_MESSAGE_LENGTH.toLocaleString("ko-KR")}</span>
                <button
                  type="submit"
                  disabled={!draft.trim() || chat.isSending || chat.selectedConversation.status === "closed"}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-black text-[var(--accent-contrast)] shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--accent-hover)] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
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
    <div className={`grid place-items-center bg-[var(--surface)] p-8 text-center ${compact ? "min-h-[420px]" : "min-h-[650px] rounded-2xl border border-[var(--border)]"}`}>
      <div>
        <span className="mx-auto grid size-10 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)]" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="M5 5.5h14v10H9l-4 3v-13Z" strokeLinejoin="round" /><path d="M8.5 9h7M8.5 12h4" strokeLinecap="round" /></svg>
        </span>
        <p className="mt-3 text-sm font-bold text-[var(--text-muted)]">{message}</p>
      </div>
    </div>
  );
}

function ChatEmptyState({
  title,
  description,
  compact = false,
}: {
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div className={`${compact ? "m-2 p-5" : "mx-auto mt-10 max-w-sm p-7"} rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)]/65 text-center`}>
      <span className="mx-auto grid size-9 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4.5"><path d="M5 5.5h14v10H9l-4 3v-13Z" strokeLinejoin="round" /><path d="M9 10.5h6" strokeLinecap="round" /></svg>
      </span>
      <p className="mt-3 text-sm font-black text-[var(--text-strong)]">{title}</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-muted)]">{description}</p>
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div role="status" aria-label="메시지를 불러오는 중" className="space-y-4 py-3">
      <span className="sr-only">메시지를 불러오는 중…</span>
      <div className="commerce-skeleton h-14 w-2/3 rounded-2xl rounded-bl-sm" />
      <div className="commerce-skeleton ml-auto h-16 w-1/2 rounded-2xl rounded-br-sm" />
      <div className="commerce-skeleton h-12 w-3/5 rounded-2xl rounded-bl-sm" />
    </div>
  );
}

function ChatInboxSkeleton() {
  return (
    <section role="status" aria-label="상담 대화함을 불러오는 중" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--panel-shadow)]">
      <span className="sr-only">상담 대화함을 불러오는 중이에요…</span>
      <div className="grid min-h-[650px] md:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3 border-r border-[var(--border)] bg-[var(--surface-muted)]/50 p-4">
          <div className="commerce-skeleton h-5 w-32 rounded" />
          <div className="commerce-skeleton h-10 rounded-lg" />
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className="commerce-skeleton h-16 rounded-lg" />)}
        </div>
        <div className="hidden space-y-5 p-6 md:block">
          <div className="commerce-skeleton h-12 rounded-lg" />
          <div className="commerce-skeleton h-16 w-2/3 rounded-2xl" />
          <div className="commerce-skeleton ml-auto h-16 w-1/2 rounded-2xl" />
        </div>
      </div>
    </section>
  );
}
