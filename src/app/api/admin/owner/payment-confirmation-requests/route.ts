import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
} from "@/lib/ownerAccess/server";

interface RpcClient {
  rpc(
    functionName: string,
    parameters?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const rpc = access.userClient as unknown as RpcClient;
    const [commerce, auction] = await Promise.all([
      rpc.rpc("get_owner_payment_confirmation_queue"),
      rpc.rpc("get_owner_auction_payment_confirmation_queue"),
    ]);
    if (commerce.error || auction.error) {
      return ownerAccessJsonResponse(
        { error: "payment_confirmation_queue_unavailable" },
        503,
      );
    }
    return ownerAccessJsonResponse({
      requests: commerce.data ?? [],
      auctionRequests: auction.data ?? [],
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await request.json().catch(() => null) as {
      action?: unknown;
      requestId?: unknown;
      expectedVersion?: unknown;
      resolution?: unknown;
      depositorName?: unknown;
      includeInSettlement?: unknown;
      reason?: unknown;
      idempotencyKey?: unknown;
    } | null;
    if (body?.action === "force_confirm") {
      if (
        typeof body.requestId !== "string" ||
        !UUID_PATTERN.test(body.requestId) ||
        typeof body.expectedVersion !== "number" ||
        !Number.isSafeInteger(body.expectedVersion) ||
        body.expectedVersion < 0 ||
        typeof body.depositorName !== "string" ||
        body.depositorName.trim().length < 1 ||
        body.depositorName.trim().length > 80 ||
        typeof body.includeInSettlement !== "boolean" ||
        typeof body.reason !== "string" ||
        body.reason.trim().length < 3 ||
        body.reason.trim().length > 500 ||
        typeof body.idempotencyKey !== "string" ||
        !UUID_PATTERN.test(body.idempotencyKey)
      ) {
        return ownerAccessJsonResponse({ error: "invalid_forced_confirmation" }, 422);
      }
      const { data, error } = await (
        access.userClient as unknown as RpcClient
      ).rpc("owner_force_confirm_auction_payment_request", {
        p_request_id: body.requestId,
        p_expected_version: body.expectedVersion,
        p_depositor_name: body.depositorName.trim(),
        p_include_in_settlement: body.includeInSettlement,
        p_reason: body.reason.trim(),
        p_idempotency_key: body.idempotencyKey,
      });
      if (error) {
        const status = error.code === "42501" ? 403
          : error.code === "P0002" ? 404
          : ["PT409", "23505", "40001"].includes(error.code ?? "") ? 409
          : ["22023", "55000"].includes(error.code ?? "") ? 422
          : 503;
        return ownerAccessJsonResponse(
          { error: "forced_confirmation_failed", message: error.message },
          status,
        );
      }
      return ownerAccessJsonResponse({ result: data });
    }
    if (
      typeof body?.requestId !== "string" ||
      !UUID_PATTERN.test(body.requestId) ||
      typeof body.expectedVersion !== "number" ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 0 ||
      !["cancelled", "not_found"].includes(String(body.resolution))
    ) {
      return ownerAccessJsonResponse({ error: "invalid_confirmation_resolution" }, 422);
    }
    const { data, error } = await (
      access.userClient as unknown as RpcClient
    ).rpc("owner_resolve_auction_payment_confirmation_request", {
      p_request_id: body.requestId,
      p_expected_version: body.expectedVersion,
      p_resolution: body.resolution,
    });
    if (error) {
      const status = error.code === "42501" ? 403
        : error.code === "PT409" ? 409
        : error.code === "22023" ? 422
        : 503;
      return ownerAccessJsonResponse(
        { error: error.message || "confirmation_resolution_failed" },
        status,
      );
    }
    return ownerAccessJsonResponse({ request: data });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
