import type {
  OnlineMember,
  OnlinePresenceStatus,
} from "@/src/hooks/useOnlineMembers";

export interface OnlineMembersSidebarProps {
  members: readonly OnlineMember[];
  hasMore?: boolean;
  status: OnlinePresenceStatus;
  error?: string | null;
  className?: string;
}

export default function OnlineMembersSidebar({
  members,
  hasMore = false,
  status,
  error,
  className = "",
}: OnlineMembersSidebarProps) {
  const isConnected = status === "connected";
  const statusLabel = isConnected
    ? `${members.length}${hasMore ? "+" : ""}명`
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
      className={`sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-[1.6rem] border border-[#dce8df] bg-[#f6fbf7]/95 p-4 shadow-[0_16px_40px_rgba(69,96,79,0.10)] backdrop-blur ${className}`}
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
              ? `${members.length}${hasMore ? "명 이상" : "명"} 온라인`
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

      <ul className="mt-4 space-y-1.5" aria-label="온라인 사용자 목록">
        {members.length > 0 ? (
          members.map((member) => (
            <li
              key={member.id}
              className="flex min-h-11 items-center gap-3 rounded-2xl bg-white/75 px-3 py-2 text-[17px] font-extrabold text-[#4d5c51]"
            >
              <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#63bd78] opacity-40" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-[#4aaf63] ring-2 ring-[#dff2e4]" />
              </span>
              <span>{member.displayName}</span>
              <span className="ml-auto text-[13px] font-bold text-[#699174]">
                온라인
              </span>
            </li>
          ))
        ) : (
          <li
            role={status === "error" ? "alert" : "status"}
            className="rounded-2xl border border-dashed border-[#cadccf] bg-white/60 px-3 py-4 text-center text-[15px] font-bold leading-6 text-[#66786b]"
          >
            {emptyMessage}
          </li>
        )}
      </ul>

      <p className="mt-4 break-keep rounded-2xl bg-[#eaf5ed] px-3 py-2.5 text-[14px] font-bold leading-5 text-[#587160]">
        Supabase 실시간 연결 기준이며, 비식별 임시 별칭으로 표시됩니다.
      </p>
    </aside>
  );
}
