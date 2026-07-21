import "server-only";

import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import {
  createSupabasePublicClient,
  createSupabaseServerClients,
  createSupabaseUserClient,
} from "@/lib/supabase/server";
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

export async function authenticateMemberCommerceRequest(request: Request, mutation = false) {
  const auth = await authenticateCommerceRequest(request, mutation);
  if (!auth.ok) return auth;
  const { data: account, error } = await auth.admin
    .from("member_accounts")
    .select("member_id, account_status")
    .eq("member_id", auth.userId)
    .eq("account_status", "active")
    .maybeSingle();
  if (error) return { ok: false as const, response: commerceJson({ error: "member_unavailable" }, 503) };
  if (!account) return { ok: false as const, response: commerceJson({ error: "member_required", message: "카카오 회원 계정으로 이용해 주세요." }, 403) };
  return auth;
}

export async function authenticateMemberRlsRequest(request: Request, mutation = false) {
  if (mutation && !hasTrustedRequestOrigin(request)) {
    return { ok: false as const, response: commerceJson({ error: "forbidden" }, 403) };
  }
  const token = readCommerceBearerToken(request);
  if (!token) return { ok: false as const, response: commerceJson({ error: "unauthorized" }, 401) };

  try {
    const { data, error } = await createSupabasePublicClient().auth.getUser(token);
    if (error || !data.user) {
      return { ok: false as const, response: commerceJson({ error: "unauthorized" }, 401) };
    }
    const user = createSupabaseUserClient(token);
    const { data: account, error: accountError } = await user
      .from("member_accounts")
      .select("member_id, account_status")
      .eq("member_id", data.user.id)
      .eq("account_status", "active")
      .maybeSingle();
    if (accountError) {
      return { ok: false as const, response: commerceJson({ error: "member_unavailable" }, 503) };
    }
    if (!account) {
      return { ok: false as const, response: commerceJson({ error: "member_required", message: "카카오 회원 계정으로 이용해 주세요." }, 403) };
    }
    return { ok: true as const, userId: data.user.id, token, user };
  } catch {
    return { ok: false as const, response: commerceJson({ error: "service_unavailable" }, 503) };
  }
}

export function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

export async function authenticateStaffRequest(request: Request, mutation = false) {
  const auth = await authenticateCommerceRequest(request, mutation);
  if (!auth.ok) return auth;
  const { data: role, error } = await auth.admin
    .from("account_access_roles")
    .select("role_code, grade_level, reports_to_operator_id")
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error) return { ok: false as const, response: commerceJson({ error: "role_unavailable" }, 503) };
  const roleCode = role?.role_code;
  if (roleCode !== "owner" && roleCode !== "operator" && roleCode !== "employee") {
    return { ok: false as const, response: commerceJson({ error: "forbidden" }, 403) };
  }
  return {
    ...auth,
    roleCode,
    gradeLevel: Number(role?.grade_level ?? 99),
    effectiveOperatorId: roleCode === "employee"
      ? role?.reports_to_operator_id ?? null
      : auth.userId,
  };
}
