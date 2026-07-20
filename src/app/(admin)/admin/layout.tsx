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
    <div className="min-h-screen min-w-[1180px] bg-paper text-ink">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-18 max-w-[1680px] items-center justify-between px-10">
          <Link
            className="text-sm font-black tracking-[0.14em]"
            href="/admin/operator"
          >
            NINETY-NINE ADMIN
          </Link>
          <Link className="text-xs font-bold underline" href="/">
            쇼핑 화면으로 이동
          </Link>
        </div>
      </header>
      <main className="mx-auto min-h-[calc(100vh-4.5rem)] max-w-[1680px] px-10 py-8">
        <AdminAccessBoundary>{children}</AdminAccessBoundary>
      </main>
    </div>
  );
}
