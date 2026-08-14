import type { Metadata } from "next";
import { StandaloneChatHub } from "@/components/features/chat/StandaloneChatHub";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "상담·채팅", robots: { follow: false, index: false } };
export default function MobileChatPage() { return <div className="space-y-6"><header><p className="eyebrow text-muted">채팅 / 통합 받은 편지함</p><h1 className="mt-3 text-3xl font-black tracking-[-.08em]">채팅</h1></header><StandaloneChatHub basePath="/m" /></div>; }
