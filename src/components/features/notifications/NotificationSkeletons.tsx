export function NotificationSkeleton() {
  return <div aria-label="알림 불러오는 중" className="animate-pulse" role="status">
    <div className="flex gap-2 border-b border-line p-3">{Array.from({ length: 4 }, (_, index) => <span className="h-8 w-16 rounded-lg bg-surface" key={index} />)}</div>
    {Array.from({ length: 5 }, (_, index) => <div className="flex gap-3 border-b border-line p-5" key={index}><span className="size-8 shrink-0 rounded-full bg-surface" /><span className="flex-1"><span className="block h-3 w-2/5 rounded bg-surface" /><span className="mt-3 block h-3 w-4/5 rounded bg-surface" /></span></div>)}
  </div>;
}

export function ChatSkeleton() {
  return <div aria-label="상담 메시지 불러오는 중" className="space-y-4 p-5" role="status">{Array.from({ length: 5 }, (_, index) => <span className={`block h-14 animate-pulse rounded-2xl bg-surface ${index % 2 ? "ml-auto w-2/3" : "w-3/4"}`} key={index} />)}</div>;
}
