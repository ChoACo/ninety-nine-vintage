import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import {
  PRODUCTION_TEST_MEMBER_EMAIL,
  PRODUCTION_TEST_MEMBER_IDENTIFIER,
} from "@/lib/productionTestMember";
import { enforceTestMemberLoginRateLimit } from "@/lib/ratelimit/server";
import { createSupabasePublicClient } from "@/lib/supabase/server";

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  if (!hasTrustedRequestOrigin(request)) {
    return response({ error: "forbidden" }, 403);
  }
  const rateLimit = await enforceTestMemberLoginRateLimit(request);
  if (!rateLimit.ok) return rateLimit.response;

  const body = await request.json().catch(() => null) as
    | { identifier?: unknown; password?: unknown }
    | null;
  if (
    !body ||
    Object.keys(body).some((key) => !["identifier", "password"].includes(key)) ||
    typeof body.identifier !== "string" ||
    typeof body.password !== "string" ||
    body.identifier.trim() !== PRODUCTION_TEST_MEMBER_IDENTIFIER ||
    body.password.length < 12 ||
    body.password.length > 256
  ) {
    return response({ error: "invalid_credentials" }, 401);
  }

  try {
    const signedIn = await createSupabasePublicClient().auth.signInWithPassword({
      email: PRODUCTION_TEST_MEMBER_EMAIL,
      password: body.password,
    });
    const user = signedIn.data.user;
    const session = signedIn.data.session;
    if (
      signedIn.error ||
      !user ||
      !session ||
      user.app_metadata?.canary !== true ||
      user.app_metadata?.hidden_test !== true ||
      user.app_metadata?.role !== "member"
    ) {
      if (session) await createSupabasePublicClient().auth.signOut();
      return response({ error: "invalid_credentials" }, 401);
    }
    return response({
      session: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      },
    });
  } catch {
    return response({ error: "authentication_unavailable" }, 503);
  }
}
