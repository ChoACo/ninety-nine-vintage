import { getMonthlyTokenUsage } from "@/lib/ai/tokenTracker";

export async function GET() {
  try {
    const usage = await getMonthlyTokenUsage();
    return Response.json({
      totalTokens: usage.total_tokens,
      primaryCalls: usage.primary_model_calls,
      fallbackCalls: usage.fallback_model_calls,
      primaryModel: usage.primary_model,
    });
  } catch {
    return Response.json(
      { error: "토큰 사용량을 불러오지 못했습니다." },
      { status: 503 },
    );
  }
}