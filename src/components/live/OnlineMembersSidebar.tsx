import type {
  OnlineMember,
  OnlinePresenceStatus,
} from "@/src/hooks/useOnlineMembers";

export interface OnlineMembersSidebarProps {
  members: readonly OnlineMember[];
  totalCount: number;
  hasMore?: boolean;
  status: OnlinePresenceStatus;
  error?: string | null;
  className?: string;
}

export default function OnlineMembersSidebar({
  members,
  totalCount,
  hasMore = false,
  status,
  error,
  className = "",
}: OnlineMembersSidebarProps) {
  const operators = members.filter((member) => member.isOperator);
  const signedInMembers = members.filter(
    (member) => !member.isOperator && !member.isGuest,
  );
  const guests = members.filter((member) => member.isGuest);
  const isConnected = status === "connected";
  const statusLabel = isConnected
    ? `${totalCount}명`
    : status === "connecting"
      ? "연결 중"
      : "확인 불가";
  const emptyMessage =
    status === "connecting"
      ? "실시간 접속 상태를 연결하고 있어요."
      : status === "error"
        ? (error ?? "실시간 접속 상태를 불러오지 못했습니다.")
        : "현재 접속 중인 사용자가 없습니다.";

  return (
    <aside
      aria-labelledby="online-members-title"
      className={`theme-panel sticky top-4 max-h-[calc(100dvh-2rem)] self-start overflow-y-auto overscroll-contain border p-3.5 shadow-[var(--panel-shadow)] ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--success-text)]">
            ONLINE NOW
          </p>
          <h2
            id="online-members-title"
            className="mt-1 break-keep text-[15px] font-black leading-5 tracking-[-0.02em] text-[var(--text-strong)]"
          >
            현재 접속
          </h2>
        </div>
        <span
          aria-label={
            isConnected
              ? `${totalCount}명 온라인`
              : `접속 상태 ${statusLabel}`
          }
          className={`shrink-0 border-y px-2.5 py-1 font-mono text-[11px] font-black tabular-nums tracking-tight ${
            status === "error"
              ? "border-[var(--danger-text)]/30 bg-[var(--danger-surface)] text-[var(--danger-text)]"
              : "border-[var(--success-text)]/30 bg-[var(--success-surface)] text-[var(--success-text)]"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {operators.length > 0 ? (
        <section className="mt-4" aria-labelledby="online-operators-title">
          <h3 id="online-operators-title" className="text-xs font-black tracking-[0.12em] text-[var(--accent-text)]">
            운영자
          </h3>
          <ul className="mt-2 space-y-1.5">
            {operators.map((member) => (
            <li
              key={member.id}
              className="flex min-h-9 items-center gap-2.5 border-l-2 border-[var(--accent-text)] bg-[var(--accent-surface)] px-2.5 py-2 text-xs font-bold text-[var(--text-strong)] transition-colors duration-200 hover:brightness-[.98]"
            >
              <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
                <span className="inline-flex size-2.5 rounded-full bg-[var(--success-text)] ring-2 ring-[var(--success-surface)]" />
              </span>
              <span>{member.displayName}</span>
            </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-4" aria-labelledby="online-members-list-title">
        <h3 id="online-members-list-title" className="text-xs font-black tracking-[0.12em] text-[var(--text-muted)]">
          접속 회원
        </h3>
        <ul className="mt-2 space-y-1.5" aria-label="온라인 회원 목록">
        {signedInMembers.length > 0 ? (
          signedInMembers.map((member) => (
            <li
              key={member.id}
              className="flex min-h-9 items-center gap-2.5 border-b border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 text-xs font-bold text-[var(--text-strong)] transition-colors duration-200 hover:bg-[var(--surface-muted)]"
            >
              <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
                <span className="inline-flex size-2.5 rounded-full bg-[var(--success-text)] ring-2 ring-[var(--success-surface)]" />
              </span>
              <span>{member.displayName}</span>
            </li>
          ))
        ) : members.length === 0 ? (
          <li
            role={status === "error" ? "alert" : "status"}
            className="border border-dashed border-[var(--border)] bg-[var(--surface-raised)] px-3 py-5 text-center text-xs font-medium leading-5 text-[var(--text-muted)]"
          >
            {emptyMessage}
          </li>
        ) : (
          <li className="border border-dashed border-[var(--border)] px-3 py-5 text-center text-xs font-medium text-[var(--text-muted)]">
            현재 접속 중인 로그인 회원이 없습니다.
          </li>
        )}
        </ul>
      </section>

      {guests.length > 0 ? (
        <section className="mt-4" aria-labelledby="online-guests-list-title">
          <h3
            id="online-guests-list-title"
            className="text-xs font-black tracking-[0.12em] text-[var(--text-muted)]"
          >
            게스트
          </h3>
          <ul className="mt-2 space-y-1.5" aria-label="온라인 게스트 목록">
            {guests.map((guest) => (
              <li
                key={guest.id}
                className="flex min-h-9 items-center gap-2.5 border-b border-[var(--info-border)] bg-[var(--info-surface)] px-2.5 py-2 text-xs font-bold text-[var(--text-strong)] transition-colors duration-200 hover:brightness-[.98]"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-2.5 shrink-0 rounded-full bg-[var(--success-text)] ring-2 ring-[var(--success-surface)]"
                />
                <span>{guest.displayName}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hasMore ? (
        <p className="mt-4 break-keep border-l-2 border-[var(--info-text)] bg-[var(--info-surface)] px-3 py-2.5 text-[11px] font-medium leading-5 text-[var(--info-text)]">
          목록에는 최대 50명만 표시되며 전체 접속 인원은 상단 숫자에 반영됩니다.
        </p>
      ) : null}
    </aside>
  );
}
