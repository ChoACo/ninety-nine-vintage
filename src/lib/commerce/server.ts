import "server-only";

import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import { createSupabaseServerClients, createSupabaseUserClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export function commerceJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function readCommerceBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim();
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

export async function authenticateCommerceRequest(
  request: Request,
  mutation = false,
): Promise<
  | { ok: true; userId: string; token: string; admin: SupabaseClient<Database>; user: SupabaseClient<Database> }
  | { ok: false; response: Response }
> {
  if (mutation && !hasTrustedRequestOrigin(request)) {
    return { ok: false, response: commerceJson({ error: "forbidden" }, 403) };
  }
  const token = readCommerceBearerToken(request);
  if (!token) return { ok: false, response: commerceJson({ error: "unauthorized" }, 401) };

  try {
    const { verifier, admin } = createSupabaseServerClients();
    const { data, error } = await verifier.auth.getUser(token);
    if (error || !data.user) return { ok: false, response: commerceJson({ error: "unauthorized" }, 401) };
    return { ok: true, userId: data.user.id, token, admin, user: createSupabaseUserClient(token) };
  } catch {
    return { ok: false, response: commerceJson({ error: "service_unavailable" }, 503) };
  }
}

export function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}
