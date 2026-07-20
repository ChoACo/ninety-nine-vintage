"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface SupabaseSessionState {
  identityRevision: number;
  loading: boolean;
  revision: number;
  session: Session | null;
}

export function useSupabaseSession(): SupabaseSessionState {
  const [state, setState] = useState<SupabaseSessionState>({
    identityRevision: 0,
    loading: true,
    revision: 0,
    session: null,
  });

  useEffect(() => {
    let active = true;
    let authEventSequence = 0;
    let lastSessionKey: string | null = null;
    let lastUserId: string | null | undefined;

    const publish = (session: Session | null) => {
      if (!active) return;
      const userId = session?.user.id ?? null;
      const sessionKey = session
        ? `${session.user.id}:${session.access_token}:${session.user.updated_at ?? ""}:${JSON.stringify(session.user.user_metadata ?? {})}:${JSON.stringify(session.user.app_metadata ?? {})}`
        : "guest";
      if (lastSessionKey === sessionKey) return;
      const identityChanged =
        lastUserId !== undefined && lastUserId !== userId;
      lastSessionKey = sessionKey;
      lastUserId = userId;
      setState((current) => ({
        identityRevision:
          current.identityRevision + (identityChanged ? 1 : 0),
        loading: false,
        revision: current.revision + 1,
        session,
      }));
    };

    try {
      const client = getSupabaseBrowserClient();
      const { data: listener } = client.auth.onAuthStateChange(
        (_event, session) => {
          authEventSequence += 1;
          publish(session);
        },
      );
      const sequenceBeforeRead = authEventSequence;
      void client.auth
        .getSession()
        .then(({ data }) => {
          if (authEventSequence === sequenceBeforeRead) publish(data.session);
        })
        .catch(() => {
          if (authEventSequence === sequenceBeforeRead) publish(null);
        });

      return () => {
        active = false;
        listener.subscription.unsubscribe();
      };
    } catch {
      queueMicrotask(() => publish(null));
      return () => {
        active = false;
      };
    }
  }, []);

  return state;
}
