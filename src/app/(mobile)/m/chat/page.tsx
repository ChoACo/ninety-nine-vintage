import type { Metadata } from "next";
import { ChatPanel } from "@/components/features/chat/ChatPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "상담·채팅", robots: { follow: false, index: false } };
export default function MobileChatPage() { return <div className="space-y-6"><header><p className="eyebrow text-muted">고객 지원 / 바로 상담</p><h1 className="mt-3 text-3xl font-black tracking-[-.08em]">운영자와 상담</h1></header><ChatPanel basePath="/m" surface="mobile" /></div>; }
