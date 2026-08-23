export default function OperatorPlatformLoading() {
  return (
    <div
      aria-label="매장 설정 페이지 불러오는 중"
      className="mx-auto w-full max-w-6xl space-y-5 pb-24"
      role="status"
    >
      <div className="h-20 animate-pulse rounded-2xl bg-zinc-900" />
      <div className="h-56 animate-pulse rounded-2xl bg-zinc-900" />
      <div className="h-72 animate-pulse rounded-2xl bg-zinc-900" />
      <span className="sr-only">매장 설정 페이지를 불러오는 중입니다.</span>
    </div>
  );
}
