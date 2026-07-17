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
      className={`theme-panel sticky top-24 max-h-[calc(100dvh-7rem)] self-start overflow-y-auto overscroll-contain rounded-[1.6rem] border p-4 shadow-[0_16px_40px_rgba(69,96,79,0.10)] backdrop-blur motion-safe:transition-[top,box-shadow] motion-safe:duration-300 motion-safe:ease-out ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-extrabold tracking-[0.12em] text-[#63806b]">
            LIVE USERS
          </p>
          <h2
            id="online-members-title"
            className="mt-1 break-keep text-[17px] font-black leading-6 text-[#35483b]"
          >
            현재 접속 중인 사용자
          </h2>
        </div>
        <span
          aria-label={
            isConnected
              ? `${totalCount}명 온라인`
              : `접속 상태 ${statusLabel}`
          }
          className={`shrink-0 rounded-full px-2.5 py-1 text-[14px] font-black ${
            status === "error"
              ? "bg-[#f4e8e4] text-[#9a594e]"
              : "bg-[#e1f3e6] text-[#39704a]"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {members.some((member) => member.isOperator) ? (
        <section className="mt-4" aria-labelledby="online-operators-title">
          <h3 id="online-operators-title" className="text-xs font-black tracking-[0.12em] text-[var(--accent-text)]">
            운영자
          </h3>
          <ul className="mt-2 space-y-1.5">
            {members.filter((member) => member.isOperator).map((member) => (
            <li
              key={member.id}
              className="flex min-h-11 items-center gap-3 rounded-2xl bg-[var(--accent-surface)] px-3 py-2 text-[17px] font-extrabold text-[var(--text-strong)]"
            >
              <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#63bd78] opacity-40" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-[#4aaf63] ring-2 ring-[#dff2e4]" />
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
        {members.some((member) => !member.isOperator) ? (
          members.filter((member) => !member.isOperator).map((member) => (
            <li
              key={member.id}
              className="flex min-h-11 items-center gap-3 rounded-2xl bg-[var(--surface-raised)] px-3 py-2 text-[17px] font-extrabold text-[var(--text-strong)]"
            >
              <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#63bd78] opacity-40" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-[#4aaf63] ring-2 ring-[#dff2e4]" />
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
            현재 접속 중인 일반 회원이 없습니다.
          </li>
        )}
        </ul>
      </section>

      {hasMore ? (
        <p className="mt-4 break-keep rounded-2xl bg-[var(--info-surface)] px-3 py-2.5 text-[14px] font-bold leading-5 text-[var(--info-text)]">
          목록에는 최대 50명만 표시되며 전체 접속 인원은 상단 숫자에 반영됩니다.
        </p>
      ) : null}
    </aside>
  );
}
