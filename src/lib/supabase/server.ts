import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

class SupabaseServerConfigurationError extends Error {
  constructor() {
    super("Supabase server configuration is incomplete.");
    this.name = "SupabaseServerConfigurationError";
  }
}

function getPublicConfiguration() {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !publishableKey) {
    throw new SupabaseServerConfigurationError();
  }

  return { url, publishableKey };
}

function getPrivilegedConfiguration() {
  const { url, publishableKey } = getPublicConfiguration();
  const secretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!secretKey) {
    throw new SupabaseServerConfigurationError();
  }

  return { url, publishableKey, secretKey };
}

const serverAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

export function createSupabaseServerClients(): {
  verifier: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
} {
  const { url, publishableKey, secretKey } = getPrivilegedConfiguration();
  return {
    verifier: createClient<Database>(url, publishableKey, {
      auth: serverAuthOptions,
    }),
    admin: createClient<Database>(url, secretKey, {
      auth: serverAuthOptions,
    }),
  };
}

export function createSupabasePublicClient(): SupabaseClient<Database> {
  const { url, publishableKey } = getPublicConfiguration();
  return createClient<Database>(url, publishableKey, {
    auth: serverAuthOptions,
  });
}

export function createSupabaseUserClient(
  accessToken: string,
): SupabaseClient<Database> {
  const { url, publishableKey } = getPublicConfiguration();
  return createClient<Database>(url, publishableKey, {
    auth: serverAuthOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function requireSupabaseUser(accessToken: string) {
  const { data, error } = await createSupabasePublicClient().auth.getUser(accessToken);
  if (error || !data.user) throw new Error("unauthorized");
  return data.user;
}
