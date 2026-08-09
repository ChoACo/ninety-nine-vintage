import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DatabaseAdapter,
  DatabaseHealth,
  StorageAdapter,
  StorageUploadInput,
  StoredObject,
  UnifiedRecord,
  UsageStats,
} from "@/lib/multicloud/contracts";

type UsageProbe = () => Promise<UsageStats>;

interface S3CompatibleClient {
  putObject(input: { bucket: string; body: Uint8Array; contentType: string; key: string }): Promise<void>;
  deleteObject(input: { bucket: string; key: string }): Promise<void>;
  getObject(input: { bucket: string; key: string }): Promise<Uint8Array>;
}

/** AWS S3와 Cloudflare R2는 이 동일 어댑터를 서로 다른 endpoint/client로 등록합니다. */
export class S3CompatibleStorageAdapter implements StorageAdapter {
  constructor(
    readonly id: string,
    private readonly bucket: string,
    private readonly client: S3CompatibleClient,
    private readonly usageProbe: UsageProbe,
    private readonly publicUrl?: (key: string) => string,
  ) {}

  async upload(input: StorageUploadInput): Promise<StoredObject> {
    await this.client.putObject({
      bucket: this.bucket,
      body: input.body,
      contentType: input.contentType,
      key: input.key,
    });
    return {
      key: input.key,
      providerId: this.id,
      publicUrl: this.publicUrl?.(input.key),
      sizeBytes: input.body.byteLength,
    };
  }

  delete(key: string) { return this.client.deleteObject({ bucket: this.bucket, key }); }
  download(key: string) { return this.client.getObject({ bucket: this.bucket, key }); }
  getUsageStats() { return this.usageProbe(); }
}

interface GcsBucketLike {
  uploadBytes(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  download(key: string): Promise<Uint8Array>;
}

/** GCS SDK의 Bucket/File 호출을 얇은 GcsBucketLike로 감싼 뒤 주입합니다. */
export class GcsStorageAdapter implements StorageAdapter {
  constructor(
    readonly id: string,
    private readonly bucket: GcsBucketLike,
    private readonly usageProbe: UsageProbe,
    private readonly publicUrl?: (key: string) => string,
  ) {}

  async upload(input: StorageUploadInput): Promise<StoredObject> {
    await this.bucket.uploadBytes(input.key, input.body, input.contentType);
    return {
      key: input.key,
      providerId: this.id,
      publicUrl: this.publicUrl?.(input.key),
      sizeBytes: input.body.byteLength,
    };
  }

  delete(key: string) { return this.bucket.delete(key); }
  download(key: string) { return this.bucket.download(key); }
  getUsageStats() { return this.usageProbe(); }
}


/** service-role/secret key로 만든 서버 전용 SupabaseClient만 전달해야 합니다. */
export class SupabaseStorageAdapter implements StorageAdapter {
  constructor(
    readonly id: string,
    private readonly bucket: string,
    private readonly client: SupabaseClient,
    private readonly usageProbe: UsageProbe,
  ) {}

  async upload(input: StorageUploadInput): Promise<StoredObject> {
    const { error } = await this.client.storage.from(this.bucket).upload(
      input.key,
      input.body,
      { contentType: input.contentType, upsert: false },
    );
    if (error) throw error;
    const { data } = this.client.storage.from(this.bucket).getPublicUrl(input.key);
    return {
      key: input.key,
      providerId: this.id,
      publicUrl: data.publicUrl,
      sizeBytes: input.body.byteLength,
    };
  }

  async delete(key: string) {
    const { error } = await this.client.storage.from(this.bucket).remove([key]);
    if (error) throw error;
  }

  async download(key: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error) throw error;
    return new Uint8Array(await data.arrayBuffer());
  }

  getUsageStats() { return this.usageProbe(); }
}

export interface SqlExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

interface UnifiedRecordRow {
  id: string;
  storage_provider_id: string;
  storage_key: string;
  object_size_bytes: number | null;
  db_provider_id: string;
  created_at: string | Date;
  expires_at: string | Date;
  payload: Record<string, unknown>;
}

function fromRow<T>(row: UnifiedRecordRow): UnifiedRecord<T> {
  return {
    id: row.id,
    storageProviderId: row.storage_provider_id,
    storageKey: row.storage_key,
    sizeBytes: row.object_size_bytes ?? 0,
    dbProviderId: row.db_provider_id,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    payload: row.payload as T,
  };
}

/** Supabase, Neon, CockroachDB, Cloud SQL의 PostgreSQL 실행기를 공통 계약으로 통일합니다. */
export class PostgresDatabaseAdapter<T = Record<string, unknown>> implements DatabaseAdapter<T> {
  constructor(
    readonly id: string,
    private readonly sql: SqlExecutor,
    private readonly usageProbe?: UsageProbe,
  ) {}

  async insert(record: UnifiedRecord<T>) {
    await this.sql.query(
      `insert into multi_provider_records
       (id, storage_provider_id, storage_key, object_size_bytes, db_provider_id, created_at, expires_at, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [record.id, record.storageProviderId, record.storageKey, record.sizeBytes,
        record.dbProviderId, record.createdAt.toISOString(), record.expiresAt.toISOString(), JSON.stringify(record.payload)],
    );
  }

  async select(id: string) {
    const result = await this.sql.query<UnifiedRecordRow>(
      "select * from multi_provider_records where id = $1 limit 1",
      [id],
    );
    return result.rows[0] ? fromRow<T>(result.rows[0]) : null;
  }

  async delete(id: string) {
    await this.sql.query("delete from multi_provider_records where id = $1", [id]);
  }

  async getHealth(): Promise<DatabaseHealth> {
    const started = performance.now();
    try {
      const [, usage] = await Promise.all([
        this.sql.query("select 1 as healthy"),
        this.usageProbe?.(),
      ]);
      return { checkedAt: new Date(), latencyMs: performance.now() - started, state: "active", usage };
    } catch {
      return { checkedAt: new Date(), latencyMs: performance.now() - started, state: "offline" };
    }
  }

  async listExpired(before: Date, limit: number) {
    const result = await this.sql.query<UnifiedRecordRow>(
      `select * from multi_provider_records
       where expires_at <= $1 order by expires_at asc limit $2`,
      [before.toISOString(), Math.min(1_000, Math.max(1, limit))],
    );
    return result.rows.map((row) => fromRow<T>(row));
  }
}
