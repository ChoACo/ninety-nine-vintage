import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  TEMPORARY_MEMBER_OWNER_ID,
  type OwnerMemberModeState,
} from "@/lib/ownerMemberMode";

export async function getOwnerMemberModeState(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<OwnerMemberModeState> {
  if (userId !== TEMPORARY_MEMBER_OWNER_ID) {
    return { active: false, eligible: false, expiresAt: null };
  }

  const [{ data: role, error: roleError }, { data: lease, error: leaseError }] =
    await Promise.all([
      admin
        .from("account_access_roles")
        .select("role_code")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("owner_member_mode_sessions")
        .select("ended_at, expires_at")
        .eq("owner_id", userId)
        .maybeSingle(),
    ]);

  if (roleError || leaseError) {
    throw new Error("owner_member_mode_unavailable");
  }

  const eligible = role?.role_code === "owner";
  const expiresAt = lease?.expires_at ?? null;
  return {
    active:
      eligible &&
      lease?.ended_at === null &&
      typeof expiresAt === "string" &&
      new Date(expiresAt).getTime() > Date.now(),
    eligible,
    expiresAt,
  };
}
