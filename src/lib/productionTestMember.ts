export const PRODUCTION_TEST_MEMBER_IDENTIFIER = "ninety99";
export const PRODUCTION_TEST_MEMBER_EMAIL =
  "canary-1786435133714@ninety-nine-vintage.store";

export function safeTestMemberReturnTo(value: unknown) {
  const candidate = typeof value === "string" ? value : "/account";
  return candidate.startsWith("/") &&
      !candidate.startsWith("//") &&
      !candidate.startsWith("/api") &&
      !candidate.startsWith("/admin")
    ? candidate
    : "/account";
}
