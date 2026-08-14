"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { OperatorChatConsole } from "@/components/admin/operator/OperatorChatConsole";
import { ChatPanel } from "@/components/features/chat/ChatPanel";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

export function StandaloneChatHub({ basePath = "" }: { basePath?: "" | "/m" }) {
  const { loading, session } = useSupabaseSession();
  const [roleSnapshot, setRoleSnapshot] = useState<{ userId: string; roleCode: string } | null>(null);

  useEffect(() => {
    if (loading || !session) return;
    const controller = new AbortController();
    void fetch("/api/admin/session", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { session?: { roleCode?: string } };
      setRoleSnapshot({ userId: session.user.id, roleCode: response.ok ? payload.session?.roleCode ?? "" : "" });
    }).catch(() => setRoleSnapshot({ userId: session.user.id, roleCode: "" }));
    return () => controller.abort();
  }, [loading, session]);

  if (loading || (session && roleSnapshot?.userId !== session.user.id)) {
    return <div className="min-h-72 animate-pulse border border-line bg-surface" aria-label="채팅 권한 확인 중" role="status" />;
  }
  const roleCode = session ? roleSnapshot?.roleCode ?? "" : "";
  if (roleCode === "owner" || roleCode === "operator") {
    return <OperatorChatConsole />;
  }
  if (roleCode === "employee") {
    return <div className="border border-line bg-surface p-6"><h2 className="text-xl font-black">직원 상담함</h2><p className="mt-2 text-sm text-muted">배정된 센터의 문의를 직원 상담함에서 확인합니다.</p><Link className="mt-5 inline-flex min-h-11 items-center bg-ink px-5 text-xs font-bold text-paper" href="/admin/employee/inquiries">직원 상담함 열기</Link></div>;
  }
  return <ChatPanel basePath={basePath} surface={basePath === "/m" ? "mobile" : "desktop"} />;
}
