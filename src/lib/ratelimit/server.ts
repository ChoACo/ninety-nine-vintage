import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const RATE_LIMIT_MESSAGE = "요청이 너무 많습니다. 잠시 후 시도해주세요.";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

function buildRedis(): Redis | null {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  return new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

function buildRatelimit(prefix: string): Ratelimit | null {
  const redis = buildRedis();
  if (!redis) return null;
  return new Ratelimit({
    redis,
    prefix,
    limiter: Ratelimit.slidingWindow(2, "5 s"),
    analytics: true,
  });
}

const bidLimiter = buildRatelimit("ratelimit:auction-bids");
const cartLimiter = buildRatelimit("ratelimit:cart");
const testMemberLoginLimiter = (() => {
  const redis = buildRedis();
  if (!redis) return null;
  return new Ratelimit({
    redis,
    prefix: "ratelimit:production-test-member-login",
    limiter: Ratelimit.slidingWindow(5, "10 m"),
    analytics: true,
  });
})();

export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",", 1)[0]?.trim() || null;
}

function identifier(userId: string | null | undefined, request: Request): string {
  return userId ? `user:${userId}` : `ip:${getClientIp(request) ?? "unknown"}`;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; response: Response };

function limitedResponse(): Response {
  return Response.json(
    { error: "rate_limited", message: RATE_LIMIT_MESSAGE, code: "rate_limited" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Retry-After": "5",
      },
    },
  );
}

export async function enforceBidRateLimit(
  request: Request,
  userId?: string | null,
): Promise<RateLimitResult> {
  if (!bidLimiter) return { ok: true };
  try {
    const result = await bidLimiter.limit(identifier(userId, request));
    if (!result.success) return { ok: false, response: limitedResponse() };
    return { ok: true };
  } catch {
    // Redis 장애가 실시간 경매를 마비시키면 안 되므로 통과시킨다.
    return { ok: true };
  }
}

export async function enforceCartRateLimit(
  request: Request,
  userId?: string | null,
): Promise<RateLimitResult> {
  if (!cartLimiter) return { ok: true };
  try {
    const result = await cartLimiter.limit(identifier(userId, request));
    if (!result.success) return { ok: false, response: limitedResponse() };
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

export async function enforceTestMemberLoginRateLimit(
  request: Request,
): Promise<RateLimitResult> {
  if (!testMemberLoginLimiter) return { ok: true };
  try {
    const result = await testMemberLoginLimiter.limit(identifier(null, request));
    if (!result.success) return { ok: false, response: limitedResponse() };
    return { ok: true };
  } catch {
    // Supabase Auth still applies its own authentication rate limits when the
    // optional edge limiter is temporarily unavailable.
    return { ok: true };
  }
}
