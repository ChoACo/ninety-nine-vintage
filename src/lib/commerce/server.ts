import "server-only";

import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import {
  createSupabasePublicClient,
  createSupabaseServerClients,
  createSupabaseUserClient,
} from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { IMMUTABLE_OWNER_ID } from "@/lib/ownerIdentity";
import { getOwnerRoleCanaryState } from "@/lib/ownerRoleCanary.server";

export function commerceJson(body: unknown, status = 200) {
  const normalizedBody = body && typeof body === "object" && !Array.isArray(body)
    ? (() => {
      const problem = body as Record<string, unknown>;
      return typeof problem.error === "string" && typeof problem.code !== "string"
        ? { ...problem, code: problem.error }
        : problem;
    })()
    : body;
  return Response.json(normalizedBody, {
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
    return { ok: false, response: commerceJson({ error: "forbidden", message: "요청 권한이 없습니다." }, 403) };
  }
  const token = readCommerceBearerToken(request);
  if (!token) return { ok: false, response: commerceJson({ error: "unauthorized", message: "로그인이 필요합니다." }, 401) };

  try {
    const { verifier, admin } = createSupabaseServerClients();
    const { data, error } = await verifier.auth.getUser(token);
    if (error || !data.user) return { ok: false, response: commerceJson({ error: "unauthorized", message: "로그인이 필요합니다." }, 401) };
    return { ok: true, userId: data.user.id, token, admin, user: createSupabaseUserClient(token) };
  } catch {
    return { ok: false, response: commerceJson({ error: "service_unavailable", message: "인증 서비스를 확인하지 못했습니다." }, 503) };
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
  if (error) return { ok: false as const, response: commerceJson({ error: "member_unavailable", message: "회원 정보를 확인하지 못했습니다." }, 503) };
  if (!account) {
    const { data: role, error: roleError } = await auth.admin
      .from("account_access_roles")
      .select("role_code")
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (roleError || !role || !["owner", "operator", "employee"].includes(role.role_code)) {
      return { ok: false as const, response: commerceJson({ error: "member_required", message: "카카오 회원 계정으로 이용해 주세요." }, 403) };
    }
  }
  return auth;
}

export async function authenticateMemberRlsRequest(request: Request, mutation = false) {
  if (mutation && !hasTrustedRequestOrigin(request)) {
    return { ok: false as const, response: commerceJson({ error: "forbidden", message: "요청 권한이 없습니다." }, 403) };
  }
  const token = readCommerceBearerToken(request);
  if (!token) return { ok: false as const, response: commerceJson({ error: "unauthorized", message: "로그인이 필요합니다." }, 401) };

  try {
    const { data, error } = await createSupabasePublicClient().auth.getUser(token);
    if (error || !data.user) {
      return { ok: false as const, response: commerceJson({ error: "unauthorized", message: "로그인이 필요합니다." }, 401) };
    }
    const user = createSupabaseUserClient(token);
    const { data: account, error: accountError } = await user
      .from("member_accounts")
      .select("member_id, account_status")
      .eq("member_id", data.user.id)
      .eq("account_status", "active")
      .maybeSingle();
    if (accountError) {
      return { ok: false as const, response: commerceJson({ error: "member_unavailable", message: "회원 정보를 확인하지 못했습니다." }, 503) };
    }
    if (!account) {
      const { admin } = createSupabaseServerClients();
       const { data: role, error: roleError } = await admin
        .from("account_access_roles")
        .select("role_code")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (roleError || !role || !["owner", "operator", "employee"].includes(role.role_code)) {
        return { ok: false as const, response: commerceJson({ error: "member_required", message: "카카오 회원 계정으로 이용해 주세요." }, 403) };
      }
    }
    return { ok: true as const, userId: data.user.id, token, user };
  } catch {
    return { ok: false as const, response: commerceJson({ error: "service_unavailable", message: "인증 서비스를 확인하지 못했습니다." }, 503) };
  }
}

export function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

export async function authenticateStaffRequest(request: Request, mutation = false) {
  const auth = await authenticateCommerceRequest(request, mutation);
  if (!auth.ok) return auth;
  let roleCanary = null;
  if (auth.userId === IMMUTABLE_OWNER_ID) {
    try {
      const canary = await getOwnerRoleCanaryState(auth.admin, auth.userId);
      roleCanary = canary.active ? canary : null;
    } catch {
      return {
        ok: false as const,
        response: commerceJson(
          {
            error: "role_unavailable",
            message: "운영 권한을 확인하지 못했습니다.",
          },
          503,
        ),
      };
    }
  }
  const roleResult = roleCanary
    ? null
    : await auth.admin
      .from("account_access_roles")
      .select("role_code, grade_level, reports_to_operator_id")
      .eq("user_id", auth.userId)
      .maybeSingle();
  if (roleResult?.error) return { ok: false as const, response: commerceJson({ error: "role_unavailable", message: "운영 권한을 확인하지 못했습니다." }, 503) };
  const role = roleResult?.data;
  const roleCode = roleCanary?.roleCode ?? role?.role_code;
  if (roleCode !== "owner" && roleCode !== "operator" && roleCode !== "employee") {
    return { ok: false as const, response: commerceJson({ error: "forbidden", message: "운영 권한이 없습니다." }, 403) };
  }
  return {
    ...auth,
    roleCode,
    gradeLevel: roleCanary?.gradeLevel ?? Number(role?.grade_level ?? 99),
    effectiveUserId: roleCanary?.targetUserId ?? auth.userId,
    effectiveOperatorId: roleCode === "employee"
      ? roleCanary?.reportsToOperatorId ?? role?.reports_to_operator_id ?? null
      : roleCanary?.targetUserId ?? auth.userId,
  };
}

/**
 * Payment confirmation is an Owner-wide financial operation. It must not
 * inherit the operator workspace's selected-store requirement: a shared
 * payment can contain products from more than one store, while the database
 * RPC already enforces the Owner-only confirmation policy.
 */
export async function authenticateOwnerPaymentRequest(
  request: Request,
  mutation = false,
) {
  const auth = await authenticateStaffRequest(request, mutation);
  if (!auth.ok) return auth;
  if (auth.roleCode !== "owner") {
    return {
      ok: false as const,
      response: commerceJson({
        error: "payment_forbidden",
        message: "입금 확인 권한이 없습니다.",
      }, 403),
    };
  }
  return auth;
}

export interface OperatorStaffAuth {
  ok: true;
  roleCode: "owner" | "operator" | "employee";
  gradeLevel: number;
  effectiveOperatorId: string | null;
  effectiveUserId: string;
  userId: string;
  token: string;
  admin: SupabaseClient<Database>;
  user: SupabaseClient<Database>;
}

export async function authenticateOperatorStoreRequest(
  request: Request,
  mutation?: boolean,
): Promise<
  | (OperatorStaffAuth & { selectedStoreId: string })
  | { ok: false; response: Response }
>;
export async function authenticateOperatorStoreRequest(
  request: Request,
  mutation: boolean,
  allowEmployee: true,
): Promise<OperatorStaffAuth | { ok: false; response: Response }>;
export async function authenticateOperatorStoreRequest(
  request: Request,
  mutation = false,
  allowEmployee = false,
) {
  const auth = await authenticateStaffRequest(request, mutation);
  if (!auth.ok) return auth;
  if (allowEmployee && auth.roleCode === "employee") return auth;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return {
      ok: false as const,
      response: commerceJson({
        error: "operator_store_forbidden",
        message: "운영자 센터 접근 권한이 없습니다.",
      }, 403),
    };
  }
  const { data, error } = await auth.user.rpc("require_active_operator_store_scope");
  if (error || typeof data !== "string") {
    return {
      ok: false as const,
      response: commerceJson({
        error: "operator_store_scope_required",
        message: "센터를 다시 선택해 주세요.",
      }, error?.code === "42501" ? 428 : 503),
    };
  }
  return { ...auth, selectedStoreId: data };
}

export async function verifyOperatorProductScope(
  user: SupabaseClient<Database>,
  selectedStoreId: string,
  productId: string,
): Promise<Response | null> {
  const { data, error } = await user
    .from("products")
    .select("id, store_id")
    .eq("id", productId)
    .maybeSingle();
  if (error) {
    return commerceJson({ error: "product_scope_unavailable" }, 503);
  }
  if (!data) return commerceJson({ error: "product_not_found" }, 404);
  if (data.store_id !== selectedStoreId) {
    return commerceJson({ error: "operator_store_scope_mismatch" }, 403);
  }
  return null;
}
