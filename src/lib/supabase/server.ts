import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

class SupabaseServerConfigurationError extends Error {
  constructor() {
    super("Supabase 서버 환경변수가 설정되지 않았습니다.");
    this.name = "SupabaseServerConfigurationError";
  }
}

function readServerConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ??
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !publishableKey || !serviceRoleKey) {
    throw new SupabaseServerConfigurationError();
  }
  return { url, publishableKey, serviceRoleKey };
}

const authOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

export function createSupabaseServerClients(): {
  verifier: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
} {
  const { url, publishableKey, serviceRoleKey } = readServerConfiguration();
  return {
    verifier: createClient<Database>(url, publishableKey, { auth: authOptions }),
    admin: createClient<Database>(url, serviceRoleKey, { auth: authOptions }),
  };
}

export function createSupabaseUserClient(accessToken: string): SupabaseClient<Database> {
  const { url, publishableKey } = readServerConfiguration();
  return createClient<Database>(url, publishableKey, {
    auth: authOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function requireSupabaseUser(accessToken: string) {
  const { verifier } = createSupabaseServerClients();
  const { data, error } = await verifier.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("unauthorized");
  return data.user;
}
