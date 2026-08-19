"use client";

import { Bell, Check, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface NotificationItem {
  body: string;
  created_at: string;
  href: string | null;
  id: string;
  read_at: string | null;
  title: string;
}

export function NotificationCenterButton() {
  const { session } = useSupabaseSession();
  const token = session?.access_token;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const unreadCount = items.filter((item) => !item.read_at).length;

  useEffect(() => {
    if (!token) {
      queueMicrotask(() => setItems([]));
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (active) setLoading(true);
    });
    void fetch("/api/notifications", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((response) => response.ok ? response.json() as Promise<{ notifications?: NotificationItem[] }> : Promise.reject(new Error("notifications_unavailable")))
      .then((payload) => {
        if (active) setItems(Array.isArray(payload.notifications) ? payload.notifications : []);
      })
      .catch(() => {
        if (active) setItems([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    const client = getSupabaseBrowserClient();
    const channel = client.channel(`notification-center:${userId}:${crypto.randomUUID()}`).on("postgres_changes", { event: "INSERT", filter: `member_id=eq.${userId}`, schema: "public", table: "notifications" }, (payload) => {
      const item = payload.new as Partial<NotificationItem>;
      if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.body !== "string" || typeof item.created_at !== "string") return;
      setItems((current) => [{ body: item.body!, created_at: item.created_at!, href: typeof item.href === "string" ? item.href : null, id: item.id!, read_at: null, title: item.title! }, ...current.filter((candidate) => candidate.id !== item.id)].slice(0, 50));
    }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [session?.user.id]);

  const markRead = async (item: NotificationItem) => {
    if (!token || item.read_at) return;
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, read_at: new Date().toISOString() } : candidate));
    await fetch("/api/notifications", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId: item.id }),
    }).catch(() => undefined);
  };

  if (!session) return null;
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unreadCount > 0 ? `알림, 읽지 않은 알림 ${unreadCount}건` : "알림"}
        className="relative grid size-10 shrink-0 place-items-center border border-line text-muted transition-colors hover:border-ink hover:text-ink"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Bell size={16} />
        {unreadCount > 0 && <span className="absolute -right-1.5 -top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[8px] font-black leading-4 text-white">{Math.min(unreadCount, 99)}</span>}
      </button>
      {open && (
        <div aria-modal="true" className="fixed inset-0 z-[210] bg-black/45 p-4" onClick={() => setOpen(false)} role="dialog">
          <section className="ml-auto mt-16 w-full max-w-md border border-line bg-paper text-ink shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <div><p className="eyebrow text-muted">알림 센터</p><h2 className="mt-1 text-xl font-black">새로운 소식</h2></div>
              <button aria-label="알림 닫기" className="grid size-9 place-items-center" onClick={() => setOpen(false)} type="button"><X size={17} /></button>
            </header>
            <div className="max-h-[min(32rem,70vh)] overflow-y-auto">
              {loading ? <p className="p-8 text-center text-sm text-muted">알림을 불러오는 중입니다.</p> : items.length === 0 ? <p className="p-8 text-center text-sm text-muted">새로운 알림이 없습니다.</p> : items.map((item) => {
                const content = <><div className="flex items-start gap-3"><span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${item.read_at ? "bg-surface text-muted" : "bg-ink text-paper"}`}>{item.read_at ? <Check size={13} /> : <Bell size={13} />}</span><div className="min-w-0 flex-1"><p className="text-sm font-bold">{item.title}</p><p className="mt-1 text-xs leading-5 text-muted">{item.body}</p><time className="mt-2 block text-[10px] text-muted" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("ko-KR")}</time></div></div></>;
                return item.href ? <Link className={`block border-b border-line px-5 py-4 transition-colors hover:bg-surface ${item.read_at ? "" : "bg-surface/60"}`} href={item.href} key={item.id} onClick={() => void markRead(item)}>{content}</Link> : <button className={`block w-full border-b border-line px-5 py-4 text-left transition-colors hover:bg-surface ${item.read_at ? "" : "bg-surface/60"}`} key={item.id} onClick={() => void markRead(item)} type="button">{content}</button>;
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
