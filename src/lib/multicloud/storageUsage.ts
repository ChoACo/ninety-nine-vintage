import "server-only";

import { createSupabaseServerClients } from "@/lib/supabase/server";

export interface StorageProviderUsage {
  providerId: string;
  usedBytes: number;
  capacityBytes: number;
  recordCount: number;
  ratio: number;
  state: "active" | "degraded" | "offline" | "unused";
}

export interface StorageUsageSummary {
  providers: StorageProviderUsage[];
  totalUsedBytes: number;
  totalCapacityBytes: number;
  ratio: number;
  rolloverThreshold: number;
  activeProviderId: string;
  measuredAt: string;
}

const DEFAULT_CAPACITY_BYTES = Number(process.env.MULTICLOUD_DEFAULT_CAPACITY_BYTES ?? "107374182400");
const SUPABASE_CAPACITY_BYTES = Number(process.env.MULTICLOUD_SUPABASE_CAPACITY_BYTES ?? "107374182400");
const R2_CAPACITY_BYTES = Number(process.env.MULTICLOUD_R2_CAPACITY_BYTES ?? "0");

const CAPACITY_BY_PROVIDER: Record<string, number> = {
  supabase: SUPABASE_CAPACITY_BYTES,
  r2: R2_CAPACITY_BYTES,
};

const KNOWN_PROVIDERS = ["supabase", "r2"];

interface AggregateRow {
  storage_provider_id: string;
  total_bytes: number;
  record_count: number;
}

function rawAdminClient(admin: ReturnType<typeof createSupabaseServerClients>["admin"]) {
  return admin as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
}

export async function getStorageUsageSummary(): Promise<StorageUsageSummary> {
  const { admin } = createSupabaseServerClients();
  const rpc = rawAdminClient(admin);

  const { data, error } = await rpc.rpc("get_multicloud_storage_usage", {});

  const rows = (error ? [] : Array.isArray(data) ? data as Array<Record<string, unknown>> : []) as Array<Record<string, unknown>>;
  const aggregate = new Map<string, AggregateRow>();
  for (const row of rows) {
    const id = typeof row.storage_provider_id === "string" ? row.storage_provider_id : "";
    if (!id) continue;
    aggregate.set(id, {
      storage_provider_id: id,
      total_bytes: typeof row.total_bytes === "string" ? Number(row.total_bytes) : Number(row.total_bytes ?? 0),
      record_count: typeof row.record_count === "string" ? Number(row.record_count) : Number(row.record_count ?? 0),
    });
  }

  const providers: StorageProviderUsage[] = KNOWN_PROVIDERS.map((id) => {
    const stats = aggregate.get(id);
    const usedBytes = stats?.total_bytes ?? 0;
    const capacityBytes = CAPACITY_BY_PROVIDER[id] ?? DEFAULT_CAPACITY_BYTES;
    const ratio = capacityBytes > 0 ? usedBytes / capacityBytes : 0;
    return {
      providerId: id,
      usedBytes,
      capacityBytes,
      recordCount: stats?.record_count ?? 0,
      ratio,
      state: stats ? (ratio >= 0.95 ? "offline" : ratio >= 0.9 ? "degraded" : "active") : "unused",
    };
  });

  for (const [id, stats] of aggregate.entries()) {
    if (KNOWN_PROVIDERS.includes(id)) continue;
    const capacityBytes = CAPACITY_BY_PROVIDER[id] ?? DEFAULT_CAPACITY_BYTES;
    const ratio = capacityBytes > 0 ? stats.total_bytes / capacityBytes : 0;
    providers.push({
      providerId: id,
      usedBytes: stats.total_bytes,
      capacityBytes,
      recordCount: stats.record_count,
      ratio,
      state: ratio >= 0.95 ? "offline" : ratio >= 0.9 ? "degraded" : "active",
    });
  }

  const totalUsedBytes = providers.reduce((sum, p) => sum + p.usedBytes, 0);
  const totalCapacityBytes = providers.reduce((sum, p) => sum + p.capacityBytes, 0);
  const ratio = totalCapacityBytes > 0 ? totalUsedBytes / totalCapacityBytes : 0;
  const rolloverThreshold = 0.9;

  const activeCandidate = providers
    .filter((p) => p.state !== "offline")
    .sort((a, b) => {
      if (a.ratio !== b.ratio) return a.ratio - b.ratio;
      return a.providerId.localeCompare(b.providerId);
    })[0];
  const activeProviderId = activeCandidate?.providerId ?? KNOWN_PROVIDERS[0];

  return {
    providers,
    totalUsedBytes,
    totalCapacityBytes,
    ratio,
    rolloverThreshold,
    activeProviderId,
    measuredAt: new Date().toISOString(),
  };
}
