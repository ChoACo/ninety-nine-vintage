import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import { createSupabaseServerClients } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

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

interface HiddenTestBuyerRow {
  test_user_id: string;
  retired_at: string | null;
}

function firstHiddenTestBuyer(data: unknown): HiddenTestBuyerRow | null {
  if (Array.isArray(data)) {
    return (data[0] as HiddenTestBuyerRow | undefined) ?? null;
  }
  return data && typeof data === "object"
    ? (data as HiddenTestBuyerRow)
    : null;
}

/**
 * Resolve the single active hidden test member owned by `actorUserId` through
 * a service-role-only RPC. Ordinary members therefore receive only their own
 * UUID and can never select another payment buyer.
 */
export async function getAuthorizedPaymentBuyerIds(
  admin: SupabaseClient,
  actorUserId: string,
): Promise<readonly string[]> {
  const { data, error } = await admin.rpc(
    "get_owner_hidden_test_member_for_service",
    {
      p_actor_owner_id: actorUserId,
      p_include_retired: false,
    },
  );
  if (error) return Object.freeze([actorUserId]);

  const hiddenTest = firstHiddenTestBuyer(data);
  return Object.freeze(
    hiddenTest?.test_user_id && hiddenTest.retired_at === null
      ? [actorUserId, hiddenTest.test_user_id]
      : [actorUserId],
  );
}

export async function resolveRequestedPaymentBuyerId(
  admin: SupabaseClient,
  actorUserId: string,
  requestedTestMemberId: string | null,
): Promise<string | null> {
  if (!requestedTestMemberId) return actorUserId;
  const allowedBuyerIds = await getAuthorizedPaymentBuyerIds(
    admin,
    actorUserId,
  );
  return allowedBuyerIds.includes(requestedTestMemberId)
    ? requestedTestMemberId
    : null;
}

