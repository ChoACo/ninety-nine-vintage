import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import { placeBid, AuctionServiceError } from "@/services/auction";

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: Request) {
  if (!hasTrustedRequestOrigin(request)) return response({ error: "forbidden" }, 403);
  const authorization = request.headers.get("authorization")?.trim();
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!token) return response({ error: "unauthorized" }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const productId = body?.productId;
  const amount = body?.amount;
  if (typeof productId !== "string" || typeof amount !== "number") return response({ error: "invalid_request" }, 400);
  try {
    const bid = await placeBid(token, productId, amount);
    return response({ bid }, 200);
  } catch (error) {
    if (error instanceof AuctionServiceError) {
      const errorMessage = error.message.includes("카카오 회원 로그인")
        ? "현재 계정은 운영자 계정이거나 회원 프로필이 완성되지 않았습니다. 입찰은 카카오 회원 계정으로 이용해 주세요."
        : error.message;
      return response({ error: errorMessage, code: error.code }, 409);
    }
    return response({ error: "bid_failed" }, 500);
  }
}

export async function GET() {
  return response({ error: "method_not_allowed" }, 405);
}
