"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const POLL_INTERVAL_MS = 30_000;

export default function OperatorInquiryBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      if (!session?.access_token) {
        setCount(0);
        setReady(true);
        return;
      }
      const response = await fetch("/api/admin/operator/inquiries/unread", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (response.status === 401 || response.status === 403) {
        setCount(0);
        setReady(true);
        return;
      }
      if (!response.ok) return;
      const data = (await response.json()) as { count?: number };
      setCount(typeof data.count === "number" ? data.count : 0);
      setReady(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const onChatMessage = () => void refresh();
    const onChatRead = () => void refresh();
    window.addEventListener("ninety-nine:chat-message", onChatMessage);
    window.addEventListener("ninety-nine:chat-read", onChatRead);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("ninety-nine:chat-message", onChatMessage);
      window.removeEventListener("ninety-nine:chat-read", onChatRead);
    };
  }, [refresh]);

  const active = pathname === "/admin/operator/inquiries";
  if (!ready || count === 0) return null;

  return (
    <span
      aria-label={`새 상품 문의 ${count}건`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black leading-4 tabular-nums ${active ? "bg-paper text-ink" : "bg-red-600 text-white"}`}
      role="status"
    >
      새 문의 {Math.min(count, 99)}
    </span>
  );
}
