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
      className={`theme-panel sticky top-4 max-h-[calc(100dvh-2rem)] self-start overflow-y-auto overscroll-contain rounded-[1.35rem] border p-3.5 shadow-[0_10px_30px_rgba(69,96,79,0.08)] ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-extrabold tracking-[0.14em] text-[#63806b]">
            ONLINE NOW
          </p>
          <h2
            id="online-members-title"
            className="mt-1 break-keep text-[15px] font-black leading-5 text-[var(--text-strong)]"
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
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${
            status === "error"
              ? "bg-[#f4e8e4] text-[#9a594e]"
              : "bg-[#e1f3e6] text-[#39704a]"
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
              className="flex min-h-10 items-center gap-2.5 rounded-xl bg-[var(--accent-surface)] px-2.5 py-2 text-sm font-extrabold text-[var(--text-strong)]"
            >
              <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
                <span className="inline-flex size-2.5 rounded-full bg-[#4aaf63] ring-2 ring-[#dff2e4]" />
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
              className="flex min-h-10 items-center gap-2.5 rounded-xl bg-[var(--surface-raised)] px-2.5 py-2 text-sm font-extrabold text-[var(--text-strong)]"
            >
              <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
                <span className="inline-flex size-2.5 rounded-full bg-[#4aaf63] ring-2 ring-[#dff2e4]" />
              </span>
              <span>{member.displayName}</span>
            </li>
          ))
        ) : members.length === 0 ? (
          <li
            role={status === "error" ? "alert" : "status"}
            className="rounded-2xl border border-dashed border-[#cadccf] bg-white/60 px-3 py-4 text-center text-[15px] font-bold leading-6 text-[#66786b]"
          >
            {emptyMessage}
          </li>
        ) : (
          <li className="rounded-2xl border border-dashed border-[var(--border)] px-3 py-4 text-center text-sm font-bold text-[var(--text-muted)]">
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
                className="flex min-h-10 items-center gap-2.5 rounded-xl bg-[var(--info-surface)] px-2.5 py-2 text-sm font-extrabold text-[var(--text-strong)]"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-2.5 shrink-0 rounded-full bg-[#55a970] ring-2 ring-[#dff2e4]"
                />
                <span>{guest.displayName}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hasMore ? (
        <p className="mt-4 break-keep rounded-2xl bg-[var(--info-surface)] px-3 py-2.5 text-[14px] font-bold leading-5 text-[var(--info-text)]">
          목록에는 최대 50명만 표시되며 전체 접속 인원은 상단 숫자에 반영됩니다.
        </p>
      ) : null}
    </aside>
  );
}
