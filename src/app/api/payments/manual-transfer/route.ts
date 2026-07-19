import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import { beginManualBankTransfer, confirmManualBankTransfer } from "@/services/manualPayments";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function bearerToken(request: Request) {
  const value = request.headers.get("authorization")?.trim();
  return value?.startsWith("Bearer ") ? value.slice(7).trim() : null;
}

export async function POST(request: Request) {
  if (!hasTrustedRequestOrigin(request)) return json({ error: "forbidden" }, 403);
  const token = bearerToken(request);
  if (!token) return json({ error: "unauthorized" }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    if (body?.action === "begin" && typeof body.productId === "string") {
      return json({ transfer: await beginManualBankTransfer(token, body.productId) });
    }
    if (body?.action === "confirm" && typeof body.orderId === "string" && typeof body.expectedUpdatedAt === "string") {
      await confirmManualBankTransfer(token, body.orderId, body.expectedUpdatedAt);
      return json({ confirmed: true });
    }
    return json({ error: "invalid_request" }, 400);
  } catch {
    return json({ error: "manual_transfer_failed" }, 409);
  }
}

export async function GET() {
  return json({ error: "method_not_allowed" }, 405);
}
