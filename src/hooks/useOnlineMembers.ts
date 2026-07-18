"use client";

import { useEffect, useMemo, useState } from "react";

import { shouldTrackPresence, type AppRole } from "@/src/lib/supabase/auth";
import {
  createSupabasePresenceClient,
  getSupabaseBrowserClient,
} from "@/src/lib/supabase/client";

const MAX_VISIBLE_ONLINE_MEMBERS = 50;
const ONLINE_HEARTBEAT_INTERVAL_MS = 25_000;
const PUBLIC_GUEST_PRESENCE_CHANNEL = "public-online-guests-v1";
const GUEST_SESSION_KEY = "ninety-nine-guest-presence-id";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_ID_PATTERN = /^[A-F0-9]{8}$/;

export interface OnlineMember {
  id: string;
  displayName: string;
  isOperator: boolean;
  isGuest: boolean;
}

export type OnlinePresenceStatus = "connecting" | "connected" | "error";

export interface OnlineMembersState {
  members: readonly OnlineMember[];
  totalCount: number;
  hasMore: boolean;
  status: OnlinePresenceStatus;
  error: string | null;
}

interface UseOnlineMembersOptions {
  enabled?: boolean;
  userId?: string | null;
  role?: AppRole | null;
}

interface OnlineMemberRow {
  id?: unknown;
  display_name?: unknown;
  is_operator?: unknown;
  total_count?: unknown;
}

interface GuestPresencePayload {
  guest_id?: unknown;
}

function normalizeOnlineMember(
  value: unknown,
): { member: OnlineMember; totalCount: number } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as OnlineMemberRow;
  if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) return null;
  if (typeof row.display_name !== "string") return null;
  if (typeof row.is_operator !== "boolean") return null;
  const displayName = row.display_name.trim();
  if (!displayName || displayName.length > 80) return null;
  const totalCount = Number(row.total_count);
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) return null;
  return {
    member: {
      id: row.id,
      displayName,
      isOperator: row.is_operator,
      isGuest: false,
    },
    totalCount,
  };
}

