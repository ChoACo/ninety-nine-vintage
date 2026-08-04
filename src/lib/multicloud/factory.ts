import "server-only";

import { createSupabaseServerClients } from "@/lib/supabase/server";
import { PostgresDatabaseAdapter, type SqlExecutor } from "@/lib/multicloud/adapters";
import { MultiProviderRouter } from "@/lib/multicloud/MultiProviderRouter";
import type { DatabaseAdapter, StorageAdapter, UsageStats } from "@/lib/multicloud/contracts";
import { SupabaseStorageAdapter } from "@/lib/multicloud/adapters";

import { CloudflareR2Adapter } from "@/lib/multicloud/r2";

const PRODUCT_IMAGE_BUCKET = "product-images";

function readConfiguredBucket() {
  return process.env.MULTICLOUD_PRODUCT_IMAGE_BUCKET?.trim() || PRODUCT_IMAGE_BUCKET;
}

/**
 * Supabase service-role 클라이언트만 raw SQL을 실행할 수 없으므로, 마이그레이션에
 * 추가한 app_private.multi_provider_records_exec 보안-definer 함수를 통해 SQL을
 * 실행합니다. params는 함수형 인자로 넘겨 SQL 인젝션을 차단합니다.
 */
export class SupabaseSqlExecutor implements SqlExecutor {
  constructor(private readonly admin: ReturnType<typeof createSupabaseServerClients>["admin"]) {}

  async query<Row = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
    // database.types.ts에 미반영된 신규 RPC는 명시적으로 형변환해 호출합니다.
    const rpc = (
      this.admin as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }
    ).rpc;
    const { data, error } = await rpc("multi_provider_records_exec", {
      query_text: sql,
      params: params.map((value) => (value === undefined ? null : value)),
    });
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as Row[] };
  }
}

function supabaseUsageProbe(admin: ReturnType<typeof createSupabaseServerClients>["admin"]) {
  return async (): Promise<UsageStats> => {
    const { data, error } = await admin.storage.from(readConfiguredBucket()).list("", { limit: 1 });
    if (error) throw error;
    return {
      capacityBytes: Number.POSITIVE_INFINITY,
      usedBytes: data?.length ?? 0,
      measuredAt: new Date(),
    };
  };
}

export interface MultiCloudPool {
  router: MultiProviderRouter;
  storages: StorageAdapter[];
  databases: DatabaseAdapter[];
}

let poolCache: MultiCloudPool | undefined;

/**
 * 환경 설정을 읽어 스토리지/DB 어댑터를 등록하고 라우터를 만듭니다.
 * 서버 모듈이므로 테스트나 브라우저 번들에서 import 하지 마세요.
 */
export function getMultiCloudPool(): MultiCloudPool {
  if (poolCache) return poolCache;

  const { admin } = createSupabaseServerClients();
  const bucket = readConfiguredBucket();

  const storageProbe = supabaseUsageProbe(admin);
  const storages: StorageAdapter[] = [
    new SupabaseStorageAdapter("supabase", bucket, admin, storageProbe),
  ];

  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    storages.push(
      new CloudflareR2Adapter(
        "r2",
        process.env.R2_ACCOUNT_ID,
        process.env.MULTICLOUD_R2_BUCKET ?? bucket,
        process.env.R2_ACCESS_KEY_ID,
        process.env.R2_SECRET_ACCESS_KEY,
        process.env.R2_PUBLIC_DOMAIN,
      )
    );
  }

  const sql = new SupabaseSqlExecutor(admin);
  const databases: DatabaseAdapter[] = [
    new PostgresDatabaseAdapter("supabase", sql, storageProbe),
  ];

  const router = new MultiProviderRouter(storages, databases);
  poolCache = { router, storages, databases };
  return poolCache;
}

/** 크론/스케줄러가 일괄 정리 전에 재사용 중인 풀 인스턴스를 초기화할 수 있습니다. */
export function resetMultiCloudPool() {
  poolCache = undefined;
}
