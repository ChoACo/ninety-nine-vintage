import type { User } from "@supabase/supabase-js";

export const PRODUCTION_TEST_MEMBER_IDENTIFIER = "ninety99";
export const PRODUCTION_TEST_MEMBER_EMAIL =
  "canary-1786435133714@ninety-nine-vintage.store";

export function isProductionTestMember(
  user: Pick<User, "app_metadata" | "email"> | null | undefined,
) {
  return Boolean(
    user &&
      user.email === PRODUCTION_TEST_MEMBER_EMAIL &&
      user.app_metadata?.canary === true &&
      user.app_metadata?.hidden_test === true &&
      user.app_metadata?.role === "member",
  );
}

export function safeTestMemberReturnTo(value: unknown) {
  const candidate = typeof value === "string" ? value : "/account";
  return candidate.startsWith("/") &&
      !candidate.startsWith("//") &&
      !candidate.startsWith("/api") &&
      !candidate.startsWith("/admin")
    ? candidate
    : "/account";
}
