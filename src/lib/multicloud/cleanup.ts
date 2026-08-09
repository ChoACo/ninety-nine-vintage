import type { StorageAdapter } from "@/lib/multicloud/contracts";

export interface ExpiredStorageRecord {
  id: string;
  storage_provider_id: string;
  storage_key: string;
}

export interface CleanupFailure {
  id: string;
  providerId: string;
  reason: string;
}

export interface ObjectFirstCleanupReport {
  scanned: number;
  deleted: number;
  failed: CleanupFailure[];
}

export async function cleanupExpiredStorageRecords(
  records: readonly ExpiredStorageRecord[],
  adapters: ReadonlyMap<string, StorageAdapter>,
  deleteLocator: (id: string) => Promise<void>,
): Promise<ObjectFirstCleanupReport> {
  const report: ObjectFirstCleanupReport = { scanned: records.length, deleted: 0, failed: [] };

  for (const record of records) {
    const storage = adapters.get(record.storage_provider_id);
    if (!storage) {
      report.failed.push({
        id: record.id,
        providerId: record.storage_provider_id,
        reason: "storage_provider_not_configured",
      });
      continue;
    }

    try {
      // Locator deletion is deliberately last so an object failure remains retryable.
      await storage.delete(record.storage_key);
      await deleteLocator(record.id);
      report.deleted += 1;
    } catch (error) {
      report.failed.push({
        id: record.id,
        providerId: record.storage_provider_id,
        reason: error instanceof Error ? error.message : "storage_cleanup_failed",
      });
    }
  }

  return report;
}
