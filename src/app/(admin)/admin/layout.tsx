import type { Metadata } from "next";
import Link from "next/link";
import { AdminAccessBoundary } from "@/components/admin/AdminAccessBoundary";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "관리자 센터 | NINETY-NINE",
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen min-w-0 bg-paper text-ink">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex min-h-18 max-w-[1680px] items-center justify-between gap-4 px-4 py-4 sm:px-6 md:px-10">
          <Link
            className="text-sm font-black tracking-[0.14em]"
            href="/admin/operator"
          >
            NINETY-NINE 관리자
          </Link>
          <Link className="text-xs font-bold underline" href="/">
            쇼핑 화면으로 이동
          </Link>
        </div>
      </header>
      <main className="mx-auto min-h-[calc(100vh-4.5rem)] max-w-[1680px] px-4 py-6 sm:px-6 md:px-10 md:py-8">
        <AdminAccessBoundary>{children}</AdminAccessBoundary>
      </main>
    </div>
  );
}
