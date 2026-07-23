"use client";

import { useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface AdminNavigationSnapshot {
  canAccessEmployee: boolean;
  canAccessOperator: boolean;
  canAccessOwner: boolean;
  roleCode: string;
  revision: number;
  userId: string;
}

const EMPTY_SNAPSHOT: AdminNavigationSnapshot = {
  canAccessEmployee: false,
  canAccessOperator: false,
  canAccessOwner: false,
  roleCode: "",
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
            canAccessEmployee?: boolean;
            canAccessOperator?: boolean;
            canAccessOwner?: boolean;
            roleCode?: string;
            userId?: string;
          };
        };
        if (!response.ok || payload.session?.userId !== expectedUserId) {
          throw new Error("admin-navigation-unavailable");
        }
        setSnapshot({
          canAccessEmployee: payload.session.canAccessEmployee === true,
          canAccessOperator: payload.session.canAccessOperator === true,
          canAccessOwner: payload.session.canAccessOwner === true,
          roleCode: payload.session.roleCode ?? "",
          revision: expectedRevision,
          userId: expectedUserId,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSnapshot({
          canAccessEmployee: false,
          canAccessOperator: false,
          canAccessOwner: false,
          roleCode: "",
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
    canAccessEmployee: current && snapshot.canAccessEmployee,
    canAccessOperator: current && snapshot.canAccessOperator,
    canAccessOwner: current && snapshot.canAccessOwner,
    roleCode: current ? snapshot.roleCode : "",
    loading: loading || (Boolean(userId) && !current),
  };
}
