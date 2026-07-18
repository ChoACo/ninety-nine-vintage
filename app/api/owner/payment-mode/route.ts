import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  ownerRpc,
  readSmallJsonBody,
} from "@/src/lib/ownerAccess/server";
import {
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

function isPortOneReady(): boolean {
  try {
    for (const method of PORTONE_PAY_METHODS) getPortOnePublicConfiguration(method);
    getPortOneWebhookSecret();
    if (!process.env.PORTONE_API_SECRET?.trim()) return false;
    return true;
  } catch {
    return false;
  }
}

async function readRuntime(context: Awaited<ReturnType<typeof authenticateOwnerAccessRequest>>) {
  const rows = await ownerRpc<PaymentRuntimeRow[]>(context, "get_manual_transfer_settings");
  const row = rows?.[0] ?? {};
  return {
    activeMode: row.active_mode === "portone" ? "portone" : "manual_transfer",
    bankConfigured: row.configured === true,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    portoneReady: isPortOneReady(),
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
    if (mode === "portone" && !isPortOneReady()) {
      return ownerAccessJsonResponse({ error: "portone_not_ready" }, 409);
    }

    const activeMode = await ownerRpc<string>(context, "set_payment_runtime_mode", {
      p_active_mode: mode,
    });
    return ownerAccessJsonResponse({
      ...(await readRuntime(context)),
      activeMode,
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
