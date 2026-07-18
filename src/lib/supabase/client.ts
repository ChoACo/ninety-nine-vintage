import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { createRealtimeChannelName } from "./realtime";

let browserClient: SupabaseClient<Database> | undefined;

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

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;

  const { url, publishableKey } = getSupabaseConfiguration();
  browserClient = createClient<Database>(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return browserClient;
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
