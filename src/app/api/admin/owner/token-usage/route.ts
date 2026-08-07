import { getMonthlyTokenUsage } from "@/lib/ai/tokenTracker";
import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
} from "@/lib/ownerAccess/server";

export async function GET(request: Request) {
  try {
    await authenticateOwnerAccessRequest(request);
    const usage = await getMonthlyTokenUsage();
    return ownerAccessJsonResponse({
      totalTokens: usage.total_tokens,
      primaryCalls: usage.primary_model_calls,
      fallbackCalls: usage.fallback_model_calls,
      primaryModel: usage.primary_model,
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}