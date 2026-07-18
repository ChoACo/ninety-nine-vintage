"use client";

import { useEffect, useState } from "react";

import { shouldTrackPresence, type AppRole } from "@/src/lib/supabase/auth";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";

const MAX_VISIBLE_ONLINE_MEMBERS = 50;
const ONLINE_HEARTBEAT_INTERVAL_MS = 25_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OnlineMember {
  id: string;
  displayName: string;
  isOperator: boolean;
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
    member: { id: row.id, displayName, isOperator: row.is_operator },
    totalCount,
  };
}

export function useOnlineMembers({
  enabled = true,
  userId = null,
  role = null,
}: UseOnlineMembersOptions = {}): OnlineMembersState {
  const [members, setMembers] = useState<readonly OnlineMember[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<OnlinePresenceStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const shouldPublishPresence = Boolean(role && shouldTrackPresence(role));
  const isDisabled =
    !enabled ||
    !userId ||
    !role ||
    role === "unauthorized";

  useEffect(() => {
    if (isDisabled) return;

    let active = true;
    let requestInFlight = false;
    const client = getSupabaseBrowserClient();

    const syncServerVerifiedMembers = async () => {
      if (!active || requestInFlight) return;
      if (document.visibilityState !== "visible") return;
      requestInFlight = true;

      try {
        // Owners and employees may view the directory, but remain invisible:
        // only public presence roles publish a heartbeat.
        if (shouldPublishPresence) {
          const { error: heartbeatError } = await client.rpc(
            "touch_my_last_seen",
          );
          if (heartbeatError) throw heartbeatError;
        }

        const { data, error: directoryError } = await client.rpc(
          "get_online_member_directory",
          { p_limit: MAX_VISIBLE_ONLINE_MEMBERS },
        );
        if (directoryError) throw directoryError;

        const normalizedRows = (Array.isArray(data) ? data : [])
          .map(normalizeOnlineMember)
          .filter(
            (
              row,
            ): row is { member: OnlineMember; totalCount: number } => row !== null,
          );
        const nextMembers = normalizedRows
          .map((row) => row.member)
          .sort((left, right) =>
            Number(right.isOperator) - Number(left.isOperator) ||
            left.displayName.localeCompare(right.displayName, "ko-KR"),
          );
        const nextTotalCount = normalizedRows[0]?.totalCount ?? 0;

        if (!active) return;
        setMembers(nextMembers);
        setTotalCount(nextTotalCount);
        setHasMore(nextTotalCount > nextMembers.length);
        setStatus("connected");
        setError(null);
      } catch {
        if (!active) return;
        setMembers([]);
        setTotalCount(0);
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
  }, [isDisabled, shouldPublishPresence]);

  return isDisabled
    ? {
        members: [],
        totalCount: 0,
        hasMore: false,
        status: "connected",
        error: null,
      }
    : { members, totalCount, hasMore, status, error };
}
