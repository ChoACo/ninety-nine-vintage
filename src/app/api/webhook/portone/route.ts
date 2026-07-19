import * as PortOne from "@portone/server-sdk";

import { paymentJsonResponse } from "@/lib/portone/http";
import { getPaymentRuntimeMode } from "@/lib/portone/runtimeMode";
import {
  getPortOneWebhookSecret,
  isValidPaymentId,
  logPortOneServerError,
  PortOneIntegrationError,
  verifyAndSyncPortOnePayment,
} from "@/lib/portone/server";
import { createSupabaseServerClients } from "@/lib/supabase/server";

const PAYMENT_EVENT_PREFIX = "Transaction.";

export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return paymentJsonResponse({ error: "invalid_body" }, 400);
  }

  let webhook: PortOne.Webhook.Webhook;
  try {
    webhook = await PortOne.Webhook.verify(
      getPortOneWebhookSecret(),
      rawBody,
      {
        "webhook-id": request.headers.get("webhook-id") ?? "",
        "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
        "webhook-signature": request.headers.get("webhook-signature") ?? "",
      },
    );
  } catch (error) {
    logPortOneServerError("webhook_signature", error);
    if (
      error instanceof PortOneIntegrationError &&
      error.code === "portone_configuration_missing"
    ) {
      return paymentJsonResponse({ error: error.code }, error.status);
    }
    return paymentJsonResponse({ error: "invalid_webhook_signature" }, 400);
  }

  if (
    PortOne.Webhook.isUnrecognizedWebhook(webhook) ||
    !webhook.type.startsWith(PAYMENT_EVENT_PREFIX)
  ) {
    return paymentJsonResponse({ received: true, ignored: true }, 200);
  }
  const paymentId = "paymentId" in webhook.data
    ? webhook.data.paymentId
    : null;
  if (!isValidPaymentId(paymentId)) {
    return paymentJsonResponse({ received: true, ignored: true }, 200);
  }

  try {
    const { admin } = createSupabaseServerClients();
    if ((await getPaymentRuntimeMode(admin)) === "manual_transfer") {
      return paymentJsonResponse(
        { received: true, ignored: true, reason: "manual_transfer_active" },
        200,
      );
    }
    const synced = await verifyAndSyncPortOnePayment(admin, paymentId);
    return paymentJsonResponse(
      {
        received: true,
        paymentStatus: synced.payment_status,
        portoneStatus: synced.portone_status,
      },
      200,
    );
  } catch (error) {
    logPortOneServerError("webhook_sync", error, paymentId);
    if (error instanceof PortOneIntegrationError) {
      return paymentJsonResponse({ error: error.code }, error.status);
    }
    return paymentJsonResponse({ error: "webhook_processing_failed" }, 500);
  }
}

export async function GET() {
  return paymentJsonResponse({ error: "method_not_allowed" }, 405);
}

