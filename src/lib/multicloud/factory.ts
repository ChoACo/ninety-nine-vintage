import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseStorageAdapter } from "@/lib/multicloud/adapters";
import type { StorageAdapter, UsageStats } from "@/lib/multicloud/contracts";
import { CloudflareR2Adapter } from "@/lib/multicloud/r2";

const PRODUCT_IMAGE_BUCKET = "product-images";

function readConfiguredBucket() {
  return process.env.MULTICLOUD_PRODUCT_IMAGE_BUCKET?.trim() || PRODUCT_IMAGE_BUCKET;
}

function supabaseUsageProbe(admin: SupabaseClient) {
  return async (): Promise<UsageStats> => {
    const { data, error } = await admin.storage.from(readConfiguredBucket()).list("", { limit: 1 });
    if (error) throw error;
    return {
      capacityBytes: Number(process.env.MULTICLOUD_SUPABASE_CAPACITY_BYTES ?? "107374182400"),
      // This probe is used only for adapter health. Authoritative usage is reported
      // by the purpose-specific database aggregate in storageUsage.ts.
      usedBytes: data?.length ?? 0,
      measuredAt: new Date(),
    };
  };
}

/**
 * Returns only storage providers with complete runtime credentials. Supabase is
 * canonical; R2 remains conditional. S3/GCS example adapters are not registered.
 */
export function getConfiguredStorageAdapters(admin: SupabaseClient): ReadonlyMap<string, StorageAdapter> {
  const bucket = readConfiguredBucket();
  const adapters: StorageAdapter[] = [
    new SupabaseStorageAdapter("supabase", bucket, admin, supabaseUsageProbe(admin)),
  ];

  if (
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
  ) {
    adapters.push(new CloudflareR2Adapter(
      "r2",
      process.env.R2_ACCOUNT_ID,
      process.env.MULTICLOUD_R2_BUCKET ?? bucket,
      process.env.R2_ACCESS_KEY_ID,
      process.env.R2_SECRET_ACCESS_KEY,
      process.env.R2_PUBLIC_DOMAIN,
    ));
  }

  return new Map(adapters.map((adapter) => [adapter.id, adapter]));
}
