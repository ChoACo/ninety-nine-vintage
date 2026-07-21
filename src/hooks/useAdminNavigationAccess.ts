"use client";

import { useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface AdminNavigationSnapshot {
  canAccessOperator: boolean;
  canAccessOwner: boolean;
  revision: number;
  userId: string;
}

const EMPTY_SNAPSHOT: AdminNavigationSnapshot = {
  canAccessOperator: false,
  canAccessOwner: false,
  revision: -1,
  userId: "",
};

export function useAdminNavigationAccess() {
  const { loading, revision, session } = useSupabaseSession();
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const userId = session?.user.id ?? "";

  useEffect(() => {
    if (loading || !session) return;
    const controller = new AbortController();
    const expectedRevision = revision;
    const expectedUserId = session.user.id;

    void fetch("/api/admin/session", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          session?: {
            canAccessOperator?: boolean;
            canAccessOwner?: boolean;
            userId?: string;
          };
        };
        if (!response.ok || payload.session?.userId !== expectedUserId) {
          throw new Error("admin-navigation-unavailable");
        }
        setSnapshot({
          canAccessOperator: payload.session.canAccessOperator === true,
          canAccessOwner: payload.session.canAccessOwner === true,
          revision: expectedRevision,
          userId: expectedUserId,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSnapshot({
          canAccessOperator: false,
          canAccessOwner: false,
          revision: expectedRevision,
          userId: expectedUserId,
        });
      });

    return () => controller.abort();
  }, [loading, revision, session]);

  const current = Boolean(userId)
    && snapshot.userId === userId
    && snapshot.revision === revision;
  return {
    canAccessOperator: current && snapshot.canAccessOperator,
    canAccessOwner: current && snapshot.canAccessOwner,
    loading: loading || (Boolean(userId) && !current),
  };
}
