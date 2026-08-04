import "server-only";

import { getMultiCloudPool } from "@/lib/multicloud/factory";
import { uploadToGoogleDrive } from "@/lib/drive/upload";

export interface DriveArchiveReport {
  uploadedFileId: string | null;
  fileName: string | null;
  archivedRecords: number;
  scannedDatabases: number;
  skippedDatabases: string[];
  failures: Array<{ reason: string }>;
}

/**
 * 60일 TTL의 multi_provider_records를 정리 스케줄러가 삭제하기 전에 일괄 저장
 * 기록으로 Google Drive에 올립니다. 파일명은 KST 날짜로 겹치지 않게 만들고,
 * 만료된 레코드가 없으면 업로드를 생략합니다.
 */
export async function archiveExpiredRecords(
  now = new Date(),
  fetchImpl?: typeof fetch,
): Promise<DriveArchiveReport> {
  const { router } = getMultiCloudPool();
  const report: DriveArchiveReport = {
    uploadedFileId: null,
    fileName: null,
    archivedRecords: 0,
    scannedDatabases: 0,
    skippedDatabases: [],
    failures: [],
  };

  const rows: Array<Record<string, unknown>> = [];
  for (const database of router.databases) {
    report.scannedDatabases += 1;
    let expired;
    try {
      expired = await database.listExpired(now, 1_000);
    } catch {
      report.skippedDatabases.push(database.id);
      report.failures.push({ reason: `DB ${database.id} 만료 조회 실패` });
      continue;
    }
    for (const record of expired) {
      rows.push({
        id: record.id,
        storageProviderId: record.storageProviderId,
        storageKey: record.storageKey,
        dbProviderId: record.dbProviderId,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        payload: record.payload,
      });
    }
  }

  if (rows.length === 0) {
    report.uploadedFileId = null;
    report.fileName = null;
    return report;
  }

  const kstDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).replace(/-/g, "");
  const fileName = `multi-provider-records-${kstDate}-${now.getTime()}.json`;
  const body = new TextEncoder().encode(JSON.stringify({ exportedAt: now.toISOString(), records: rows }));

  try {
    const uploaded = await uploadToGoogleDrive({
      name: fileName,
      contentType: "application/json",
      body,
      fetchImpl,
    });
    report.uploadedFileId = uploaded.fileId;
    report.fileName = uploaded.name;
    report.archivedRecords = rows.length;
  } catch (error) {
    report.failures.push({
      reason: error instanceof Error ? error.message : "Drive 업로드 실패",
    });
  }

  return report;
}
