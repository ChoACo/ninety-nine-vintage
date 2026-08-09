import "server-only";

const OR_API = "https://openrouter.ai/api/v1/chat/completions";

export const PRIMARY_MODEL = "google/gemini-3.5-flash";

const MODELS = [
  // Primary
  PRIMARY_MODEL,
  // Fallbacks
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "qwen/qwen3-vl-8b-instruct",
] as const;

export type OpenRouterModel = (typeof MODELS)[number];

export function getConfiguredModels(): readonly OpenRouterModel[] {
  return MODELS;
}

export interface OpenRouterCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string | unknown[] }>;
  response_format?: { type: string; json_schema?: unknown };
  max_tokens?: number;
  temperature?: number;
  max_completion_tokens?: number;
}

export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenRouterCompletionResponse {
  id: string;
  model: string;
  choices: Array<{ message: { content: string } }>;
  usage?: OpenRouterUsage;
}

export interface RouteCompletionResult {
  response: OpenRouterCompletionResponse;
  usedModel: string;
  usage: OpenRouterUsage;
  attemptedModels: number;
  fallbackReason: string | null;
}

const RETRYABLE_STATUS_CODES = new Set([401, 402, 408, 429, 500, 502, 503, 504]);

export async function routeCompletion(
  params: OpenRouterCompletionRequest,
  options: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<RouteCompletionResult> {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY가 설정되지 않았습니다.");

  let lastError: Error | null = null;
  let attempted = 0;

  for (let index = 0; index < MODELS.length; index += 1) {
    const model = MODELS[index];
    attempted += 1;
    try {
      const response = await fetch(OR_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...params, model }),
        signal: options.signal,
      });

      if (!response.ok) {
        let errorMessage = `${response.status}`;
        try {
          const errorBody = await response.json() as { error?: { message?: string } };
          if (errorBody.error?.message) errorMessage = `${response.status} ${errorBody.error.message}`;
        } catch { /**/ }
        const statusError = new Error(`OpenRouter ${errorMessage}`);
        if (!RETRYABLE_STATUS_CODES.has(response.status)) throw statusError;
        lastError = statusError;
        continue;
      }

      const data = await response.json() as OpenRouterCompletionResponse;
      return {
        response: data,
        usedModel: model,
        usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        attemptedModels: attempted,
        fallbackReason: lastError?.message ?? null,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw Object.assign(
    lastError ?? new Error("모든 모델 시도가 실패했습니다."),
    { modelsTried: attempted },
  );
}