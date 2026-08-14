import { StandaloneChatHub } from "@/components/features/chat/StandaloneChatHub";

export const dynamic = "force-dynamic";
export default function ChatPage() { return <div className="space-y-8"><div><p className="eyebrow text-muted">채팅 · 통합 받은 편지함</p><h1 className="mt-3 text-4xl font-black tracking-[-.08em]">채팅</h1><p className="mt-3 text-sm text-muted">구매 문의와 판매센터 회원 상담을 계정 역할에 맞게 한곳에서 확인합니다.</p></div><StandaloneChatHub /></div>; }

