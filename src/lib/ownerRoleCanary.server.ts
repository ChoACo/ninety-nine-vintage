import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { TEMPORARY_MEMBER_OWNER_ID } from "@/lib/ownerMemberMode";

export type OwnerRoleCanaryRole = "operator" | "employee";

export interface OwnerRoleCanaryState {
  active: boolean;
  eligible: boolean;
  targetUserId: string | null;
  roleCode: OwnerRoleCanaryRole | null;
  gradeLevel: number | null;
  reportsToOperatorId: string | null;
  expiresAt: string | null;
  serverNow: string;
}

export async function getOwnerRoleCanaryState(
  admin: SupabaseClient,
  userId: string,
): Promise<OwnerRoleCanaryState> {
  const serverNow = new Date();
  const inactive = {
    active: false,
    eligible: false,
    targetUserId: null,
    roleCode: null,
    gradeLevel: null,
    reportsToOperatorId: null,
    expiresAt: null,
    serverNow: serverNow.toISOString(),
  } satisfies OwnerRoleCanaryState;

  if (userId !== TEMPORARY_MEMBER_OWNER_ID) return inactive;

  const [{ data: ownerRole, error: ownerRoleError }, { data: lease, error: leaseError }] =
    await Promise.all([
      admin
        .from("account_access_roles")
        .select("role_code,grade_level")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("owner_role_canary_sessions")
        .select("target_user_id,target_role,ended_at,expires_at")
        .eq("owner_id", userId)
        .maybeSingle(),
    ]);

  if (ownerRoleError || leaseError) throw new Error("owner_role_canary_unavailable");
  const eligible = ownerRole?.role_code === "owner" && Number(ownerRole.grade_level) === 0;
  const expiresAt = typeof lease?.expires_at === "string" ? lease.expires_at : null;
  const leaseActive =
    eligible &&
    lease?.ended_at === null &&
    expiresAt !== null &&
    new Date(expiresAt).getTime() > serverNow.getTime() &&
    (lease.target_role === "operator" || lease.target_role === "employee");

  if (!leaseActive) return { ...inactive, eligible, expiresAt };

  const { data: targetRole, error: targetRoleError } = await admin
    .from("account_access_roles")
    .select("role_code,grade_level,reports_to_operator_id")
    .eq("user_id", lease.target_user_id)
    .maybeSingle();
  if (targetRoleError) throw new Error("owner_role_canary_unavailable");
  if (!targetRole || targetRole.role_code !== lease.target_role) {
    return { ...inactive, eligible, expiresAt };
  }

  return {
    active: true,
    eligible,
    targetUserId: lease.target_user_id,
    roleCode: lease.target_role,
    gradeLevel: Number(targetRole.grade_level ?? 99),
    reportsToOperatorId: targetRole.reports_to_operator_id ?? null,
    expiresAt,
    serverNow: serverNow.toISOString(),
  };
}
