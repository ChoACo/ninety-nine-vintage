import type { SupabaseClient } from "@supabase/supabase-js";

import { PortOneIntegrationError } from "./server";

export type PaymentRuntimeMode = "manual_transfer" | "portone";

/**
 * Read the single global payment switch with the server-only service-role
 * RPC. Direct table grants stay closed so browser roles cannot discover the
 * business account before a validated transfer starts. A missing or malformed
 * singleton fails closed so an incomplete deployment cannot enable PortOne.
 */
export async function getPaymentRuntimeMode(
  admin: SupabaseClient,
): Promise<PaymentRuntimeMode> {
  const { data, error } = await admin.rpc(
    "get_payment_runtime_mode_for_service",
  );

  if (error) {
    throw new PortOneIntegrationError(
      "payment_runtime_mode_lookup_failed",
      "The active payment mode could not be loaded.",
      503,
      error,
    );
  }

  const activeMode = data;
  if (activeMode !== "manual_transfer" && activeMode !== "portone") {
    throw new PortOneIntegrationError(
      "payment_runtime_mode_invalid",
      "The active payment mode is missing or invalid.",
      503,
    );
  }
  return activeMode;
}

export async function requirePortOneRuntimeMode(
  admin: SupabaseClient,
): Promise<void> {
  if ((await getPaymentRuntimeMode(admin)) !== "portone") {
    throw new PortOneIntegrationError(
      "portone_temporarily_disabled",
      "PortOne is disabled while manual bank transfer is active.",
      503,
    );
  }
}
