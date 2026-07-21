import * as PortOne from "@portone/server-sdk";

import { PORTONE_COMMERCE_ENABLED } from "@/lib/commerce/paymentMode";
import { paymentJsonResponse } from "@/src/lib/portone/http";
import {
  getPortOneWebhookSecret,
  isValidPaymentId,
  logPortOneServerError,
  PortOneIntegrationError,
  verifyAndSyncPortOnePayment,
} from "@/src/lib/portone/server";
import { createSupabaseServerClients } from "@/src/lib/supabase/server";

const PAYMENT_EVENT_PREFIX = "Transaction.";

export async function POST(request: Request) {
  if (!PORTONE_COMMERCE_ENABLED) {
    return paymentJsonResponse(
      { received: true, ignored: true, reason: "portone_archived" },
      200,
    );
  }

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
