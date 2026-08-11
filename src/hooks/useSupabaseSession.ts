"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type BrowserClient = ReturnType<typeof getSupabaseBrowserClient>;

type SessionValidation =
  | { kind: "authenticated"; session: Session }
  | { kind: "invalid" }
  | { kind: "superseded" }
  | { kind: "unavailable" };

let sessionValidationFlight: {
  accessToken: string;
  promise: Promise<SessionValidation>;
} | null = null;
let sessionDiscardFlight: {
  accessToken: string;
  promise: Promise<void>;
} | null = null;

function isAuthoritativeAuthRejection(reason: unknown) {
  if (!reason || typeof reason !== "object") return false;
  const error = reason as { code?: unknown; name?: unknown; status?: unknown };
  if (error.status === 401 || error.status === 403) return true;
  return error.name === "AuthSessionMissingError"
    || error.code === "session_not_found"
    || error.code === "bad_jwt"
    || error.code === "invalid_jwt";
}

async function validateCurrentSession(
  client: BrowserClient,
  candidate: Session,
): Promise<SessionValidation> {
  if (sessionValidationFlight?.accessToken === candidate.access_token) {
    return sessionValidationFlight.promise;
  }

  const promise = (async (): Promise<SessionValidation> => {
    try {
      const before = (await client.auth.getSession()).data.session;
      if (before?.access_token !== candidate.access_token) {
        return { kind: "superseded" };
      }

      // Unlike getSession(), getUser() asks Supabase Auth to authenticate the
      // current token. Never expose locally persisted identity before this.
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) {
        return isAuthoritativeAuthRejection(error)
          ? { kind: "invalid" }
          : { kind: "unavailable" };
      }

      const after = (await client.auth.getSession()).data.session;
      if (!after || after.user.id !== data.user.id) return { kind: "invalid" };
      if (after.user.id !== candidate.user.id) return { kind: "superseded" };
      return { kind: "authenticated", session: after };
    } catch {
      return { kind: "unavailable" };
    }
  })();

  sessionValidationFlight = { accessToken: candidate.access_token, promise };
  try {
    return await promise;
  } finally {
    if (sessionValidationFlight?.promise === promise) {
      sessionValidationFlight = null;
    }
  }
}

async function discardInvalidSession(
  client: BrowserClient,
  rejected: Session,
) {
  if (sessionDiscardFlight?.accessToken === rejected.access_token) {
    return sessionDiscardFlight.promise;
  }

  const promise = (async () => {
    try {
      const current = (await client.auth.getSession()).data.session;
      if (current?.access_token === rejected.access_token) {
        await client.auth.signOut({ scope: "local" });
      }
    } catch {
      // Publishing a guest state still prevents private requests when local
      // storage is unavailable or the auth client cannot finish local sign-out.
    }
  })();

  sessionDiscardFlight = { accessToken: rejected.access_token, promise };
  try {
    await promise;
  } finally {
    if (sessionDiscardFlight?.promise === promise) {
      sessionDiscardFlight = null;
    }
  }
}

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
    let validationSequence = 0;
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

    const validateAndPublish = async (
      client: BrowserClient,
      session: Session | null,
      eventSequence: number,
    ) => {
      const currentValidation = ++validationSequence;
      if (!session) {
        publish(null);
        return;
      }

      const validation = await validateCurrentSession(client, session);
      if (
        !active
        || eventSequence !== authEventSequence
        || currentValidation !== validationSequence
      ) return;

      if (validation.kind === "authenticated") {
        publish(validation.session);
        return;
      }
      if (validation.kind === "invalid") {
        await discardInvalidSession(client, session);
      }
      if (validation.kind !== "superseded") publish(null);
    };

    try {
      const client = getSupabaseBrowserClient();
      const { data: listener } = client.auth.onAuthStateChange(
        (_event, session) => {
          authEventSequence += 1;
          const eventSequence = authEventSequence;
          // Keep Supabase auth callbacks synchronous; validation may call back
          // into auth and therefore runs after the callback has returned.
          window.setTimeout(() => {
            void validateAndPublish(client, session, eventSequence);
          }, 0);
        },
      );
      const sequenceBeforeRead = authEventSequence;
      void client.auth
        .getSession()
        .then(({ data }) => {
          if (authEventSequence === sequenceBeforeRead) {
            void validateAndPublish(client, data.session, sequenceBeforeRead);
          }
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
