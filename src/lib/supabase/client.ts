import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { createRealtimeChannelName } from "./realtime";

let browserClient: SupabaseClient<Database> | undefined;
let publicBrowserClient: SupabaseClient<Database> | undefined;
const LOCAL_TEST_AUTH_STORAGE_KEY = "ninety-nine-local-test-browser-auth";

export class SupabaseConfigurationError extends Error {
  constructor() {
    super(
      "Supabase 연결 정보가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 설정해 주세요.",
    );
    this.name = "SupabaseConfigurationError";
  }
}

function getSupabaseConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !publishableKey) throw new SupabaseConfigurationError();

  return { url, publishableKey };
}

function getBrowserAuthStorageKey(url: string) {
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(url)) {
    return LOCAL_TEST_AUTH_STORAGE_KEY;
  }

  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

/** Last-resort cleanup when auth-js cannot complete local sign-out. */
export function clearSupabaseBrowserSessionStorage() {
  if (typeof window === "undefined") return;

  const { url } = getSupabaseConfiguration();
  const storageKey = getBrowserAuthStorageKey(url);
  for (const suffix of ["", "-code-verifier", "-user"] as const) {
    window.localStorage.removeItem(`${storageKey}${suffix}`);
  }
}

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;

  const { url, publishableKey } = getSupabaseConfiguration();
  const storageKey = getBrowserAuthStorageKey(url);
  browserClient = createClient<Database>(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Authentication is completed only through the verified Kakao ID-token
      // callback. Never let URL fragments inject an unrelated Supabase session.
      detectSessionInUrl: false,
      storageKey,
    },
  });

  return browserClient;
}

/**
 * Public reads must not inherit a stale member Authorization header. This
 * client has no persisted session and is safe for RPCs explicitly granted to
 * anon, such as the authoritative auction clock.
 */
export function getSupabasePublicBrowserClient(): SupabaseClient<Database> {
  if (publicBrowserClient) return publicBrowserClient;

  const { url, publishableKey } = getSupabaseConfiguration();
  publicBrowserClient = createClient<Database>(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "ninety-nine-public-browser-auth",
    },
  });

  return publicBrowserClient;
}

/**
 * Presence uses an isolated public client so a rapid React remount cannot
 * reuse a channel that the shared application client is still closing.
 */
export function createSupabasePresenceClient(): SupabaseClient<Database> {
  const { url, publishableKey } = getSupabaseConfiguration();

  return createClient<Database>(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // This client never authenticates. A unique, non-persistent storage key
      // prevents it from sharing GoTrue coordination state with the real app
      // session or with a Presence client that is still disconnecting.
      storageKey: createRealtimeChannelName(
        "ninety-nine-public-presence-auth",
      ),
    },
  });
}
