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
import { PremiumDialog } from "@/components/ui/PremiumDialog";

interface ChatNotificationState {
  href: string | null;
  unreadCount: number;
}

interface ChatNotificationLinkProps {
  ariaLabel: string;
  allowedHrefPrefix?: string;
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
  const pathname = usePathname();
  const [unreadModalOpen, setUnreadModalOpen] = useState(false);

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
      latestConversationId?: string | null;
      latestMessageAt?: string | null;
      unreadCount?: number;
    } | null;
    if (!response.ok || !payload) return null;
    const nextState = {
      href: payload.href ?? null,
      unreadCount: Math.max(0, Number(payload.unreadCount ?? 0)),
    };
    setState(nextState);
    const notificationKey = payload.latestConversationId && payload.latestMessageAt
      ? `${payload.latestConversationId}:${payload.latestMessageAt}`
      : null;
    if (nextState.unreadCount === 0) {
      setUnreadModalOpen(false);
    } else if (
      notificationKey &&
      window.sessionStorage.getItem("ninety-nine:unread-chat-modal") !== notificationKey
    ) {
      window.sessionStorage.setItem(
        "ninety-nine:unread-chat-modal",
        notificationKey,
      );
      setUnreadModalOpen(true);
    }
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
  const unreadHref = state.href
    ? withMobileBase(state.href, pathname, pathname.startsWith("/m") ? "/m" : "")
    : null;

  return (
    <ChatNotificationContext.Provider value={value}>
      {children}
      <PremiumDialog
        ariaLabel="읽지 않은 채팅 안내"
        onClose={() => setUnreadModalOpen(false)}
        open={unreadModalOpen && state.unreadCount > 0}
        panelClassName="max-w-md p-6"
      >
        <p className="text-[10px] font-black tracking-[0.14em] text-red-700">
          읽지 않은 채팅
        </p>
        <h2 className="mt-3 text-2xl font-black tracking-[-0.05em]">
          새 채팅 {state.unreadCount}건이 있습니다.
        </h2>
        <p className="mt-3 text-xs leading-5 text-muted">
          가장 최근에 도착한 상담부터 확인할 수 있습니다.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            className="h-11 border border-line text-xs font-bold"
            onClick={() => setUnreadModalOpen(false)}
            type="button"
          >
            나중에 보기
          </button>
          {unreadHref && (
            <Link
              className="grid h-11 place-items-center bg-ink text-xs font-bold text-paper"
              href={unreadHref}
              onClick={() => setUnreadModalOpen(false)}
              prefetch={false}
            >
              채팅 확인
            </Link>
          )}
        </div>
      </PremiumDialog>
    </ChatNotificationContext.Provider>
  );
}

export function ChatNotificationLink({
  ariaLabel,
  allowedHrefPrefix,
  basePath = "",
  className,
  children,
  fallbackHref,
}: ChatNotificationLinkProps) {
  const pathname = usePathname();
  const { unreadCount } = useContext(ChatNotificationContext);
  void allowedHrefPrefix;
  const resolvedHref = withMobileBase(
    fallbackHref,
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
      prefetch={false}
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