function createGuestId(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function getOrCreateGuestId(): string {
  try {
    const stored = window.sessionStorage.getItem(GUEST_SESSION_KEY);
    if (stored && GUEST_ID_PATTERN.test(stored)) return stored;
    const created = createGuestId();
    window.sessionStorage.setItem(GUEST_SESSION_KEY, created);
    return created;
  } catch {
    return createGuestId();
  }
}

function normalizeGuestPresence(value: unknown): OnlineMember[] {
  if (!value || typeof value !== "object") return [];

  const guestIds = new Set<string>();
  for (const presences of Object.values(value)) {
    if (!Array.isArray(presences)) continue;
    for (const presence of presences) {
      if (!presence || typeof presence !== "object") continue;
      const rawGuestId = (presence as GuestPresencePayload).guest_id;
      if (typeof rawGuestId !== "string") continue;
      const guestId = rawGuestId.trim().toUpperCase();
      if (GUEST_ID_PATTERN.test(guestId)) guestIds.add(guestId);
    }
  }

  return Array.from(guestIds)
    .sort((left, right) => left.localeCompare(right, "ko-KR"))
    .map((guestId) => ({
      id: `guest:${guestId}`,
      displayName: `게스트(${guestId})`,
      isOperator: false,
      isGuest: true,
    }));
}

export function useOnlineMembers({
  enabled = true,
  userId = null,
  role = null,
}: UseOnlineMembersOptions = {}): OnlineMembersState {
  const [verifiedMembers, setVerifiedMembers] = useState<
    readonly OnlineMember[]
  >([]);
  const [verifiedTotalCount, setVerifiedTotalCount] = useState(0);
  const [guestMembers, setGuestMembers] = useState<readonly OnlineMember[]>([]);
  const [directoryStatus, setDirectoryStatus] =
    useState<OnlinePresenceStatus>("connecting");
  const [guestStatus, setGuestStatus] =
    useState<OnlinePresenceStatus>("connecting");
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const shouldPublishMemberHeartbeat = Boolean(
    role && shouldTrackPresence(role),
  );
  const shouldPublishGuest = !userId || !role || role === "unauthorized";

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let requestInFlight = false;
    const client = getSupabaseBrowserClient();
    const presenceClient = createSupabasePresenceClient();
    const guestId = shouldPublishGuest ? getOrCreateGuestId() : null;
    const viewerKey = guestId
      ? `guest:${guestId}`
      : `viewer:${userId ?? globalThis.crypto.randomUUID()}`;

    const syncServerVerifiedMembers = async () => {
      if (!active || requestInFlight) return;
      if (document.visibilityState !== "visible") return;
      requestInFlight = true;

      try {
        // Owners and employees may view the directory, but remain invisible:
        // only public member/operator roles publish a database heartbeat.
        if (shouldPublishMemberHeartbeat) {
          const { error: heartbeatError } = await client.rpc(
            "touch_my_last_seen",
          );
          if (heartbeatError) throw heartbeatError;
        }

        const { data, error: directoryQueryError } = await client.rpc(
          "get_online_member_directory",
          { p_limit: MAX_VISIBLE_ONLINE_MEMBERS },
        );
        if (directoryQueryError) throw directoryQueryError;

        const normalizedRows = (Array.isArray(data) ? data : [])
          .map(normalizeOnlineMember)
          .filter(
            (
              row,
            ): row is { member: OnlineMember; totalCount: number } => row !== null,
          );
        const nextMembers = normalizedRows
          .map((row) => row.member)
          .sort(
            (left, right) =>
              Number(right.isOperator) - Number(left.isOperator) ||
              left.displayName.localeCompare(right.displayName, "ko-KR"),
          );
        const nextTotalCount = normalizedRows[0]?.totalCount ?? 0;

        if (!active) return;
        setVerifiedMembers(nextMembers);
        setVerifiedTotalCount(nextTotalCount);
        setDirectoryStatus("connected");
        setDirectoryError(null);
      } catch {
        if (!active) return;
        setVerifiedMembers([]);
        setVerifiedTotalCount(0);
        setDirectoryStatus("error");
        setDirectoryError("로그인 회원의 온라인 상태를 확인하지 못했습니다.");
      } finally {
        requestInFlight = false;
      }
    };

    const guestChannel = presenceClient.channel(PUBLIC_GUEST_PRESENCE_CHANNEL, {
      config: { presence: { key: viewerKey } },
    });
    guestChannel
      .on("presence", { event: "sync" }, () => {
        if (!active) return;
        setGuestMembers(normalizeGuestPresence(guestChannel.presenceState()));
      })
      .subscribe(async (channelStatus) => {
        if (!active) return;
        if (channelStatus === "SUBSCRIBED") {
          if (guestId) {
            const trackStatus = await guestChannel.track({ guest_id: guestId });
            if (!active) return;
            if (trackStatus !== "ok") {
              setGuestStatus("error");
              setGuestError("게스트 접속 상태를 공유하지 못했습니다.");
              return;
            }
          }
          setGuestMembers(normalizeGuestPresence(guestChannel.presenceState()));
          setGuestStatus("connected");
          setGuestError(null);
          return;
        }
        if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT") {
          setGuestStatus("error");
          setGuestError("게스트 실시간 접속 연결이 지연되고 있습니다.");
        }
      });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncServerVerifiedMembers();
      }
    };

    void syncServerVerifiedMembers();
    const interval = window.setInterval(
      () => void syncServerVerifiedMembers(),
      ONLINE_HEARTBEAT_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (guestId) void guestChannel.untrack();
      void presenceClient.removeChannel(guestChannel);
    };
  }, [enabled, role, shouldPublishGuest, shouldPublishMemberHeartbeat, userId]);

  const combined = useMemo(() => {
    const members = [...verifiedMembers, ...guestMembers];
    const totalCount = verifiedTotalCount + guestMembers.length;
    return {
      members: members.slice(0, MAX_VISIBLE_ONLINE_MEMBERS),
      totalCount,
      hasMore: totalCount > MAX_VISIBLE_ONLINE_MEMBERS,
    };
  }, [guestMembers, verifiedMembers, verifiedTotalCount]);

  if (!enabled) {
    return {
      members: [],
      totalCount: 0,
      hasMore: false,
      status: "connected",
      error: null,
    };
  }

  const status: OnlinePresenceStatus =
    directoryStatus === "error" || guestStatus === "error"
      ? "error"
      : directoryStatus === "connecting" || guestStatus === "connecting"
        ? "connecting"
        : "connected";

  return {
    ...combined,
    status,
    error: directoryError ?? guestError,
  };
}
