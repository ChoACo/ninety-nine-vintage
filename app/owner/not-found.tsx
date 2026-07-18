import Link from "next/link";

export default function OwnerNotFound() {
  return (
    <main className="theme-app-shell grid min-h-screen place-items-center px-4 py-12">
      <section className="w-full max-w-md text-center">
        <p className="font-mono text-xs font-black tracking-[0.2em] text-[var(--text-muted)]">404 · NOT FOUND</p>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-[var(--text-strong)]">페이지를 찾을 수 없습니다</h1>
        <p className="mt-2 break-keep text-sm font-semibold leading-6 text-[var(--text-muted)]">요청한 주소가 없거나 사용할 수 없는 페이지입니다.</p>
        <Link href="/" className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-800 bg-[var(--surface)] px-4 text-sm font-black text-[var(--text-strong)] transition-all duration-200 hover:border-zinc-700 hover:bg-[var(--surface-raised)]">메인으로 이동</Link>
      </section>
    </main>
  );
}
