export function TableSkeleton({ columns = 6 }: Readonly<{ columns?: number }>) {
  return <div aria-label="목록 불러오는 중" className="animate-pulse overflow-hidden rounded-2xl border border-line" role="status"><div className="grid gap-px bg-line" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{Array.from({ length: columns }, (_, index) => <div className="h-10 bg-surface" key={index} />)}</div><div className="divide-y divide-line">{Array.from({ length: 8 }, (_, row) => <div className="grid gap-4 px-4 py-4" key={row} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{Array.from({ length: columns }, (_, column) => <div className="h-4 rounded bg-line/70" key={column} />)}</div>)}</div></div>;
}

export function CardGridSkeleton() {
  return <div aria-label="대시보드 불러오는 중" className="grid animate-pulse grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4" role="status">{Array.from({ length: 4 }, (_, index) => <div className="h-32 bg-surface p-5" key={index}><div className="h-4 w-16 rounded bg-line/70" /><div className="mt-10 h-8 w-20 rounded bg-line/70" /></div>)}</div>;
}

export function FormSkeleton() {
  return <div aria-label="등록 양식 불러오는 중" className="grid animate-pulse gap-4 lg:grid-cols-2" role="status">{Array.from({ length: 8 }, (_, index) => <div className={`h-14 rounded-xl bg-line/70 ${index === 0 ? "lg:col-span-2 h-48" : ""}`} key={index} />)}</div>;
}
