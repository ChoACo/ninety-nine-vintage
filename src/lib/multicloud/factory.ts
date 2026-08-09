import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseStorageAdapter } from "@/lib/multicloud/adapters";
import type { StorageAdapter, UsageStats } from "@/lib/multicloud/contracts";
import { CloudflareR2Adapter } from "@/lib/multicloud/r2";
import { GoogleDriveStorageAdapter } from "@/lib/multicloud/googleDrive";

const PRODUCT_IMAGE_BUCKET = "product-images";

function readConfiguredBucket() {
  return process.env.MULTICLOUD_PRODUCT_IMAGE_BUCKET?.trim() || PRODUCT_IMAGE_BUCKET;
}

function trackedUsageProbe(admin: SupabaseClient, providerId: string, capacityBytes: number) {
  return async (): Promise<UsageStats> => {
    const { data, error } = await (admin as unknown as { rpc(name: string): Promise<{ data: unknown; error: Error | null }> })
      .rpc("get_multicloud_storage_usage");
    if (error) throw error;
    const row = Array.isArray(data) ? data.find((candidate) => candidate
      && typeof candidate === "object" && (candidate as Record<string, unknown>).storage_provider_id === providerId) as Record<string, unknown> | undefined : undefined;
    return {
      capacityBytes,
      usedBytes: Number(row?.total_bytes ?? 0),
      measuredAt: new Date(),
      verified: row?.usage_known === true,
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
    new SupabaseStorageAdapter("supabase", bucket, admin, trackedUsageProbe(admin, "supabase",
      Number(process.env.MULTICLOUD_SUPABASE_CAPACITY_BYTES ?? "1073741824"))),
  ];

  if (
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.CLOUDFLARE_API_TOKEN &&
    process.env.R2_CANARY_VERIFIED_AT &&
    process.env.R2_ROLLBACK_VERIFIED_AT
  ) {
    adapters.push(new CloudflareR2Adapter(
      "r2",
      process.env.R2_ACCOUNT_ID,
      process.env.MULTICLOUD_R2_BUCKET ?? bucket,
      process.env.R2_ACCESS_KEY_ID,
      process.env.R2_SECRET_ACCESS_KEY,
      process.env.R2_PUBLIC_DOMAIN,
      process.env.CLOUDFLARE_API_TOKEN,
      Number(process.env.MULTICLOUD_R2_CAPACITY_BYTES ?? "10737418240"),
    ));
  }

  if (adapters.some((adapter) => adapter.id === "r2")
    && process.env.GOOGLE_DRIVE_STORAGE_ENABLED === "true"
    && process.env.GOOGLE_DRIVE_ACCESS_TOKEN
    && process.env.GOOGLE_DRIVE_ACCESS_TOKEN_EXPIRES_AT
    && process.env.GOOGLE_DRIVE_FOLDER_ID
    && process.env.GOOGLE_DRIVE_CANARY_VERIFIED_AT
    && process.env.GOOGLE_DRIVE_ROLLBACK_VERIFIED_AT) {
    adapters.push(new GoogleDriveStorageAdapter(
      "google_drive", process.env.GOOGLE_DRIVE_ACCESS_TOKEN,
      new Date(process.env.GOOGLE_DRIVE_ACCESS_TOKEN_EXPIRES_AT),
      process.env.GOOGLE_DRIVE_FOLDER_ID,
      Number(process.env.MULTICLOUD_GOOGLE_DRIVE_CAPACITY_BYTES ?? String(3 * 1024 ** 4)),
    ));
  }

  return new Map(adapters.map((adapter) => [adapter.id, adapter]));
}
