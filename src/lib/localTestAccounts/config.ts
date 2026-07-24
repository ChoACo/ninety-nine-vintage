import "server-only";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function configuredSupabaseUrl() {
  return (
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    ""
  );
}

export function isLocalTestAccountEnvironment() {
  if (process.env.NODE_ENV !== "development") return false;

  try {
    const url = new URL(configuredSupabaseUrl());
    return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function getLocalTestAccountPassword() {
  const password = process.env.LOCAL_TEST_ACCOUNT_PASSWORD?.trim() || "";
  return password.length >= 16 ? password : null;
}

export function canUseLocalTestAccounts() {
  return isLocalTestAccountEnvironment() && Boolean(getLocalTestAccountPassword());
}
