import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import {
  PRODUCTION_TEST_MEMBER_IDENTIFIER,
} from "@/lib/productionTestMember";
import { signInProductionTestMember } from "@/lib/productionTestMember.server";
import { enforceTestMemberLoginRateLimit } from "@/lib/ratelimit/server";

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
    const session = await signInProductionTestMember(body.password);
    if (!session) {
      return response({ error: "invalid_credentials" }, 401);
    }
    return response({
      session: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      },
    });
  } catch {
    return response({ error: "authentication_unavailable" }, 503);
  }
}
