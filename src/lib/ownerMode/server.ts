import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  createRandomToken,
  hasTrustedRequestOrigin,
  hashTokenSha256,
  readCookie,
  timingSafeStringEqual,
} from "@/src/lib/kakao/oidc";
import { createSupabaseServerClients } from "@/src/lib/supabase/server";

export const OWNER_MODE_COOKIE = "dami_owner_mode";

const OWNER_MODE_TTL_SECONDS = 15 * 60;

interface OwnerRoleRow {
  role_code: string;
}

interface OwnerModeSessionRow {
  expires_at: string;
}

interface PinAttemptRow {
  allowed: boolean;
  locked_until: string | null;
}

export class OwnerModeRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "OwnerModeRequestError";
    this.status = status;
    this.code = code;
  }
}

export interface AuthenticatedOwnerRequest {
  userId: string;
  accessToken: string;
  admin: SupabaseClient;
}

export interface CreatedOwnerModeSession {
  token: string;
  expiresAt: string;
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

function userHasKakaoIdentity(user: User): boolean {
  return user.identities?.some((identity) => identity.provider === "kakao") === true;
}

function asOwnerDataClient(client: SupabaseClient): SupabaseClient {
  // The generated type snapshot can trail a newly added migration. RLS and
  // revoked browser grants remain the actual security boundary.
  return client as unknown as SupabaseClient;
}

export async function authenticateOwnerRequest(
  request: Request,
): Promise<AuthenticatedOwnerRequest> {
  if (!hasTrustedRequestOrigin(request)) {
    throw new OwnerModeRequestError(403, "forbidden");
  }

  const accessToken = readBearerToken(request);
  if (!accessToken) throw new OwnerModeRequestError(401, "unauthorized");

  const { verifier, admin } = createSupabaseServerClients();
  const { data, error } = await verifier.auth.getUser(accessToken);
  if (error || !data.user || !userHasKakaoIdentity(data.user)) {
    throw new OwnerModeRequestError(401, "unauthorized");
  }

  const roleClient = asOwnerDataClient(admin);
  const { data: role, error: roleError } = await roleClient
    .from("account_access_roles")
    .select("role_code")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (roleError) throw new OwnerModeRequestError(500, "role_check_failed");
  if ((role as OwnerRoleRow | null)?.role_code !== "owner") {
    throw new OwnerModeRequestError(403, "forbidden");
  }

  return { userId: data.user.id, accessToken, admin: roleClient };
}

export async function verifyOwnerModePin(pin: string): Promise<boolean> {
  const expectedPin = process.env.OWNER_MODE_PIN?.trim();
  if (!expectedPin) {
    throw new OwnerModeRequestError(503, "owner_mode_not_configured");
  }

  const [attemptHash, expectedHash] = await Promise.all([
    hashTokenSha256(pin),
    hashTokenSha256(expectedPin),
  ]);
  return timingSafeStringEqual(attemptHash, expectedHash);
}

export async function processOwnerPinAttempt(
  context: AuthenticatedOwnerRequest,
  matches: boolean,
): Promise<PinAttemptRow> {
  const { data, error } = await context.admin.rpc(
    "process_owner_mode_pin_attempt",
    { p_owner_id: context.userId, p_matches: matches },
  );
  if (error) throw new OwnerModeRequestError(500, "unlock_record_failed");
  const row = (data as PinAttemptRow[] | null)?.[0];
  if (!row) throw new OwnerModeRequestError(500, "unlock_record_failed");
  return row;
}

export async function createOwnerModeSession(
  context: AuthenticatedOwnerRequest,
): Promise<CreatedOwnerModeSession> {
  const token = createRandomToken(32);
  const [tokenHash, accessTokenHash] = await Promise.all([
    hashTokenSha256(token),
    hashTokenSha256(context.accessToken),
  ]);
  const expiresAt = new Date(
    Date.now() + OWNER_MODE_TTL_SECONDS * 1_000,
  ).toISOString();

  const { error: deleteError } = await context.admin
    .from("owner_mode_sessions")
    .delete()
    .eq("owner_id", context.userId);
  if (deleteError) throw new OwnerModeRequestError(500, "session_create_failed");

  const { error: insertError } = await context.admin
    .from("owner_mode_sessions")
    .insert({
      owner_id: context.userId,
      token_hash: tokenHash,
      access_token_hash: accessTokenHash,
      expires_at: expiresAt,
    });
  if (insertError) throw new OwnerModeRequestError(500, "session_create_failed");

  return { token, expiresAt };
}

export async function validateOwnerModeSession(
  request: Request,
  context: AuthenticatedOwnerRequest,
): Promise<{ unlocked: boolean; expiresAt: string | null }> {
  const token = readCookie(request, OWNER_MODE_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) {
    return { unlocked: false, expiresAt: null };
  }

  const [tokenHash, accessTokenHash] = await Promise.all([
    hashTokenSha256(token),
    hashTokenSha256(context.accessToken),
  ]);
  const now = new Date().toISOString();
  const { data, error } = await context.admin
    .from("owner_mode_sessions")
    .select("expires_at")
    .eq("owner_id", context.userId)
    .eq("token_hash", tokenHash)
    .gt("expires_at", now)
    .maybeSingle();
  if (error) throw new OwnerModeRequestError(500, "session_check_failed");

  const session = data as OwnerModeSessionRow | null;
  if (!session) return { unlocked: false, expiresAt: null };

  const { error: touchError } = await context.admin
    .from("owner_mode_sessions")
    // Supabase may rotate a valid access token during a full-page navigation.
    // The request has already re-verified the Kakao owner identity, so rebind
    // the opaque cookie session to the current token instead of rejecting a
    // legitimate refresh. A cookie and a valid owner bearer are still both
    // required for every request.
    .update({ last_verified_at: now, access_token_hash: accessTokenHash })
    .eq("owner_id", context.userId)
    .eq("token_hash", tokenHash);
  if (touchError) throw new OwnerModeRequestError(500, "session_check_failed");

  return { unlocked: true, expiresAt: session.expires_at };
}

export async function revokeOwnerModeSession(
  request: Request,
  context: AuthenticatedOwnerRequest,
): Promise<void> {
  const token = readCookie(request, OWNER_MODE_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) return;
  const tokenHash = await hashTokenSha256(token);
  const { error } = await context.admin
    .from("owner_mode_sessions")
    .delete()
    .eq("owner_id", context.userId)
    .eq("token_hash", tokenHash);
  if (error) throw new OwnerModeRequestError(500, "session_revoke_failed");
}

export function serializeOwnerModeCookie(token: string): string {
  return [
    `${OWNER_MODE_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${OWNER_MODE_TTL_SECONDS}`,
  ].join("; ");
}

export function clearOwnerModeCookie(): string {
  return [
    `${OWNER_MODE_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0",
  ].join("; ");
}

export function ownerModeJsonResponse(
  body: Record<string, unknown>,
  status: number,
  cookie?: string,
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (cookie) headers.append("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

export function ownerModeErrorResponse(error: unknown): Response {
  if (error instanceof OwnerModeRequestError) {
    return ownerModeJsonResponse({ error: error.code }, error.status);
  }
  return ownerModeJsonResponse({ error: "owner_mode_failed" }, 500);
}
