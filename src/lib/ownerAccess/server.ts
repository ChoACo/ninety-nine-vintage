import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { hasTrustedRequestOrigin } from "@/src/lib/kakao/oidc";
import { createSupabaseServerClients } from "@/src/lib/supabase/server";

export const OWNER_USER_ID = "30be08c2-6259-42c6-af26-4ded6362de12";

export class OwnerAccessRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "OwnerAccessRequestError";
    this.status = status;
    this.code = code;
  }
}

export interface AuthenticatedOwnerAccess {
  userId: string;
  accessToken: string;
  userClient: SupabaseClient;
  admin: SupabaseClient;
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

function userHasKakaoIdentity(user: User): boolean {
  return user.identities?.some((identity) => identity.provider === "kakao") === true;
}

function createUserScopedClient(accessToken: string): SupabaseClient {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !publishableKey) {
    throw new OwnerAccessRequestError(503, "owner_access_not_configured");
  }
  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function authenticateOwnerAccessRequest(
  request: Request,
): Promise<AuthenticatedOwnerAccess> {
  const isMutation = request.method !== "GET" && request.method !== "HEAD";
  if (
    (isMutation && !hasTrustedRequestOrigin(request)) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new OwnerAccessRequestError(403, "forbidden");
  }

  const accessToken = readBearerToken(request);
  if (!accessToken) throw new OwnerAccessRequestError(401, "unauthorized");

  const { verifier, admin } = createSupabaseServerClients();
  const { data, error } = await verifier.auth.getUser(accessToken);
  if (
    error ||
    !data.user ||
    data.user.id !== OWNER_USER_ID ||
    !userHasKakaoIdentity(data.user)
  ) {
    throw new OwnerAccessRequestError(401, "unauthorized");
  }

  const roleClient = admin as unknown as SupabaseClient;
  const { data: role, error: roleError } = await roleClient
    .from("account_access_roles")
    .select("role_code,grade_level")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (roleError) throw new OwnerAccessRequestError(500, "role_check_failed");
  if (role?.role_code !== "owner" || Number(role?.grade_level) !== 0) {
    throw new OwnerAccessRequestError(403, "forbidden");
  }

  return {
    userId: data.user.id,
    accessToken,
    userClient: createUserScopedClient(accessToken),
    admin: roleClient,
  };
}

export async function ownerRpc<T>(
  context: AuthenticatedOwnerAccess,
  functionName: string,
  parameters: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await context.userClient.rpc(functionName, parameters);
  if (error) {
    const status =
      error.code === "42501"
        ? 403
        : error.code === "P0002"
          ? 404
          : error.code === "55000"
            ? 409
            : 400;
    throw new OwnerAccessRequestError(
      status,
      error.code === "55000" ? "owner_rpc_conflict" : "owner_rpc_failed",
    );
  }
  return data as T;
}

export function ownerAccessJsonResponse(
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

export function ownerAccessErrorResponse(error: unknown): Response {
  if (error instanceof OwnerAccessRequestError) {
    return ownerAccessJsonResponse({ error: error.code }, error.status);
  }
  return ownerAccessJsonResponse({ error: "owner_access_failed" }, 500);
}

export async function readSmallJsonBody(
  request: Request,
  maxBytes = 16_384,
): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new OwnerAccessRequestError(413, "request_too_large");
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OwnerAccessRequestError(400, "invalid_json");
  }
  return body as Record<string, unknown>;
}
