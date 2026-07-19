import type { SupabaseClient } from "@supabase/supabase-js";

import {
  authenticatePaymentRequest,
  resolveRequestedPaymentBuyerId,
  paymentJsonResponse,
} from "@/lib/portone/http";
import {
  getPortOneClient,
  getPortOnePublicConfiguration,
  isPortOnePayMethod,
  isValidPaymentId,
  logPortOneServerError,
  PortOneIntegrationError,
  requireProductAvailableForPortOne,
  truncateUtf8Bytes,
} from "@/lib/portone/server";
import { requirePortOneRuntimeMode } from "@/lib/portone/runtimeMode";

interface PreparePaymentRow {
  expected_amount: number;
  order_name: string;
  payment_id: string;
  payment_status: string;
  product_id: string;
}

function firstRow(data: unknown): PreparePaymentRow | null {
  if (Array.isArray(data)) {
    return (data[0] as PreparePaymentRow | undefined) ?? null;
  }
  return data && typeof data === "object"
    ? (data as PreparePaymentRow)
    : null;
}

export async function POST(request: Request) {
  try {
    const authentication = await authenticatePaymentRequest(request);
    if (!authentication.ok) return authentication.response;
    await requirePortOneRuntimeMode(
      authentication.admin as unknown as SupabaseClient,
    );

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return paymentJsonResponse({ error: "invalid_json" }, 400);
    }
    if (!body || typeof body !== "object") {
      return paymentJsonResponse({ error: "invalid_request" }, 400);
    }

    const { productId, paymentId, payMethod, testMemberId } = body as Record<
      string,
      unknown
    >;
    if (
      typeof productId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        productId,
      ) ||
      !isValidPaymentId(paymentId) ||
      !isPortOnePayMethod(payMethod) ||
      (testMemberId !== undefined &&
        (typeof testMemberId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            testMemberId,
          )))
    ) {
      return paymentJsonResponse({ error: "invalid_request" }, 400);
    }

    const { storeId, channelKey } = getPortOnePublicConfiguration(payMethod);
    const rpcClient = authentication.admin as unknown as SupabaseClient;
    const paymentBuyerId = await resolveRequestedPaymentBuyerId(
      rpcClient,
      authentication.userId,
      typeof testMemberId === "string" ? testMemberId : null,
    );
    if (!paymentBuyerId) {
      return paymentJsonResponse({ error: "forbidden" }, 403);
    }
    await requireProductAvailableForPortOne(rpcClient, productId);
    const { data, error } = await rpcClient.rpc("prepare_portone_payment", {
      p_member_id: paymentBuyerId,
      p_payment_id: paymentId,
      p_product_id: productId,
      p_requested_method: payMethod,
      p_store_id: storeId,
    });
    if (error) {
      const statusByCode: Record<string, number> = {
        "22023": 400,
        "42501": 403,
        "22000": 409,
        "23505": 409,
        "55000": 409,
        P0001: 409,
        P0002: 409,
      };
      const status = statusByCode[error.code ?? ""] ?? 500;
      return paymentJsonResponse(
        { error: status < 500 ? "payment_not_available" : "prepare_failed" },
        status,
      );
    }

    const order = firstRow(data);
    const amount = Number(order?.expected_amount);
    if (
      !order ||
      order.payment_id !== paymentId ||
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {
      return paymentJsonResponse({ error: "prepare_invalid_response" }, 500);
    }

    try {
      await getPortOneClient().payment.preRegisterPayment({
        paymentId,
        storeId,
        totalAmount: amount,
        currency: "KRW",
      });
    } catch (error) {
      logPortOneServerError("preregister", error, paymentId);
      return paymentJsonResponse({ error: "portone_preregister_failed" }, 502);
    }

    return paymentJsonResponse(
      {
        storeId,
        channelKey,
        paymentId,
        // KCP's documented limit is 100 UTF-8 bytes. JavaScript string length
        // would let a long Korean title exceed that limit.
        orderName: truncateUtf8Bytes(order.order_name, 100),
        totalAmount: amount,
        currency: "KRW",
      },
      200,
    );
  } catch (error) {
    logPortOneServerError("prepare", error);
    if (error instanceof PortOneIntegrationError) {
      return paymentJsonResponse({ error: error.code }, error.status);
    }
    return paymentJsonResponse({ error: "prepare_failed" }, 500);
  }
}

export async function GET() {
  return paymentJsonResponse({ error: "method_not_allowed" }, 405);
}

