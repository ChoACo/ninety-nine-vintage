const ENTRY_GATE_COOKIE = "ninetynine-entry-pass";
const ENTRY_GATE_MAX_AGE = 60 * 60 * 24 * 7;

interface EntryPassPayload {
  version: string;
  expiresAt: number;
}

function getSecret() {
  return process.env.ENTRY_GATE_SECRET?.trim()
    || process.env.SUPABASE_SECRET_KEY?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || "";
}

function toBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return atob(padded);
}

async function sign(value: string) {
  const secret = getSecret();
  if (!secret) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

export function getEntryGateCookieName() { return ENTRY_GATE_COOKIE; }
export function getEntryGateMaxAge() { return ENTRY_GATE_MAX_AGE; }
export function getEntryGateVersion() { return process.env.NEXT_PUBLIC_DEPLOY_VERSION?.trim() || "v1"; }

export async function createEntryPass() {
  const payload: EntryPassPayload = { version: getEntryGateVersion(), expiresAt: Date.now() + ENTRY_GATE_MAX_AGE * 1000 };
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(encodedPayload);
  return signature ? `${encodedPayload}.${signature}` : null;
}

export async function verifyEntryPass(value: string | undefined) {
  if (!value) return false;
  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) return false;
  const expected = await sign(encodedPayload);
  if (!expected || expected !== signature) return false;
  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as EntryPassPayload;
    return payload.version === getEntryGateVersion() && Number.isFinite(payload.expiresAt) && payload.expiresAt > Date.now();
  } catch { return false; }
}

