import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import {
  createSupabaseServerClients,
  createSupabaseUserClient,
} from "@/lib/supabase/server";
import { getManualTransferAccount } from "@/lib/manualTransferConfig";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      const { data, error } = await createSupabaseUserClient(token).rpc(
        "begin_my_combined_auction_payment",
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
      const roleResult = await admin
        .from("account_access_roles")
        .select("role_code")
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (roleResult.error) {
        return json({ error: "manual_transfer_deadline_unavailable" }, 503);
      }
      return json({
        transfer: {
          ...(data as Record<string, unknown>),
          deadlineEnforcementExempt:
            roleResult.data?.role_code === "band_member",
        },
      });
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
