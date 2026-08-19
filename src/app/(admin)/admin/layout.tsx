import type { Metadata } from "next";
import Link from "next/link";
import { AdminAccessBoundary } from "@/components/admin/AdminAccessBoundary";
import { ChatNotificationLink } from "@/components/features/chat/ChatNotificationProvider";
import { MessageCircle } from "lucide-react";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: {
    default: "업무 센터 | NINETY-NINE",
    template: "%s | NINETY-NINE",
  },
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen min-w-0 bg-paper text-ink" data-admin-surface>
      <header className="border-b border-line bg-paper/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-18 max-w-[1680px] flex-col items-stretch justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-6 md:px-10">
          <Link
            className="whitespace-nowrap text-sm font-black tracking-[0.08em] sm:tracking-[0.14em]"
            href="/admin/operator"
          >
            NINETY-NINE WORKSPACE
          </Link>
          <div className="flex max-w-full flex-wrap items-center gap-2 sm:justify-end">
            <ChatNotificationLink ariaLabel="채팅" className="grid size-10 place-items-center border border-line" fallbackHref="/chat"><MessageCircle size={16} /></ChatNotificationLink>
            <Link className="whitespace-nowrap text-xs font-bold underline" href="/">
              쇼핑 화면으로 이동
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto min-h-[calc(100vh-4.5rem)] max-w-[1600px] px-4 py-6 sm:px-6 md:px-10 md:py-8">
        <AdminAccessBoundary>{children}</AdminAccessBoundary>
      </main>
    </div>
  );
}
