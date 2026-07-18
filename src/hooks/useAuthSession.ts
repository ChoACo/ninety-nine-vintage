"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";
import {
  getUserRole,
  mapAccessRoleToAppRole,
  signOut as signOutFromSupabase,
  type AppRole,
} from "@/src/lib/supabase/auth";
import {
  getOrCreateSecurityClientSessionId,
  recordSecuritySession as recordSecuritySessionRequest,
  SecurityAuditError,
} from "@/src/lib/securityAudit/client";

interface OwnProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface ProfileQueryError {
  message: string;
}

interface ProfileQueryClient {
  from(table: "profiles"): {
    select(columns: string): {
      eq(column: "id", value: string): {
        maybeSingle(): PromiseLike<{
          data: OwnProfileRow | null;
          error: ProfileQueryError | null;
        }>;
      };
    };
  };
}

type AccessRpcName =
  | "current_access_role"
  | "is_staff"
  | "is_member"
  | "can_manage_products"
  | "touch_my_last_seen";

interface AccessRpcClient {
  rpc(functionName: AccessRpcName): PromiseLike<{
    data: unknown;
    error: ProfileQueryError | null;
  }>;
}

export interface AuthProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: AppRole;
}

export interface AuthSessionState {
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  role: AppRole;
  isLoading: boolean;
  isNetworkBlocked: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

type SecuritySessionEvent =
  | "session_started"
  | "heartbeat"
  | "session_resumed";

async function recordSecuritySession(
  currentSession: Session,
  event: SecuritySessionEvent,
): Promise<"allowed" | "blocked" | "unavailable"> {
  try {
    await recordSecuritySessionRequest(currentSession.access_token, {
      clientSessionId: getOrCreateSecurityClientSessionId(),
      event,
    });
    return "allowed";
  } catch (error) {
    if (error instanceof SecurityAuditError && error.status === 403) {
      return "blocked";
    }
    // Telemetry retries on the next heartbeat. Supabase RLS remains the
    // authorization boundary during a temporary API outage.
    return "unavailable";
  }
}

function readMetadataString(user: User, keys: string[]): string | null {
  for (const key of keys) {
    const value = user.user_metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function createProfile(
  user: User,
  profileRow: OwnProfileRow | null,
  role: AppRole,
): AuthProfile {
  const fallbackName =
    readMetadataString(user, ["full_name", "name", "nickname", "user_name"]) ||
    "회원";
  const fallbackAvatar = readMetadataString(user, [
    "avatar_url",
    "picture",
    "profile_image",
  ]);

  return {
    id: user.id,
    displayName: profileRow?.display_name?.trim() || fallbackName,
    avatarUrl: profileRow?.avatar_url?.trim() || fallbackAvatar,
    role,
  };
}

async function fetchOwnProfile(
  user: User,
  role: AppRole,
): Promise<AuthProfile> {
  // The generated database type can lag one migration behind. This narrow
  // facade keeps the query typed while RLS still guarantees that only the
  // signed-in user's profile row is readable to a member.
  const profileClient = getSupabaseBrowserClient() as unknown as ProfileQueryClient;
  const { data, error } = await profileClient
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return createProfile(user, data, role);
}

export function useAuthSession(): AuthSessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [role, setRole] = useState<AppRole>("unauthorized");
  const [isLoading, setIsLoading] = useState(true);
  const [isNetworkBlocked, setIsNetworkBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadProfile = useCallback(async (user: User | null, nextRole: AppRole) => {
    const requestId = ++requestIdRef.current;

    if (!user) {
      setProfile(null);
      setError(null);
      return;
    }

    try {
      const nextProfile = await fetchOwnProfile(user, nextRole);
      if (requestId === requestIdRef.current) {
        setProfile(nextProfile);
        setError(null);
      }
    } catch {
      if (requestId === requestIdRef.current) {
        // Authentication remains usable even if the profile migration has not
        // reached the environment yet. Kakao metadata provides a safe fallback.
        setProfile(createProfile(user, null, nextRole));
        setError("회원 프로필 정보를 불러오지 못했어요.");
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user ?? null, role);
  }, [loadProfile, role, session]);

  const handleSignOut = useCallback(async () => {
    await signOutFromSupabase();
    setSession(null);
    setProfile(null);
    setRole("unauthorized");
    setIsNetworkBlocked(false);
    setError(null);
  }, []);

  const rejectBlockedSession = useCallback(async () => {
    setIsNetworkBlocked(true);
    setSession(null);
    setProfile(null);
    setRole("unauthorized");
    setError("보안 정책에 따라 현재 네트워크의 접속이 차단되었습니다.");
    try {
      await getSupabaseBrowserClient().auth.signOut();
    } catch {
      // The local blocked state remains authoritative until the page reloads.
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const client = getSupabaseBrowserClient();

    const resolveAuthorizedRole = async (user: User): Promise<AppRole> => {
      if (getUserRole(user) === "unauthorized") return "unauthorized";

      const rpcClient = client as unknown as AccessRpcClient;
      const { data: accessRole, error: roleError } = await rpcClient.rpc(
        "current_access_role",
      );
      if (roleError) return "unauthorized";

      const nextRole = mapAccessRoleToAppRole(accessRole);
      if (nextRole === "unauthorized") return nextRole;

      const accessFunction: AccessRpcName =
        nextRole === "admin" || nextRole === "operator"
          ? "is_staff"
          : nextRole === "employee"
            ? "can_manage_products"
            : "is_member";
      const { data: hasAccess, error: accessError } = await rpcClient.rpc(
        accessFunction,
      );
      if (accessError || hasAccess !== true) return "unauthorized";

      // The service owner must remain absent from last-seen and presence data.
      // A last-seen write is informational, so a temporary failure must not
      // invalidate an otherwise authorized Kakao session.
      if (nextRole !== "admin") {
        await rpcClient.rpc("touch_my_last_seen");
      }

      return nextRole;
    };

    const rejectSession = async () => {
      await client.auth.signOut();
      if (!mounted) return;
      setSession(null);
      setProfile(null);
      setRole("unauthorized");
      setIsNetworkBlocked(false);
      setError("카카오 회원 또는 등록된 스태프 계정으로 로그인해 주세요.");
    };

    const initialize = async () => {
      try {
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (!mounted) return;

        if (data.session?.user) {
          const nextRole = await resolveAuthorizedRole(data.session.user);
          if (nextRole === "unauthorized") {
            await rejectSession();
            return;
          }
          const securityState = await recordSecuritySession(
            data.session,
            "session_started",
          );
          if (securityState === "blocked") {
            if (mounted) await rejectBlockedSession();
            return;
          }
          if (!mounted) return;
          setIsNetworkBlocked(false);
          setSession(data.session);
          setRole(nextRole);
          await loadProfile(data.session.user, nextRole);
        } else {
          setSession(null);
          setRole("unauthorized");
          await loadProfile(null, "unauthorized");
        }
      } catch {
        if (mounted) setError("로그인 상태를 확인하지 못했어요.");
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    void initialize();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;

      if (nextSession?.user) {
        setSession(null);
        setProfile(null);
        setRole("unauthorized");
        setIsLoading(true);
        window.setTimeout(() => {
          void (async () => {
            const nextRole = await resolveAuthorizedRole(nextSession.user);
            if (nextRole === "unauthorized") {
              await rejectSession();
              if (mounted) setIsLoading(false);
              return;
            }
            const securityState = await recordSecuritySession(
              nextSession,
              "session_resumed",
            );
            if (securityState === "blocked") {
              if (mounted) await rejectBlockedSession();
              if (mounted) setIsLoading(false);
              return;
            }
            if (!mounted) return;
            setIsNetworkBlocked(false);
            setSession(nextSession);
            setRole(nextRole);
            setIsLoading(false);
            await loadProfile(nextSession.user, nextRole);
          })();
        }, 0);
        return;
      }

      setSession(nextSession);
      setRole("unauthorized");
      setIsLoading(false);
      // Keep the auth callback synchronous; profile fetching starts after the
      // Supabase auth lock has been released.
      window.setTimeout(() => {
        if (mounted) void loadProfile(null, "unauthorized");
      }, 0);
    });

    return () => {
      mounted = false;
      requestIdRef.current += 1;
      subscription.unsubscribe();
    };
  }, [loadProfile, rejectBlockedSession]);

  useEffect(() => {
    if (!session || isNetworkBlocked) return;

    let active = true;
    let inFlight = false;
    const send = async (event: SecuritySessionEvent) => {
      if (!active || inFlight) return;
      inFlight = true;
      const securityState = await recordSecuritySession(session, event);
      inFlight = false;
      if (active && securityState === "blocked") {
        await rejectBlockedSession();
      }
    };
    const intervalId = window.setInterval(() => {
      void send("heartbeat");
    }, 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void send("session_resumed");
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isNetworkBlocked, rejectBlockedSession, session]);

  const user = session?.user ?? null;

  return {
    session,
    user,
    profile,
    role,
    isLoading,
    isNetworkBlocked,
    error,
    refreshProfile,
    signOut: handleSignOut,
  };
}
