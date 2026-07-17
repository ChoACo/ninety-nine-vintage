"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";
import {
  getUserRole,
  isStaffRole,
  signOut as signOutFromSupabase,
  type AppRole,
} from "@/src/lib/supabase/auth";

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
  error: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
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
): AuthProfile {
  const operatorId = user.app_metadata?.operator_id;
  const fallbackName =
    readMetadataString(user, ["full_name", "name", "nickname", "user_name"]) ||
    (typeof operatorId === "string" ? operatorId : null) ||
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
    role: getUserRole(user),
  };
}

async function fetchOwnProfile(user: User): Promise<AuthProfile> {
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
  return createProfile(user, data);
}

export function useAuthSession(): AuthSessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadProfile = useCallback(async (user: User | null) => {
    const requestId = ++requestIdRef.current;

    if (!user) {
      setProfile(null);
      setError(null);
      return;
    }

    try {
      const nextProfile = await fetchOwnProfile(user);
      if (requestId === requestIdRef.current) {
        setProfile(nextProfile);
        setError(null);
      }
    } catch {
      if (requestId === requestIdRef.current) {
        // Authentication remains usable even if the profile migration has not
        // reached the environment yet. Kakao metadata provides a safe fallback.
        setProfile(createProfile(user, null));
        setError("회원 프로필 정보를 불러오지 못했어요.");
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user ?? null);
  }, [loadProfile, session]);

  const handleSignOut = useCallback(async () => {
    await signOutFromSupabase();
    setSession(null);
    setProfile(null);
    setError(null);
  }, []);

  useEffect(() => {
    let mounted = true;
    const client = getSupabaseBrowserClient();

    const hasAuthorizedSession = async (user: User): Promise<boolean> => {
      const role = getUserRole(user);
      if (role === "unauthorized") return false;
      if (!isStaffRole(role)) return true;

      const { data, error: staffAccessError } = await client.rpc("is_staff");
      return !staffAccessError && data === true;
    };

    const rejectSession = async () => {
      await client.auth.signOut();
      if (!mounted) return;
      setSession(null);
      setProfile(null);
      setError("카카오 회원 또는 등록된 스태프 계정으로 로그인해 주세요.");
    };

    const initialize = async () => {
      try {
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (!mounted) return;

        if (
          data.session?.user &&
          !(await hasAuthorizedSession(data.session.user))
        ) {
          await rejectSession();
          return;
        }

        setSession(data.session);
        await loadProfile(data.session?.user ?? null);
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

      if (
        nextSession?.user &&
        getUserRole(nextSession.user) === "unauthorized"
      ) {
        setSession(null);
        setProfile(null);
        setIsLoading(false);
        setError("카카오 회원 또는 등록된 스태프 계정으로 로그인해 주세요.");
        window.setTimeout(() => {
          if (mounted) void client.auth.signOut();
        }, 0);
        return;
      }

      if (nextSession?.user && isStaffRole(getUserRole(nextSession.user))) {
        setSession(null);
        setProfile(null);
        setIsLoading(true);
        window.setTimeout(() => {
          void (async () => {
            if (!(await hasAuthorizedSession(nextSession.user))) {
              await rejectSession();
              if (mounted) setIsLoading(false);
              return;
            }
            if (!mounted) return;
            setSession(nextSession);
            setIsLoading(false);
            await loadProfile(nextSession.user);
          })();
        }, 0);
        return;
      }

      setSession(nextSession);
      setIsLoading(false);
      // Keep the auth callback synchronous; profile fetching starts after the
      // Supabase auth lock has been released.
      window.setTimeout(() => {
        if (mounted) void loadProfile(nextSession?.user ?? null);
      }, 0);
    });

    return () => {
      mounted = false;
      requestIdRef.current += 1;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const user = session?.user ?? null;

  return {
    session,
    user,
    profile,
    role: getUserRole(user),
    isLoading,
    error,
    refreshProfile,
    signOut: handleSignOut,
  };
}
