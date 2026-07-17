import { hasTrustedRequestOrigin } from "@/src/lib/kakao/oidc";
import { createSupabaseServerClients } from "@/src/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

function response(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export async function POST(request: Request) {
  if (!hasTrustedRequestOrigin(request)) {
    return response({ error: "forbidden" }, 403);
  }
  const accessToken = readBearerToken(request);
  if (!accessToken) return response({ error: "unauthorized" }, 401);

  try {
    const { verifier, admin } = createSupabaseServerClients();
    const { data, error } = await verifier.auth.getUser(accessToken);
    const isKakaoMember = data.user?.identities?.some(
      (identity) => identity.provider === "kakao",
    );
    if (error || !data.user || !isKakaoMember) {
      return response({ error: "unauthorized" }, 401);
    }

    // The service owner is a Kakao account too, so provider validation alone is
    // not enough. Keep the hidden owner account out of every self-service
    // deletion path; the database also enforces this with a delete trigger.
    const roleClient = admin as unknown as SupabaseClient;
    const { data: accessRole, error: accessRoleError } = await roleClient
      .from("account_access_roles")
      .select("role_code")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (accessRoleError) {
      return response({ error: "role_check_failed" }, 500);
    }
    if (accessRole?.role_code === "owner") {
      return response({ error: "protected_account" }, 403);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(
      data.user.id,
    );
    if (deleteError) return response({ error: "delete_failed" }, 500);
    return response({ deleted: true }, 200);
  } catch {
    return response({ error: "delete_failed" }, 500);
  }
}

export async function GET() {
  return response({ error: "method_not_allowed" }, 405);
}
