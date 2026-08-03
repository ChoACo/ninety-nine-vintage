import { MultiProviderRouter } from "@/lib/multicloud/MultiProviderRouter";
import type { ResourceLocator } from "@/lib/multicloud/ProductService";

export interface CleanupReport {
  deleted: number;
  failed: Array<{ id: string; providerId: string; reason: string }>;
  scanned: number;
}

export class BatchCleanupScheduler<T extends Record<string, unknown>> {
  constructor(
    private readonly router: MultiProviderRouter<T>,
    private readonly locator: ResourceLocator<T>,
    private readonly batchSize = 500,
  ) {}

  /**
   * 매일 자정 Cron/Cloudflare Scheduled Handler에서 호출합니다.
   * 실물 파일 삭제가 실패하면 DB와 locator는 남겨 재시도 가능하게 합니다.
   */
  async run(now = new Date()): Promise<CleanupReport> {
    const report: CleanupReport = { deleted: 0, failed: [], scanned: 0 };
    for (const database of this.router.databases) {
      let expired;
      try {
        expired = await database.listExpired(now, this.batchSize);
      } catch (error) {
        report.failed.push({
          id: "database-scan",
          providerId: database.id,
          reason: error instanceof Error ? error.message : "만료 데이터 조회 실패",
        });
        continue;
      }

      report.scanned += expired.length;
      for (const record of expired) {
        const storage = this.router.getStorage(record.storageProviderId);
        if (!storage) {
          report.failed.push({ id: record.id, providerId: record.storageProviderId, reason: "스토리지 어댑터 없음" });
          continue;
        }
        try {
          // 순서가 중요합니다: 객체 → 원본 DB 레코드 → 중앙 위치 메타데이터.
          await storage.delete(record.storageKey);
          await database.delete(record.id);
          await this.locator.delete(record.id);
          report.deleted += 1;
        } catch (error) {
          report.failed.push({
            id: record.id,
            providerId: record.storageProviderId,
            reason: error instanceof Error ? error.message : "정리 실패",
          });
        }
      }
    }
    return report;
  }
}
