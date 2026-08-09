import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getConfiguredStorageAdapters } from "@/lib/multicloud/factory";

type ProviderState = {
  providerId: string; priority: number; enabled: boolean; capacityBytes: number; usageBytes: number | null;
  safeThreshold: number; restoreThreshold: number; version: number;
};
type Policy = { activeProviderId: string; version: number; providers: ProviderState[] };

export async function GET(request: Request) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Supabase configuration missing" }, { status: 500 });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = admin as unknown as { rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
  if (process.env.NODE_ENV === "production") {
    const authorization = request.headers.get("authorization")?.trim() ?? "";
    const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const verified = provided
      ? await rpc.rpc("verify_web_push_dispatch_secret", { p_secret: provided })
      : { data: false, error: null };
    if (verified.error || verified.data !== true) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const initial = await rpc.rpc("get_storage_routing_policy");
  if (initial.error || !initial.data) return NextResponse.json({ error: "storage_policy_unavailable" }, { status: 503 });
  const policy = initial.data as Policy;
  const adapters = getConfiguredStorageAdapters(admin);
  const updated: string[] = [];
  for (const state of policy.providers) {
    const adapter = adapters.get(state.providerId);
    if (!adapter) continue;
    try {
      const usage = await adapter.getUsageStats();
      if (!usage.verified) continue;
      const verifiedAt = new Date().toISOString();
      const credentialsAt = state.providerId === "supabase" ? null
        : process.env[`${state.providerId === "r2" ? "R2" : "GOOGLE_DRIVE"}_CANARY_VERIFIED_AT`] ?? null;
      const rollbackAt = state.providerId === "supabase" ? null
        : process.env[`${state.providerId === "r2" ? "R2" : "GOOGLE_DRIVE"}_ROLLBACK_VERIFIED_AT`] ?? null;
      const result = await rpc.rpc("update_storage_provider_runtime_state", {
        p_provider_id: state.providerId, p_enabled: true, p_capacity_bytes: usage.capacityBytes,
        p_usage_bytes: usage.usedBytes, p_usage_measured_at: usage.measuredAt.toISOString(),
        p_credentials_verified_at: credentialsAt ?? verifiedAt,
        p_canary_verified_at: credentialsAt, p_rollback_verified_at: rollbackAt,
        p_last_error: "", p_expected_version: state.version,
      });
      if (result.error) throw new Error(result.error.message);
      updated.push(state.providerId);
    } catch {
      // Unknown or failed probes never activate or switch a provider.
    }
  }
  const refreshed = await rpc.rpc("get_storage_routing_policy");
  if (refreshed.error || !refreshed.data) return NextResponse.json({ error: "storage_policy_refresh_failed" }, { status: 503 });
  const nextPolicy = refreshed.data as Policy;
  const current = nextPolicy.providers.find((state) => state.providerId === nextPolicy.activeProviderId);
  let target: ProviderState | undefined;
  if (current?.usageBytes != null) {
    target = nextPolicy.providers.filter((state) => state.enabled && state.priority < current.priority
      && state.usageBytes != null && state.usageBytes / state.capacityBytes <= state.restoreThreshold)[0];
    if (!target && current.usageBytes / current.capacityBytes >= current.safeThreshold) {
      target = nextPolicy.providers.find((state) => state.enabled && state.priority === current.priority + 1
        && state.usageBytes != null && state.usageBytes / state.capacityBytes < state.safeThreshold);
    }
  }
  if (target) await rpc.rpc("set_storage_active_provider", {
    p_provider_id: target.providerId, p_reason: "verified storage threshold transition",
    p_expected_version: nextPolicy.version,
  });
  return NextResponse.json({ success: true, updatedProviders: updated, activeProviderId: target?.providerId ?? nextPolicy.activeProviderId });
}
