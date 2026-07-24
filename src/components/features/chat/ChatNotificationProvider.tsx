"use client";

import { MessageCircle } from "lucide-react";
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
  const { session } = useSupabaseSession();
  const accessToken = session?.access_token;
  const sessionUserId = session?.user.id;
  const [state, setState] = useState<ChatNotificationState>({
    href: null,
    unreadCount: 0,
  });

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
          void loadSummary().then(() => {
            window.dispatchEvent(new Event("ninety-nine:chat-message"));
          });
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadSummary, sessionUserId]);

  const value = useMemo(() => state, [state]);

  return (
    <ChatNotificationContext.Provider value={value}>
      {children}
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
