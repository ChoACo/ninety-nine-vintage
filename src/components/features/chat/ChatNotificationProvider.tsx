"use client";

import { MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ChatNotificationState {
  href: string | null;
  unreadCount: number;
}

interface ChatToast {
  href: string;
  messageId: string;
}

interface ChatNotificationLinkProps {
  ariaLabel: string;
  basePath?: "" | "/m";
  className?: string;
  children?: ReactNode;
  fallbackHref: string;
}

const ChatNotificationContext = createContext<ChatNotificationState>({
  href: null,
  unreadCount: 0,
});

function withMobileBase(href: string, pathname: string, basePath: "" | "/m") {
  if (basePath !== "/m" && !pathname.startsWith("/m")) return href;
  return href.startsWith("/chat") ? `/m${href}` : href;
}

export function ChatNotificationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { session } = useSupabaseSession();
  const accessToken = session?.access_token;
  const sessionUserId = session?.user.id;
  const [state, setState] = useState<ChatNotificationState>({
    href: null,
    unreadCount: 0,
  });
  const [toast, setToast] = useState<ChatToast | null>(null);

  const loadSummary = useCallback(async () => {
    if (!accessToken) {
      setState({ href: null, unreadCount: 0 });
      return null;
    }
    const response = await fetch("/api/chat/unread", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as {
      href?: string | null;
      unreadCount?: number;
    } | null;
    if (!response.ok || !payload) return null;
    const nextState = {
      href: payload.href ?? null,
      unreadCount: Math.max(0, Number(payload.unreadCount ?? 0)),
    };
    setState(nextState);
    return nextState;
  }, [accessToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSummary();
    }, 0);
    const onRead = () => void loadSummary();
    window.addEventListener("ninety-nine:chat-read", onRead);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("ninety-nine:chat-read", onRead);
    };
  }, [loadSummary]);

  useEffect(() => {
    if (!sessionUserId) return;
    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`support-notifications:${sessionUserId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
        },
        (payload) => {
          const message = payload.new as {
            id?: string;
            sender_id?: string | null;
          };
          if (!message.id || message.sender_id === sessionUserId) return;
          void loadSummary().then((summary) => {
            const href = summary?.href;
            if (!href) return;
            setToast({ href, messageId: message.id as string });
            window.dispatchEvent(new Event("ninety-nine:chat-message"));
          });
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadSummary, sessionUserId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const value = useMemo(() => state, [state]);
  const toastHref = toast
    ? withMobileBase(toast.href, pathname, pathname.startsWith("/m") ? "/m" : "")
    : null;

  return (
    <ChatNotificationContext.Provider value={value}>
      {children}
      {toast && toastHref && (
        <aside
          aria-live="polite"
          className="fixed right-4 top-4 z-[140] w-[min(22rem,calc(100vw-2rem))] border border-ink bg-paper p-4 text-ink shadow-2xl"
          role="status"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-paper">
              <MessageCircle size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">새로운 채팅이 있습니다</p>
              <p className="mt-1 text-[11px] text-muted">
                확인하지 않은 매장 상담 메시지가 도착했습니다.
              </p>
              <Link
                className="mt-3 inline-flex h-9 items-center bg-ink px-4 text-[11px] font-bold text-paper"
                href={toastHref}
                onClick={() => setToast(null)}
              >
                채팅으로 이동하기
              </Link>
            </div>
            <button
              aria-label="새 채팅 알림 닫기"
              className="grid size-9 shrink-0 place-items-center"
              onClick={() => setToast(null)}
              type="button"
            >
              <X size={17} />
            </button>
          </div>
        </aside>
      )}
    </ChatNotificationContext.Provider>
  );
}

export function ChatNotificationLink({
  ariaLabel,
  basePath = "",
  className,
  children,
  fallbackHref,
}: ChatNotificationLinkProps) {
  const pathname = usePathname();
  const { href, unreadCount } = useContext(ChatNotificationContext);
  const resolvedHref = withMobileBase(
    href ?? fallbackHref,
    pathname,
    basePath,
  );

  return (
    <Link
      aria-label={
        unreadCount > 0 ? `${ariaLabel}, 새 채팅 ${unreadCount}건` : ariaLabel
      }
      className={`relative ${className ?? ""}`}
      href={resolvedHref}
    >
      {children ?? <MessageCircle size={17} />}
      {unreadCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[8px] font-black leading-4 text-white">
          {Math.min(unreadCount, 99)}
        </span>
      )}
    </Link>
  );
}
