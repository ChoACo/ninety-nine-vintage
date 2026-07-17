import { hasTrustedRequestOrigin } from "@/src/lib/kakao/oidc";
import { createSupabaseServerClients } from "@/src/lib/supabase/server";

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
