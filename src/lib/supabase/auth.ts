import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./client";

export type AppRole =
  | "member"
  | "band_member"
  | "employee"
  | "operator"
  | "admin"
  | "unauthorized";

/** Database-only role names returned by `current_access_role()`. */
export type AccessRole =
  | "owner"
  | "operator"
  | "employee"
  | "band_member"
  | "member";

/**
 * `admin` is the legacy, server-owned value for the service owner. Keep it as
 * an internal authorization key, but never expose the value or a grade-0 label
 * in member-facing UI.
 */
export type OwnerRole = Extract<AppRole, "admin">;
export type StaffRole = Extract<AppRole, "employee" | "operator" | "admin">;
export type OperationsCenterRole = Extract<AppRole, "operator" | "admin">;
export type ProductOperationsRole = Extract<
  AppRole,
  "employee" | "operator" | "admin"
>;
export type MemberRole = Extract<AppRole, "member" | "band_member">;
export type PresenceRole = Extract<AppRole, "member" | "band_member" | "operator">;

export type PublicRoleGrade = 1 | 2 | 2.5 | 3;

export interface PublicRoleDescriptor {
  label: string;
  grade: PublicRoleGrade | null;
}

const PUBLIC_ROLE: Record<AppRole, PublicRoleDescriptor> = {
  // The owner is intentionally indistinguishable from an operator in public UI.
  admin: { label: "운영자", grade: null },
  operator: { label: "운영자", grade: 1 },
  employee: { label: "직원", grade: 2 },
  band_member: { label: "회원", grade: 2.5 },
  member: { label: "회원", grade: 3 },
  unauthorized: { label: "방문자", grade: null },
};

export class AuthenticationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthenticationError";
  }
}

export function parseAppRole(value: unknown): AppRole {
  if (value === "owner") return "admin";
  return value === "admin" ||
    value === "operator" ||
    value === "employee" ||
    value === "band_member" ||
    value === "member"
    ? value
    : "unauthorized";
}

/**
 * Convert the server's private `owner` role to the existing internal app key.
 * The private database value must never be rendered directly in public UI.
 */
export function mapAccessRoleToAppRole(value: unknown): AppRole {
  return parseAppRole(value);
}

export function getUserRole(user: User | null | undefined): AppRole {
  const rawRole = user?.app_metadata?.role;
  const explicitRole = parseAppRole(rawRole);
  const provider = user?.app_metadata?.provider;
  const providers = user?.app_metadata?.providers;
  const hasKakaoProvider =
    provider === "kakao" ||
    (Array.isArray(providers) && providers.includes("kakao"));

  // Every account, including the private service owner, authenticates through
  // Kakao. A legacy email/password JWT must never become authorized merely
  // because it still carries an old role claim.
  if (!hasKakaoProvider) return "unauthorized";

  if (
    explicitRole === "admin" ||
    explicitRole === "operator" ||
    explicitRole === "employee"
  ) {
    return explicitRole;
  }
  const hasMemberCompatibleRole =
    rawRole == null ||
    explicitRole === "member" ||
    explicitRole === "band_member";

  if (!hasMemberCompatibleRole) return "unauthorized";
  return explicitRole === "band_member" ? "band_member" : "member";
}

export function isStaffRole(role: AppRole): role is StaffRole {
  return role === "admin" || role === "operator" || role === "employee";
}

export function isOwnerRole(role: AppRole): role is OwnerRole {
  return role === "admin";
}

export function isMemberRole(role: AppRole): role is MemberRole {
  return role === "member" || role === "band_member";
}

export function canAccessOperationsCenter(
  role: AppRole,
): role is OperationsCenterRole {
  return role === "admin" || role === "operator";
}

export function canManageProducts(
  role: AppRole,
): role is ProductOperationsRole {
  return isStaffRole(role);
}

export function canManageShippingQueue(
  role: AppRole,
): role is ProductOperationsRole {
  return isStaffRole(role);
}

export function canAccessOperationsWorkspace(role: AppRole): boolean {
  return canAccessOperationsCenter(role) || role === "employee";
}

export function shouldTrackPresence(role: AppRole): boolean {
  return role === "member" || role === "band_member" || role === "operator";
}

export function getPublicRoleDescriptor(
  role: AppRole,
): PublicRoleDescriptor {
  return PUBLIC_ROLE[role];
}

export function getPublicRoleLabel(role: AppRole): string {
  return getPublicRoleDescriptor(role).label;
}

export async function signInWithKakao(): Promise<void> {
  if (typeof window === "undefined") {
    throw new AuthenticationError("카카오 로그인은 브라우저에서 시작해 주세요.");
  }

  // Supabase's standard Kakao OAuth provider may request email and profile-image
  // scopes. This server-owned OIDC flow omits scope entirely, so Kakao applies
  // only the consent items that are actually configured in the app console.
  window.location.assign("/api/auth/kakao/start");
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseBrowserClient().auth.signOut();

  if (error) {
    throw new AuthenticationError(
      "로그아웃을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
      { cause: error },
    );
  }
}
