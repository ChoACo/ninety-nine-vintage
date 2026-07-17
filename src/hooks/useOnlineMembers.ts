"use client";

import { useEffect, useState } from "react";

import {
  isOwnerRole,
  shouldTrackPresence,
  type AppRole,
} from "@/src/lib/supabase/auth";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";

const MAX_VISIBLE_ONLINE_MEMBERS = 50;
const ONLINE_HEARTBEAT_INTERVAL_MS = 25_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

interface UseOnlineMembersOptions {
  enabled?: boolean;
  userId?: string | null;
  role?: AppRole | null;
}

interface OnlineMemberRow {
  id?: unknown;
  display_name?: unknown;
}

function normalizeOnlineMember(value: unknown): OnlineMember | null {
  if (!value || typeof value !== "object") return null;
  const row = value as OnlineMemberRow;
  if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) return null;
  if (typeof row.display_name !== "string") return null;
  const displayName = row.display_name.trim();
  if (!displayName || displayName.length > 80) return null;
  return { id: row.id, displayName };
}

export function useOnlineMembers({
  enabled = true,
  userId = null,
  role = null,
}: UseOnlineMembersOptions = {}): OnlineMembersState {
  const [members, setMembers] = useState<readonly OnlineMember[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<OnlinePresenceStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const isDisabled =
    !enabled ||
    !userId ||
    !role ||
    isOwnerRole(role) ||
    !shouldTrackPresence(role);

  useEffect(() => {
    if (isDisabled) return;

    let active = true;
    let requestInFlight = false;
    const client = getSupabaseBrowserClient();

    const syncServerVerifiedMembers = async () => {
      if (!active || requestInFlight) return;
      requestInFlight = true;

      try {
        const { error: heartbeatError } = await client.rpc("touch_my_last_seen");
        if (heartbeatError) throw heartbeatError;

        const { data, error: directoryError } = await client.rpc(
          "get_online_member_directory",
          { p_limit: MAX_VISIBLE_ONLINE_MEMBERS + 1 },
        );
        if (directoryError) throw directoryError;

        const nextMembers = (Array.isArray(data) ? data : [])
          .map(normalizeOnlineMember)
          .filter((member): member is OnlineMember => member !== null)
          .sort((left, right) =>
            left.displayName.localeCompare(right.displayName, "ko-KR"),
          );

        if (!active) return;
        setMembers(nextMembers.slice(0, MAX_VISIBLE_ONLINE_MEMBERS));
        setHasMore(nextMembers.length > MAX_VISIBLE_ONLINE_MEMBERS);
        setStatus("connected");
        setError(null);
      } catch {
        if (!active) return;
        setMembers([]);
        setHasMore(false);
        setStatus("error");
        setError("온라인 접속 상태를 확인하지 못했습니다.");
      } finally {
        requestInFlight = false;
      }
    };

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
    };
  }, [isDisabled]);

  return isDisabled
    ? { members: [], hasMore: false, status: "connected", error: null }
    : { members, hasMore, status, error };
}
