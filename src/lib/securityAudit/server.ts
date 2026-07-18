import type { SupabaseClient, User } from "@supabase/supabase-js";

import { hasTrustedRequestOrigin } from "@/src/lib/kakao/oidc";
import { createSupabaseServerClients } from "@/src/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export class SecurityRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, options?: { cause?: unknown }) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SecurityRequestError";
    this.status = status;
    this.code = code;
  }
}

export interface AuthenticatedSecurityRequest {
  user: User;
  accessToken: string;
  authSessionId: string | null;
  admin: SupabaseClient;
}

export function readSecurityBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

export function readVerifiedJwtSessionId(accessToken: string): string | null {
  const payloadPart = accessToken.split(".")[1];
  if (!payloadPart) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(payloadPart)) as Record<string, unknown>;
    const sessionId = payload.session_id;
    return typeof sessionId === "string" && UUID_PATTERN.test(sessionId)
      ? sessionId
      : null;
  } catch {
    return null;
  }
}

function userHasKakaoIdentity(user: User): boolean {
  return user.identities?.some((identity) => identity.provider === "kakao") === true;
}

export async function authenticateSecurityRequest(
  request: Request,
): Promise<AuthenticatedSecurityRequest> {
  if (
    !hasTrustedRequestOrigin(request) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new SecurityRequestError(403, "forbidden");
  }

  const accessToken = readSecurityBearerToken(request);
  if (!accessToken) throw new SecurityRequestError(401, "unauthorized");

  const { verifier, admin } = createSupabaseServerClients();
  const { data, error } = await verifier.auth.getUser(accessToken);
  if (error || !data.user || !userHasKakaoIdentity(data.user)) {
    throw new SecurityRequestError(401, "unauthorized");
  }

  return {
    user: data.user,
    accessToken,
    // The claim is decoded only after getUser has cryptographically verified
    // the bearer token. It is server evidence, unlike the browser tab UUID.
    authSessionId: readVerifiedJwtSessionId(accessToken),
    admin: admin as unknown as SupabaseClient,
  };
}

function normalizeForwardedAddress(rawValue: string): string | null {
  let value = rawValue.trim().replace(/^for=/i, "").replace(/^"|"$/g, "");
  if (!value || value.toLowerCase() === "unknown" || value.includes("%")) return null;

  const bracketed = value.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed) value = bracketed[1];
  const ipv4WithPort = value.match(/^((?:\d{1,3}\.){3}\d{1,3}):\d+$/);
  if (ipv4WithPort) value = ipv4WithPort[1];

  if (IPV4_PATTERN.test(value)) {
    const octets = value.split(".").map(Number);
    return octets.every((octet) => Number.isInteger(octet) && octet <= 255)
      ? value
      : null;
  }

  // Postgres performs the final inet parse. This conservative check only lets
  // an IPv6-shaped value reach the service-only RPC.
  return value.includes(":") && /^[0-9a-f:.]+$/i.test(value) ? value : null;
}

export function getTrustedClientIp(request: Request): string {
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for");
  const candidates = process.env.VERCEL === "1"
    ? [vercelForwarded]
    : [
        vercelForwarded,
        request.headers.get("x-forwarded-for"),
        request.headers.get("x-real-ip"),
      ];
  for (const header of candidates) {
    if (!header) continue;
    for (const item of header.split(",")) {
      const normalized = normalizeForwardedAddress(item);
      if (normalized) return normalized;
    }
  }
  if (process.env.NODE_ENV !== "production") return "127.0.0.1";
  throw new SecurityRequestError(400, "client_ip_unavailable");
}

export async function readSecurityJsonBody(
  request: Request,
  maxBytes = 16_384,
): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new SecurityRequestError(413, "request_too_large");
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SecurityRequestError(400, "invalid_json");
  }
  return body as Record<string, unknown>;
}

export async function serviceSecurityRpc<T>(
  client: SupabaseClient,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(functionName, parameters);
  if (error) {
    const status =
      error.code === "42501"
        ? 403
        : error.code === "P0002"
          ? 404
          : error.code === "42900"
            ? 429
            : 400;
    throw new SecurityRequestError(status, "security_rpc_failed", { cause: error });
  }
  return data as T;
}

export async function isSecurityIpBlocked(
  admin: SupabaseClient,
  ipAddress: string,
): Promise<boolean> {
  return Boolean(
    await serviceSecurityRpc(admin, "is_security_ip_blocked", { p_ip: ipAddress }),
  );
}

export function securityJsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function securityErrorResponse(error: unknown): Response {
  if (error instanceof SecurityRequestError) {
    return securityJsonResponse({ error: error.code }, error.status);
  }
  return securityJsonResponse({ error: "security_request_failed" }, 500);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function optionalBoundedString(
  value: unknown,
  maxLength: number,
): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new SecurityRequestError(400, "invalid_request");
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new SecurityRequestError(400, "invalid_request");
  }
  return normalized;
}

export function requiredBoundedString(
  value: unknown,
  minLength: number,
  maxLength: number,
): string {
  const normalized = optionalBoundedString(value, maxLength);
  if (!normalized || normalized.length < minLength) {
    throw new SecurityRequestError(400, "invalid_request");
  }
  return normalized;
}

export function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new SecurityRequestError(400, "invalid_request");
  }
  return parsed;
}
