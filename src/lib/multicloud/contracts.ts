export type ProviderState = "active" | "degraded" | "offline";

export interface UsageStats {
  capacityBytes: number;
  usedBytes: number;
  measuredAt: Date;
  verified: boolean;
}

export interface StoredObject {
  key: string;
  providerId: string;
  publicUrl?: string;
  sizeBytes: number;
}

export interface StorageUploadInput {
  body: Uint8Array;
  contentType: string;
  key: string;
}

export interface StorageAdapter {
  readonly id: string;
  upload(input: StorageUploadInput): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  download(key: string): Promise<Uint8Array>;
  getUsageStats(): Promise<UsageStats>;
}

export interface UnifiedRecord<T = Record<string, unknown>> {
  id: string;
  storageProviderId: string;
  storageKey: string;
  sizeBytes: number;
  dbProviderId: string;
  createdAt: Date;
  expiresAt: Date;
  payload: T;
}

export interface DatabaseHealth {
  latencyMs: number;
  state: ProviderState;
  checkedAt: Date;
  usage?: UsageStats;
}

export interface DatabaseAdapter<T = Record<string, unknown>> {
  readonly id: string;
  insert(record: UnifiedRecord<T>): Promise<void>;
  select(id: string): Promise<UnifiedRecord<T> | null>;
  delete(id: string): Promise<void>;
  getHealth(): Promise<DatabaseHealth>;
  listExpired(before: Date, limit: number): Promise<UnifiedRecord<T>[]>;
}

export class ProviderUnavailableError extends Error {
  constructor(message: string, readonly providerId: string, readonly cause?: unknown) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export function isQuotaError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown; status?: unknown; message?: unknown };
  return candidate.status === 429
    || candidate.code === "QuotaExceeded"
    || candidate.code === "StorageQuotaExceeded"
    || candidate.name === "QuotaExceededError"
    || (typeof candidate.message === "string" && /quota|capacity|storage limit/iu.test(candidate.message));
}
