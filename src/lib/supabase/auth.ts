import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./client";

export type AppRole = "member" | "operator" | "admin" | "unauthorized";
export type StaffRole = Extract<AppRole, "operator" | "admin">;

export const OPERATOR_IDS = ["operator01", "operator02", "operator03"] as const;
export type OperatorId = (typeof OPERATOR_IDS)[number];

const OPERATOR_EMAIL_DOMAIN = "staff.ninety-nine-vintage.store";

export class AuthenticationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthenticationError";
  }
}

export function parseAppRole(value: unknown): AppRole {
  return value === "admin" || value === "operator" || value === "member"
    ? value
    : "unauthorized";
}

export function getUserRole(user: User | null | undefined): AppRole {
  const rawRole = user?.app_metadata?.role;
  const explicitRole = parseAppRole(rawRole);
  if (explicitRole === "admin" || explicitRole === "operator") {
    return explicitRole;
  }
  const provider = user?.app_metadata?.provider;
  const providers = user?.app_metadata?.providers;
  const hasKakaoProvider =
    provider === "kakao" ||
    (Array.isArray(providers) && providers.includes("kakao"));
  const hasMemberCompatibleRole = rawRole == null || explicitRole === "member";

  return hasKakaoProvider && hasMemberCompatibleRole
    ? "member"
    : "unauthorized";
}

export function isStaffRole(role: AppRole): role is StaffRole {
  return role === "admin" || role === "operator";
}

export function isOperatorId(value: string): value is OperatorId {
  return (OPERATOR_IDS as readonly string[]).includes(value);
}

export function operatorIdToEmail(operatorId: OperatorId): string {
  return `${operatorId}@${OPERATOR_EMAIL_DOMAIN}`;
}

export async function signInWithKakao(): Promise<void> {
  if (typeof window === "undefined") {
    throw new AuthenticationError("카카오 로그인은 브라우저에서 시작해 주세요.");
  }

  const redirectTo = new URL("/auth/callback", window.location.origin).toString();
  const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
    provider: "kakao",
    options: {
      redirectTo,
    },
  });

  if (error) {
    throw new AuthenticationError(
      "카카오 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.",
      { cause: error },
    );
  }
}

/**
 * Staff credentials use one field intentionally: an administrator enters their
 * email, while an operator enters one of the three non-email operator IDs.
 */
export async function signInStaff(
  identifier: string,
  password: string,
): Promise<User> {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const isEmailLogin = normalizedIdentifier.includes("@");

  if (!normalizedIdentifier || !password) {
    throw new AuthenticationError("아이디와 비밀번호를 모두 입력해 주세요.");
  }

  let email: string;
  if (isEmailLogin) {
    email = normalizedIdentifier;
  } else {
    if (!isOperatorId(normalizedIdentifier)) {
      throw new AuthenticationError(
        "운영자 아이디는 operator01, operator02, operator03 중 하나를 입력해 주세요.",
      );
    }
    email = operatorIdToEmail(normalizedIdentifier);
  }
  const client = getSupabaseBrowserClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    throw new AuthenticationError(
      isEmailLogin
        ? "관리자 이메일 또는 비밀번호를 확인해 주세요."
        : "운영자 아이디 또는 비밀번호를 확인해 주세요.",
      error ? { cause: error } : undefined,
    );
  }

  const role = getUserRole(data.user);
  const expectedRole: StaffRole = isEmailLogin ? "admin" : "operator";
  const operatorId = data.user.app_metadata?.operator_id;
  const hasExpectedOperatorId =
    expectedRole !== "operator" || operatorId === normalizedIdentifier;

  if (role !== expectedRole || !hasExpectedOperatorId) {
    await client.auth.signOut();
    throw new AuthenticationError(
      isEmailLogin
        ? "관리자 권한이 없는 계정입니다."
        : "등록된 운영자 계정이 아닙니다.",
    );
  }

  const { data: hasStaffAccess, error: staffAccessError } = await client.rpc(
    "is_staff",
  );
  if (staffAccessError || !hasStaffAccess) {
    await client.auth.signOut();
    throw new AuthenticationError("등록된 스태프 권한을 확인하지 못했습니다.", {
      cause: staffAccessError ?? undefined,
    });
  }

  return data.user;
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
