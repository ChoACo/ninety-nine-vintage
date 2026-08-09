import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import type { OpenRouterUsage } from "@/lib/ai/aiModelRouter";
import { PRIMARY_MODEL } from "@/lib/ai/aiModelRouter";
import type { ProductEnhancementStatus } from "@/lib/ai/productEnhancement";

export interface TokenUsageLogInput {
  provider?: string;
  model: string;
  endpoint?: string;
  usage: OpenRouterUsage;
  status?: ProductEnhancementStatus;
}

function rawClient(client: SupabaseClient) {
  return client as unknown as {
    from: (table: string) => {
      insert: (values: Record<string, unknown>) => { throwOnError: () => Promise<unknown> };
      select: (columns: string) => {
        gte: (column: string, value: string) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
      };
    };
  };
}

export async function logTokenUsage(input: TokenUsageLogInput): Promise<boolean> {
  try {
    await rawClient(createSupabasePublicClient()).from("ai_token_usage_logs").insert({
      provider: input.provider ?? "openrouter",
      model: input.model,
      endpoint: input.endpoint ?? "chat/completions",
      prompt_tokens: input.usage.prompt_tokens,
      completion_tokens: input.usage.completion_tokens,
      total_tokens: input.usage.total_tokens,
      status: input.status ?? "success",
    }).throwOnError();
    return true;
  } catch (error) {
    console.error("[token-tracker] failed to log token usage", error);
    return false;
  }
}

export interface MonthlyTokenUsage {
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  primary_model_calls: number;
  fallback_model_calls: number;
  primary_model: string;
}

const MONTHLY_TOKEN_LIMIT = 1_000_000;

export async function getMonthlyTokenUsage(): Promise<MonthlyTokenUsage> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  try {
    const { data, error } = await rawClient(createSupabasePublicClient())
      .from("ai_token_usage_logs")
      .select("prompt_tokens, completion_tokens, model, status")
      .gte("created_at", monthStart);

    if (error || !data) {
      return {
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_tokens: 0,
        primary_model_calls: 0,
        fallback_model_calls: 0,
        primary_model: PRIMARY_MODEL,
      };
    }

    const primaryModel = PRIMARY_MODEL;
    let totalPrompt = 0;
    let totalCompletion = 0;
    let primaryCalls = 0;
    let fallbackCalls = 0;

    for (const row of data) {
      const promptTokens = typeof row.prompt_tokens === "number" ? row.prompt_tokens : 0;
      const completionTokens = typeof row.completion_tokens === "number" ? row.completion_tokens : 0;
      totalPrompt += promptTokens;
      totalCompletion += completionTokens;
      // fallback/failed 상태의 요청은 소모 토큰에는 포함하되 정상 호출 수로 세지 않습니다.
      if (row.status !== "success" && row.status !== "partial_fallback") continue;
      if (typeof row.model === "string" && row.model === primaryModel) {
        primaryCalls += 1;
      } else {
        fallbackCalls += 1;
      }
    }

    return {
      total_prompt_tokens: totalPrompt,
      total_completion_tokens: totalCompletion,
      total_tokens: totalPrompt + totalCompletion,
      primary_model_calls: primaryCalls,
      fallback_model_calls: fallbackCalls,
      primary_model: primaryModel,
    };
  } catch {
    return {
      total_prompt_tokens: 0,
      total_completion_tokens: 0,
      total_tokens: 0,
      primary_model_calls: 0,
      fallback_model_calls: 0,
      primary_model: PRIMARY_MODEL,
    };
  }
}

export function getMonthlyTokenLimit(): number {
  return MONTHLY_TOKEN_LIMIT;
}