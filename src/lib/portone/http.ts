import { hasTrustedRequestOrigin } from "@/src/lib/kakao/oidc";
import { createSupabaseServerClients } from "@/src/lib/supabase/server";

export function paymentJsonResponse(
  body: Record<string, unknown>,
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export async function authenticatePaymentRequest(request: Request): Promise<
  | { ok: true; userId: string; admin: ReturnType<typeof createSupabaseServerClients>["admin"] }
  | { ok: false; response: Response }
> {
  if (!hasTrustedRequestOrigin(request)) {
    return {
      ok: false,
      response: paymentJsonResponse({ error: "forbidden" }, 403),
    };
  }

  const accessToken = readBearerToken(request);
  if (!accessToken) {
    return {
      ok: false,
      response: paymentJsonResponse({ error: "unauthorized" }, 401),
    };
  }

  const { verifier, admin } = createSupabaseServerClients();
  const { data, error } = await verifier.auth.getUser(accessToken);
  if (error || !data.user) {
    return {
      ok: false,
      response: paymentJsonResponse({ error: "unauthorized" }, 401),
    };
  }
  return { ok: true, userId: data.user.id, admin };
}
