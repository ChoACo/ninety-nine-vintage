"use client";

import { useEffect, useState } from "react";
import { OperatorStoreScopeSelector } from "@/components/admin/operator/OperatorStoreScopeSelector";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

/**
 * Owners may inspect the employee workspace, but their support session still
 * needs the same explicit store scope as the operator workspace. Employees do
 * not see this control because their APIs use their assigned memberships.
 */
export function EmployeeOwnerScopeBridge() {
  const { session } = useSupabaseSession();
  const [showSelector, setShowSelector] = useState(false);

  useEffect(() => {
    if (!session) {
      queueMicrotask(() => setShowSelector(false));
      return;
    }
    const controller = new AbortController();
    void fetch("/api/admin/session", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    })
      .then((response) => response.json() as Promise<{ session?: { roleCode?: string } }>)
      .then((payload) => setShowSelector(payload.session?.roleCode === "owner"))
      .catch(() => setShowSelector(false));
    return () => controller.abort();
  }, [session]);

  return showSelector ? (
    <div className="mb-4 flex justify-end">
      <OperatorStoreScopeSelector />
    </div>
  ) : null;
}
