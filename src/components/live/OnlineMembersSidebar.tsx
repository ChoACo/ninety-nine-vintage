const DEFAULT_ONLINE_MEMBERS = [
  "김*수",
  "이*영",
  "박*진",
  "최*희",
  "정*자",
  "한*숙",
  "오*철",
] as const;

export interface OnlineMembersSidebarProps {
  /** 서버의 presence 목록으로 교체하기 전까지 사용할 마스킹 회원명 목록 */
  members?: readonly string[];
  className?: string;
}

export default function OnlineMembersSidebar({
  members = DEFAULT_ONLINE_MEMBERS,
  className = "",
}: OnlineMembersSidebarProps) {
  return (
    <aside
      aria-labelledby="online-members-title"
      className={`sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-[1.6rem] border border-[#dce8df] bg-[#f6fbf7]/95 p-4 shadow-[0_16px_40px_rgba(69,96,79,0.10)] backdrop-blur ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-extrabold tracking-[0.12em] text-[#63806b]">
            LIVE MEMBERS
          </p>
          <h2
            id="online-members-title"
            className="mt-1 break-keep text-[17px] font-black leading-6 text-[#35483b]"
          >
            현재 접속 중인 회원
          </h2>
        </div>
        <span
          aria-label={`${members.length}명 온라인`}
          className="shrink-0 rounded-full bg-[#e1f3e6] px-2.5 py-1 text-[14px] font-black text-[#39704a]"
        >
          {members.length}명
        </span>
      </div>

      <ul className="mt-4 space-y-1.5" aria-label="온라인 회원 목록">
        {members.map((member) => (
          <li
            key={member}
            className="flex min-h-11 items-center gap-3 rounded-2xl bg-white/75 px-3 py-2 text-[17px] font-extrabold text-[#4d5c51]"
          >
            <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#63bd78] opacity-40" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[#4aaf63] ring-2 ring-[#dff2e4]" />
            </span>
            <span>{member}</span>
            <span className="ml-auto text-[13px] font-bold text-[#699174]">
              온라인
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 break-keep rounded-2xl bg-[#eaf5ed] px-3 py-2.5 text-[14px] font-bold leading-5 text-[#587160]">
        접속 상태는 데모용 Mock 데이터입니다.
      </p>
    </aside>
  );
}

