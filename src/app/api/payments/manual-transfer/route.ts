import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import {
  createSupabaseServerClients,
  createSupabaseUserClient,
} from "@/lib/supabase/server";
import { getManualTransferAccount } from "@/lib/manualTransferConfig";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcClient {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

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
    const { verifier, admin } = createSupabaseServerClients();
    await getManualTransferAccount(admin);
    if (
      body?.action === "begin" &&
      typeof body.depositorName === "string" &&
      (body.includeShippingFee === undefined ||
        typeof body.includeShippingFee === "boolean") &&
      (body.productIds === undefined ||
        (Array.isArray(body.productIds) &&
          body.productIds.length >= 1 &&
          body.productIds.length <= 100 &&
          body.productIds.every((value): value is string =>
            typeof value === "string" && UUID_PATTERN.test(value),
          )))
    ) {
      const { data: authData, error: authError } = await verifier.auth.getUser(token);
      if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
      const depositorName = body.depositorName.trim();
      if (depositorName.length < 1 || depositorName.length > 80) {
        return json({ error: "invalid_depositor_name" }, 422);
      }
      const productIds = Array.isArray(body.productIds)
        ? [...new Set(body.productIds as string[])].sort()
        : null;
      const { data, error } = await (
        createSupabaseUserClient(token) as unknown as RpcClient
      ).rpc(
        "begin_my_combined_auction_payment_registered",
        {
          p_depositor_name: depositorName,
          p_include_shipping_fee: body.includeShippingFee !== false,
          ...(productIds ? { p_product_ids: productIds } : {}),
        },
      );
      if (error) {
        const status = error.code === "42501"
          ? 403
          : error.code === "P0002"
            ? 404
            : error.code === "22023"
              ? 422
              : 409;
        return json(
          {
            error: "manual_transfer_failed",
            message: error.message || "일괄 결제를 시작하지 못했습니다.",
          },
          status,
        );
      }
      return json({
        transfer: {
          ...(data as Record<string, unknown>),
          deadlineEnforcementExempt: false,
        },
      });
    }
    if (
      body?.action === "request_confirmation" &&
      typeof body.idempotencyKey === "string" &&
      UUID_PATTERN.test(body.idempotencyKey) &&
      Array.isArray(body.orderIds) &&
      body.orderIds.length >= 1 &&
      body.orderIds.length <= 100 &&
      body.orderIds.every((value): value is string =>
        typeof value === "string" && UUID_PATTERN.test(value),
      )
    ) {
      const { data: authData, error: authError } = await verifier.auth.getUser(token);
      if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
      const orderIds = [...new Set(body.orderIds as string[])].sort();
      if (orderIds.length !== body.orderIds.length) {
        return json({ error: "invalid_confirmation_request" }, 422);
      }
      const { data, error } = await (
        createSupabaseUserClient(token) as unknown as RpcClient
      ).rpc("request_my_combined_auction_payment_confirmation_v2", {
        p_order_ids: orderIds,
        p_idempotency_key: body.idempotencyKey,
      });
      if (error) {
        const status = error.code === "42501"
          ? 403
          : error.code === "P0002"
            ? 404
            : ["22023", "55000"].includes(error.code ?? "")
              ? 409
              : 503;
        return json(
          {
            error: "confirmation_request_failed",
            message: error.message || "입금 확인을 요청하지 못했습니다.",
          },
          status,
        );
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return json({ error: "confirmation_request_unavailable" }, 503);
      }
      return json({ request: data }, 201);
    }
    if (body?.action === "confirm") {
      return json({ error: "manual_transfer_ledger_required" }, 409);
    }
    return json({ error: "invalid_request" }, 400);
  } catch {
    return json({ error: "manual_transfer_failed" }, 409);
  }
}

export async function GET() {
  return json({ error: "method_not_allowed" }, 405);
}
