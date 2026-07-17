"use client";

import { useEffect, useState } from "react";
import { createSupabasePresenceClient } from "@/src/lib/supabase/client";

const ONLINE_MEMBERS_CHANNEL = "site-online-members-v1";
const VISITOR_ID_STORAGE_KEY = "damine-vintage-presence-id";
const VALID_VISITOR_ID = /^[a-z0-9-]{8,64}$/i;
const VISITOR_ID_TTL_MS = 12 * 60 * 60 * 1_000;
const MAX_VISIBLE_ONLINE_MEMBERS = 50;

export interface OnlineMember {
  id: string;
  displayName: string;
}

export type OnlinePresenceStatus = "connecting" | "connected" | "error";

export interface OnlineMembersState {
  members: readonly OnlineMember[];
  hasMore: boolean;
  status: OnlinePresenceStatus;
  error: string | null;
}

interface StoredVisitorIdentity {
  id: string;
  expiresAt: number;
}

function createVisitorId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateVisitorId(): string {
  try {
    const now = Date.now();
    const savedIdentity = window.localStorage.getItem(VISITOR_ID_STORAGE_KEY);
    if (savedIdentity) {
      let parsed: Partial<StoredVisitorIdentity> | null = null;
      try {
        parsed = JSON.parse(savedIdentity) as Partial<StoredVisitorIdentity>;
      } catch {
        parsed = null;
      }
      if (
        parsed &&
        typeof parsed.id === "string" &&
        VALID_VISITOR_ID.test(parsed.id) &&
        typeof parsed.expiresAt === "number" &&
        parsed.expiresAt > now &&
        parsed.expiresAt <= now + VISITOR_ID_TTL_MS
      ) {
        return parsed.id;
      }
    }

    const visitorId = createVisitorId();
    const identity: StoredVisitorIdentity = {
      id: visitorId,
      expiresAt: now + VISITOR_ID_TTL_MS,
    };
    window.localStorage.setItem(
      VISITOR_ID_STORAGE_KEY,
      JSON.stringify(identity),
    );
    return visitorId;
  } catch {
    return createVisitorId();
  }
}

function getAnonymousDisplayName(visitorId: string): string {
  const compactId = visitorId.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `방문자 ${compactId.slice(-6).padStart(6, "0")}`;
}

function refreshVisitorIdLease(visitorId: string): void {
  try {
    const savedIdentity = window.localStorage.getItem(VISITOR_ID_STORAGE_KEY);
    if (!savedIdentity) return;
    const parsed = JSON.parse(savedIdentity) as Partial<StoredVisitorIdentity>;
    if (parsed.id !== visitorId) return;

    const identity: StoredVisitorIdentity = {
      id: visitorId,
      expiresAt: Date.now() + VISITOR_ID_TTL_MS,
    };
    window.localStorage.setItem(
      VISITOR_ID_STORAGE_KEY,
      JSON.stringify(identity),
    );
  } catch {
    // Storage can be unavailable in private browsing. Presence remains usable
    // with the in-memory visitor id created for this mount.
  }
}

export function useOnlineMembers(): OnlineMembersState {
  const [members, setMembers] = useState<readonly OnlineMember[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] =
    useState<OnlinePresenceStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let cleanupChannel: (() => void) | undefined;
    let leaseTimer: number | undefined;

    const reportUnavailable = () => {
      window.queueMicrotask(() => {
        if (!active) return;
        setMembers([]);
        setHasMore(false);
        setStatus("error");
        setError("Supabase 실시간 접속 상태를 사용할 수 없습니다.");
      });
    };

    const connect = async () => {
      try {
        const client = createSupabasePresenceClient();
        const visitorId = getOrCreateVisitorId();
        if (!active) return;

        const channel = client.channel(ONLINE_MEMBERS_CHANNEL, {
          config: {
            presence: {
              key: visitorId,
              enabled: true,
            },
          },
        });

        const syncMembers = () => {
          if (!active) return;

          const presenceKeys = Object.entries(channel.presenceState())
            .filter(
              ([presenceKey, presences]) =>
                presences.length > 0 && VALID_VISITOR_ID.test(presenceKey),
            )
            .map(([presenceKey]) => presenceKey)
            .sort();
          const nextMembers = presenceKeys
            .slice(0, MAX_VISIBLE_ONLINE_MEMBERS)
            .map((presenceKey) => ({
              id: presenceKey,
              displayName: getAnonymousDisplayName(presenceKey),
            }));

          setMembers(nextMembers);
          setHasMore(presenceKeys.length > MAX_VISIBLE_ONLINE_MEMBERS);
        };

        channel
          .on("presence", { event: "sync" }, syncMembers)
          .subscribe((nextStatus) => {
            if (!active) return;

            if (nextStatus === "SUBSCRIBED") {
              setError(null);
              refreshVisitorIdLease(visitorId);
              void channel
                .track({})
                .then((response) => {
                  if (!active) return;
                  if (response !== "ok") {
                    throw new Error(`Presence track failed: ${response}`);
                  }
                  setStatus("connected");
                })
                .catch(() => {
                  if (!active) return;
                  setMembers([]);
                  setHasMore(false);
                  setStatus("error");
                  setError("실시간 접속 상태를 연결하지 못했습니다.");
                });
              return;
            }

            if (
              nextStatus === "CHANNEL_ERROR" ||
              nextStatus === "TIMED_OUT" ||
              nextStatus === "CLOSED"
            ) {
              setMembers([]);
              setHasMore(false);
              setStatus("error");
              setError("실시간 접속 상태 연결이 끊어졌습니다.");
            }
          });

        leaseTimer = window.setInterval(
          () => refreshVisitorIdLease(visitorId),
          VISITOR_ID_TTL_MS / 4,
        );
        cleanupChannel = () => {
          if (leaseTimer !== undefined) window.clearInterval(leaseTimer);
          void channel.untrack().catch(() => undefined);
          void client.removeChannel(channel).catch(() => undefined);
        };
      } catch {
        reportUnavailable();
      }
    };

    void connect();

    return () => {
      active = false;
      if (leaseTimer !== undefined) window.clearInterval(leaseTimer);
      cleanupChannel?.();
    };
  }, []);

  return { members, hasMore, status, error };
}
