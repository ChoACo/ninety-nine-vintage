import "server-only";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getR2Client, getR2Config } from "@/lib/storage/r2Client";

export interface R2StorageUsage {
  providerId: "r2";
  bucketName: string;
  usedBytes: number;
  objectCount: number;
  usageVerified: true;
}

export interface StorageUsageSummary {
  provider: R2StorageUsage;
  totalUsedBytes: number;
  totalObjectCount: number;
  measuredAt: string;
}

export async function getStorageUsageSummary(): Promise<StorageUsageSummary> {
  const { bucketName } = getR2Config();
  const client = getR2Client();
  let continuationToken: string | undefined;
  let totalUsedBytes = 0;
  let totalObjectCount = 0;

  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents ?? []) {
      totalUsedBytes += object.Size ?? 0;
      totalObjectCount += 1;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !continuationToken) {
      throw new Error("r2_usage_pagination_failed");
    }
  } while (continuationToken);

  return {
    provider: {
      providerId: "r2",
      bucketName,
      usedBytes: totalUsedBytes,
      objectCount: totalObjectCount,
      usageVerified: true,
    },
    totalUsedBytes,
    totalObjectCount,
    measuredAt: new Date().toISOString(),
  };
}
