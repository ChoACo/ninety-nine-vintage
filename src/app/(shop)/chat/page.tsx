import { ChatPanel } from "@/components/features/chat/ChatPanel";

export const dynamic = "force-dynamic";
export default function ChatPage() { return <div className="space-y-8"><div><p className="eyebrow text-muted">고객 지원 · 바로 상담</p><h1 className="mt-3 text-4xl font-black tracking-[-.08em]">운영자와 상담</h1></div><ChatPanel surface="desktop" /></div>; }

