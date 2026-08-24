"use client";

import { Bell, BellOff, CheckCheck, CircleDollarSign, Gavel, Megaphone, Package, Settings, ShoppingBag, Truck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  canViewNotification,
  getNotificationCategory,
  getNotificationFallbackHref,
  getVisibleNotificationTabs,
  type NotificationCategory,
  type NotificationRecord,
  type NotificationViewerRole,
} from "@/lib/notifications/types";
import { NotificationTabs } from "@/components/features/notifications/NotificationTabs";
import { NotificationSkeleton } from "@/components/features/notifications/NotificationSkeletons";
import {
  clientErrorFromResponse,
  reportClientError,
} from "@/lib/clientErrors";

type NotificationItem = NotificationRecord;

function NotificationIcon({ item }: { item: NotificationItem }) {
  const category = getNotificationCategory(item.kind, item.audience_role);
  if (category === "AUCTION") return <Gavel size={15} strokeWidth={1.75} />;
  if (category === "VAULT_SHIPPING") return /shipping|shipment|delivery|tracking/iu.test(item.kind) ? <Truck size={15} strokeWidth={1.75} /> : <Package size={15} strokeWidth={1.75} />;
  if (category === "OPERATOR_SALES") return <ShoppingBag size={15} strokeWidth={1.75} />;
  if (category === "OWNER_SETTLEMENT") return <CircleDollarSign size={15} strokeWidth={1.75} />;
  return /notice|announcement/iu.test(item.kind) ? <Megaphone size={15} strokeWidth={1.75} /> : <Bell size={15} strokeWidth={1.75} />;
}

