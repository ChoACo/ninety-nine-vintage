import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PortOneIntegrationError } from "@/lib/portone/server";

export type PaymentRuntimeMode = "manual_transfer" | "portone";

export function isPortOneFeatureEnabled() {
  return process.env.NINETY_NINE_ENABLE_PORTONE?.trim().toLowerCase() === "true";
}

export async function getPaymentRuntimeMode(admin: SupabaseClient): Promise<PaymentRuntimeMode> {
  if (!isPortOneFeatureEnabled()) return "manual_transfer";
  const { data, error } = await admin.rpc("get_payment_runtime_mode_for_service");
  if (error) throw new PortOneIntegrationError("payment_runtime_mode_lookup_failed", "결제 운영 모드를 확인하지 못했습니다.", 503, error);
  if (data !== "manual_transfer" && data !== "portone") throw new PortOneIntegrationError("payment_runtime_mode_invalid", "결제 운영 모드가 올바르지 않습니다.", 503);
  return data;
}

export async function requirePortOneRuntimeMode(admin: SupabaseClient): Promise<void> {
  if (!isPortOneFeatureEnabled() || (await getPaymentRuntimeMode(admin)) !== "portone") {
    throw new PortOneIntegrationError("portone_temporarily_disabled", "계좌이체 운영 중에는 PortOne 결제가 비활성화됩니다.", 503);
  }
}
