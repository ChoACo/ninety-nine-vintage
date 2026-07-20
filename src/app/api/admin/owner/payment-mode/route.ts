import {
  type AuthenticatedOwnerAccess,
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  ownerRpc,
  readSmallJsonBody,
} from "@/src/lib/ownerAccess/server";
import {
  getPortOneChannelMode,
  getPortOnePublicConfiguration,
  getPortOneWebhookSecret,
  PORTONE_PAY_METHODS,
} from "@/src/lib/portone/server";

interface PaymentRuntimeRow {
  active_mode?: unknown;
  bank_name?: unknown;
  account_number?: unknown;
  configured?: unknown;
  updated_at?: unknown;
}

interface PortOneEnvironmentStatus {
  channelMode: "TEST" | "LIVE" | null;
  ready: boolean;
}

function readPortOneEnvironmentStatus(): PortOneEnvironmentStatus {
  try {
    for (const method of PORTONE_PAY_METHODS) getPortOnePublicConfiguration(method);
    const channelMode = getPortOneChannelMode();
    getPortOneWebhookSecret();
    return {
      channelMode,
      ready: Boolean(process.env.PORTONE_API_SECRET?.trim()),
    };
  } catch {
    return { channelMode: null, ready: false };
  }
}

async function hasCommercePortOneSchema(
  context: AuthenticatedOwnerAccess,
): Promise<boolean> {
  const { error } = await context.admin
    .from("payment_orders")
    .select("commerce_order_id")
    .limit(0);
  return !error;
}

async function readRuntime(context: AuthenticatedOwnerAccess) {
  const [rows, commerceSchemaReady] = await Promise.all([
    ownerRpc<PaymentRuntimeRow[]>(context, "get_manual_transfer_settings"),
    hasCommercePortOneSchema(context),
  ]);
  const row = rows?.[0] ?? {};
  const environment = readPortOneEnvironmentStatus();
  return {
    activeMode: row.active_mode === "portone" ? "portone" : "manual_transfer",
    bankConfigured: row.configured === true,
    commerceSchemaReady,
    portoneChannelMode: environment.channelMode,
    portoneEnvironmentReady: environment.ready,
    portoneReady: environment.ready && commerceSchemaReady,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

export async function GET(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    return ownerAccessJsonResponse(await readRuntime(context));
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const mode = body.mode;
    if (mode !== "manual_transfer" && mode !== "portone") {
      return ownerAccessJsonResponse({ error: "invalid_payment_mode" }, 400);
    }
    const current = await readRuntime(context);
    if (current.activeMode === mode) {
      return ownerAccessJsonResponse(current);
    }
    if (mode === "portone") {
      if (!current.commerceSchemaReady) {
        return ownerAccessJsonResponse(
          { error: "portone_schema_not_ready" },
          409,
        );
      }
      if (!current.portoneEnvironmentReady) {
        return ownerAccessJsonResponse({ error: "portone_not_ready" }, 409);
      }
    } else if (!current.bankConfigured) {
      return ownerAccessJsonResponse(
        { error: "manual_transfer_not_ready" },
        409,
      );
    }

    await ownerRpc<string>(context, "set_payment_runtime_mode", {
      p_active_mode: mode,
    });
    const updated = await readRuntime(context);
    if (updated.activeMode !== mode) {
      return ownerAccessJsonResponse({ error: "payment_mode_conflict" }, 409);
    }
    return ownerAccessJsonResponse(updated);
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
