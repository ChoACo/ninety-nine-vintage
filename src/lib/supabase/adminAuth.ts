import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./client";

export class AdminAuthenticationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AdminAuthenticationError";
  }
}

export function isSupabaseAdmin(user: User | null | undefined): boolean {
  return user?.app_metadata?.role === "admin";
}

export async function signInSupabaseAdmin(
  email: string,
  password: string,
): Promise<User> {
  const client = getSupabaseBrowserClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error || !data.user) {
    throw new AdminAuthenticationError(
      "관리자 이메일 또는 비밀번호를 확인해 주세요.",
      error ? { cause: error } : undefined,
    );
  }

  if (!isSupabaseAdmin(data.user)) {
    await client.auth.signOut();
    throw new AdminAuthenticationError(
      "관리자 권한이 없는 계정입니다. Supabase app_metadata를 확인해 주세요.",
    );
  }

  return data.user;
}
