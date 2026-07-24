import "server-only";

import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import {
  createSupabasePublicClient,
  createSupabaseServerClients,
  createSupabaseUserClient,
} from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { TEMPORARY_MEMBER_OWNER_ID } from "@/lib/ownerMemberMode";
import { getOwnerMemberModeState } from "@/lib/ownerMemberMode.server";

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
  if (auth.userId === TEMPORARY_MEMBER_OWNER_ID) {
    try {
      const memberMode = await getOwnerMemberModeState(auth.admin, auth.userId);
      if (!memberMode.active) {
        return {
          ok: false as const,
          response: commerceJson(
            {
              error: "member_required",
              message: "소유자 센터에서 임시 회원 권한을 활성화해 주세요.",
            },
            403,
          ),
        };
      }
    } catch {
      return {
        ok: false as const,
        response: commerceJson(
          {
            error: "member_unavailable",
            message: "회원 권한 상태를 확인하지 못했습니다.",
          },
          503,
        ),
      };
    }
  }
  const { data: account, error } = await auth.admin
    .from("member_accounts")
    .select("member_id, account_status")
    .eq("member_id", auth.userId)
    .eq("account_status", "active")
    .maybeSingle();
  if (error) return { ok: false as const, response: commerceJson({ error: "member_unavailable", message: "회원 정보를 확인하지 못했습니다." }, 503) };
  if (!account) return { ok: false as const, response: commerceJson({ error: "member_required", message: "카카오 회원 계정으로 이용해 주세요." }, 403) };
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
    if (data.user.id === TEMPORARY_MEMBER_OWNER_ID) {
      const { admin } = createSupabaseServerClients();
      try {
        const memberMode = await getOwnerMemberModeState(admin, data.user.id);
        if (!memberMode.active) {
          return {
            ok: false as const,
            response: commerceJson(
              {
                error: "member_required",
                message: "소유자 센터에서 임시 회원 권한을 활성화해 주세요.",
              },
              403,
            ),
          };
        }
      } catch {
        return {
          ok: false as const,
          response: commerceJson(
            {
              error: "member_unavailable",
              message: "회원 권한 상태를 확인하지 못했습니다.",
            },
            503,
          ),
        };
      }
    }
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
      return { ok: false as const, response: commerceJson({ error: "member_required", message: "카카오 회원 계정으로 이용해 주세요." }, 403) };
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
  if (auth.userId === TEMPORARY_MEMBER_OWNER_ID) {
    try {
      const memberMode = await getOwnerMemberModeState(auth.admin, auth.userId);
      if (memberMode.active) {
        return {
          ok: false as const,
          response: commerceJson(
            {
              error: "member_mode_active",
              message: "임시 회원 권한을 종료한 뒤 운영 기능을 이용해 주세요.",
            },
            403,
          ),
        };
      }
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
  const { data: role, error } = await auth.admin
    .from("account_access_roles")
    .select("role_code, grade_level, reports_to_operator_id")
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error) return { ok: false as const, response: commerceJson({ error: "role_unavailable", message: "운영 권한을 확인하지 못했습니다." }, 503) };
  const roleCode = role?.role_code;
  if (roleCode !== "owner" && roleCode !== "operator" && roleCode !== "employee") {
    return { ok: false as const, response: commerceJson({ error: "forbidden", message: "운영 권한이 없습니다." }, 403) };
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
