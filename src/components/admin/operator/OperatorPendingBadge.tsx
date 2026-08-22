"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type PendingKind = "shipping" | "orders";

export function OperatorPendingBadge({ kind }: Readonly<{ kind: PendingKind }>) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        if (!session?.access_token) return;
        const endpoint = kind === "shipping"
          ? "/api/admin/operator/shipping?limit=1"
          : "/api/admin/operator/orders?summary=1";
        const response = await fetch(endpoint, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) return;
        const data = await response.json() as { totalCount?: number; activeCount?: number };
        if (!cancelled) setCount(kind === "shipping" ? data.totalCount ?? 0 : data.activeCount ?? 0);
      } catch {
        // The menu remains usable if a secondary count endpoint is unavailable.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [kind]);

  if (count === null || count === 0) return null;
  return <span aria-label={`${count}건 대기`} className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-black tabular-nums text-zinc-950" role="status">{Math.min(count, 99)}</span>;
}