export function NotificationCenterButton() {
  const router = useRouter();
  const { session } = useSupabaseSession();
  const token = session?.access_token;
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<NotificationCategory>("ALL");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [viewerRole, setViewerRole] = useState<NotificationViewerRole>("member");
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const unreadCount = items.filter((item) => !item.read_at).length;
  const tabs = useMemo(() => getVisibleNotificationTabs(viewerRole), [viewerRole]);
  const activeCategory = tabs.some((tab) => tab.id === category) ? category : "ALL";
  const visibleItems = useMemo(() => activeCategory === "ALL" ? items : items.filter((item) => getNotificationCategory(item.kind, item.audience_role) === activeCategory), [activeCategory, items]);
  const emptyLabel = tabs.find((tab) => tab.id === activeCategory)?.emptyLabel ?? "새로운 알림이 없습니다.";

  const loadNotifications = useCallback(async (signal?: AbortSignal) => {
    if (!token) {
      setItems([]);
      return;
    }
    const response = await fetch("/api/notifications", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) {
      throw await clientErrorFromResponse(
        response,
        "알림을 불러오지 못했습니다.",
      );
    }
    const payload = await response.json() as {
      notifications?: NotificationItem[];
      viewerRole?: NotificationViewerRole;
    };
    const role = payload.viewerRole ?? "member";
    setViewerRole(role);
    setItems(
      Array.isArray(payload.notifications)
        ? payload.notifications.filter((item) =>
            canViewNotification(role, item.audience_role, item.kind),
          )
        : [],
    );
  }, [token]);

  useEffect(() => {
    if (!token) { queueMicrotask(() => setItems([])); return; }
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (active) setLoading(true);
      void loadNotifications(controller.signal)
        .catch((error: unknown) => {
          if (!active || controller.signal.aborted) return;
          reportClientError(error, {
            dedupeKey: "notification-center-load",
            fallback: "알림을 불러오지 못했습니다.",
          });
        })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadNotifications, token]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    const client = getSupabaseBrowserClient();
    const channel = client.channel(`notification-center:${userId}:${crypto.randomUUID()}`).on("postgres_changes", { event: "INSERT", filter: `member_id=eq.${userId}`, schema: "public", table: "notifications" }, (payload) => {
      const item = payload.new as Partial<NotificationItem>;
      if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.body !== "string" || typeof item.created_at !== "string" || typeof item.kind !== "string") return;
      const audienceRole = typeof item.audience_role === "string" ? item.audience_role : "member";
      if (!canViewNotification(viewerRole, audienceRole, item.kind)) return;
      setItems((current) => [{ audience_role: audienceRole, body: item.body!, created_at: item.created_at!, href: typeof item.href === "string" ? item.href : null, id: item.id!, kind: item.kind!, read_at: null, title: item.title! }, ...current.filter((candidate) => candidate.id !== item.id)].slice(0, 50));
    }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [session?.user.id, viewerRole]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const markRead = async (item: NotificationItem) => {
    if (!token) return;
    if (!item.read_at) {
      const previousReadAt = item.read_at;
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, read_at: new Date().toISOString() } : candidate));
      try {
        const response = await fetch("/api/notifications", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ notificationId: item.id }) });
        if (!response.ok) {
          throw await clientErrorFromResponse(
            response,
            "알림을 읽음 처리하지 못했습니다.",
          );
        }
      } catch (error) {
        setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, read_at: previousReadAt } : candidate));
        reportClientError(error, {
          dedupeKey: `notification-read-${item.id}`,
          fallback: "알림을 읽음 처리하지 못했습니다.",
          userMessage: "알림 상태를 저장하지 못했습니다. 다시 시도해 주세요.",
          visibility: "always",
        });
        await loadNotifications().catch((refreshError: unknown) => {
          reportClientError(refreshError, {
            dedupeKey: "notification-center-refresh",
            fallback: "알림 상태를 다시 확인하지 못했습니다.",
          });
        });
      }
    }
    setOpen(false);
    const href = item.href?.startsWith("/") ? item.href : getNotificationFallbackHref(item.kind);
    if (href) router.push(href);
  };

  const markAllRead = async () => {
    if (!token || unreadCount === 0 || markingAll) return;
    const previousReadAt = new Map(items.map((item) => [item.id, item.read_at]));
    const readAt = new Date().toISOString();
    setMarkingAll(true);
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })));
    try {
      const response = await fetch("/api/notifications", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ markAll: true }) });
      if (!response.ok) {
        throw await clientErrorFromResponse(
          response,
          "알림을 전체 읽음 처리하지 못했습니다.",
        );
      }
    } catch (error) {
      setItems((current) => current.map((item) => previousReadAt.has(item.id) ? { ...item, read_at: previousReadAt.get(item.id) ?? null } : item));
      reportClientError(error, {
        dedupeKey: "notification-read-all",
        fallback: "알림을 전체 읽음 처리하지 못했습니다.",
        userMessage: "알림 상태를 저장하지 못했습니다. 다시 시도해 주세요.",
        visibility: "always",
      });
      await loadNotifications().catch((refreshError: unknown) => {
        reportClientError(refreshError, {
          dedupeKey: "notification-center-refresh",
          fallback: "알림 상태를 다시 확인하지 못했습니다.",
        });
      });
    } finally {
      setMarkingAll(false);
    }
  };

  if (!session) return null;
  return <>
    <button aria-expanded={open} aria-haspopup="dialog" aria-label={unreadCount > 0 ? `알림, 읽지 않은 알림 ${unreadCount}건` : "알림"} className="relative grid size-10 shrink-0 place-items-center border border-line text-muted transition-colors hover:border-ink hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink" onClick={() => setOpen(true)} type="button">
      <Bell size={17} strokeWidth={1.75} />
      {unreadCount > 0 && <span className="absolute -right-1.5 -top-1.5 grid min-h-4 min-w-4 animate-pulse place-items-center rounded-full bg-red-600 px-1 text-[8px] font-black leading-4 text-white">{Math.min(unreadCount, 99)}</span>}
    </button>
    {open && <div aria-modal="true" className="fixed inset-0 z-[210] flex items-end bg-black/50 sm:items-start sm:justify-end sm:bg-transparent sm:p-4" onClick={() => setOpen(false)} role="dialog">
      <section className="flex max-h-[82svh] w-full flex-col rounded-t-3xl border border-line bg-paper text-ink shadow-2xl sm:mt-14 sm:w-96 sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-line px-5 py-4"><div><p className="eyebrow text-muted">알림 센터</p><h2 className="mt-1 text-xl font-black">새로운 소식 <span className="font-mono text-sm text-red-600">{unreadCount}</span></h2></div><button aria-label="알림 닫기" className="grid size-9 place-items-center rounded-xl hover:bg-surface" onClick={() => setOpen(false)} type="button"><X size={17} /></button></header>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-[10px]"><button className="inline-flex min-h-11 items-center gap-1 font-bold disabled:opacity-40" disabled={unreadCount === 0 || markingAll} onClick={() => void markAllRead()} type="button"><CheckCheck size={14} /> {markingAll ? "처리 중…" : "전체 읽음 처리"}</button><Link className="inline-flex min-h-11 items-center gap-1 font-bold" href="/settings" onClick={() => setOpen(false)}><Settings size={14} /> 알림 설정</Link></div>
        <NotificationTabs active={activeCategory} onChange={setCategory} tabs={tabs} />
        <div aria-labelledby={`notification-tab-${activeCategory.toLowerCase()}`} className="min-h-48 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]" id="notification-list" role="tabpanel">
          {loading ? <NotificationSkeleton /> : visibleItems.length === 0 ? <div className="grid place-items-center px-6 py-14 text-center"><BellOff className="text-muted" size={32} /><p className="mt-3 text-sm font-bold">{emptyLabel}</p></div> : visibleItems.map((item) => <button className={`relative block w-full border-b border-line px-5 py-4 text-left transition-colors hover:bg-surface ${item.read_at ? "" : "bg-blue-500/5"}`} key={item.id} onClick={() => void markRead(item)} type="button">{!item.read_at && <span className="absolute left-2 top-6 size-1.5 rounded-full bg-blue-500" />}<span className="flex items-start gap-3"><span className={`grid size-8 shrink-0 place-items-center rounded-full ${item.read_at ? "bg-surface text-muted" : "bg-ink text-paper"}`}><NotificationIcon item={item} /></span><span className="min-w-0 flex-1"><strong className="block text-sm">{item.title}</strong><span className="mt-1 block text-xs leading-5 text-muted">{item.body}</span><time className="mt-2 block text-[10px] text-muted" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("ko-KR")}</time></span></span></button>)}
        </div>
      </section>
    </div>}
  </>;
}
