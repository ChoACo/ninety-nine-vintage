import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  ownerRpc,
} from "@/lib/ownerAccess/server";
import { signInProductionTestMember } from "@/lib/productionTestMember.server";
import { enforceTestMemberLoginRateLimit } from "@/lib/ratelimit/server";

export async function POST(request: Request) {
  try {
    const owner = await authenticateOwnerAccessRequest(request);
    const rateLimit = await enforceTestMemberLoginRateLimit(request);
    if (!rateLimit.ok) return rateLimit.response;

    const linkedMembers = await ownerRpc<Array<{ test_user_id?: unknown }>>(
      owner,
      "get_owner_hidden_test_member",
    );
    const linkedUserId = linkedMembers[0]?.test_user_id;
    if (typeof linkedUserId !== "string") {
      return ownerAccessJsonResponse(
        { error: "member_access_unavailable" },
        503,
      );
    }

    const password = process.env.PRODUCTION_TEST_MEMBER_PASSWORD?.trim();
    if (!password) {
      return ownerAccessJsonResponse(
        { error: "member_access_not_configured" },
        503,
      );
    }
    const session = await signInProductionTestMember(password);
    if (!session || session.userId !== linkedUserId) {
      return ownerAccessJsonResponse(
        { error: "member_access_unavailable" },
        503,
      );
    }
    await ownerRpc<string>(
      owner,
      "owner_record_hidden_test_member_session_access",
      { p_test_user_id: session.userId },
    );
    return ownerAccessJsonResponse({
      session: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      },
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
