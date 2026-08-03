import {
  isQuotaError,
  ProviderUnavailableError,
  type DatabaseAdapter,
  type StorageAdapter,
  type StorageUploadInput,
  type StoredObject,
  type UnifiedRecord,
} from "@/lib/multicloud/contracts";

interface CircuitState { failures: number; openUntil: number; }

/** 짧은 장애가 전체 요청을 지연시키지 않도록 프로바이더별 회로 상태를 격리합니다. */
class CircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  constructor(private readonly failureThreshold = 3, private readonly cooldownMs = 30_000) {}

  canRequest(id: string, now = Date.now()) {
    return (this.states.get(id)?.openUntil ?? 0) <= now;
  }

  success(id: string) { this.states.delete(id); }

  failure(id: string) {
    const previous = this.states.get(id) ?? { failures: 0, openUntil: 0 };
    const failures = previous.failures + 1;
    this.states.set(id, {
      failures,
      openUntil: failures >= this.failureThreshold ? Date.now() + this.cooldownMs : 0,
    });
  }
}

export class MultiProviderRouter<T = Record<string, unknown>> {
  private storageCursor = 0;
  private databaseCursor = 0;
  private readonly storageCircuit = new CircuitBreaker();
  private readonly databaseCircuit = new CircuitBreaker();
  private readonly storageById: Map<string, StorageAdapter>;
  private readonly databaseById: Map<string, DatabaseAdapter<T>>;

  constructor(
    readonly storages: readonly StorageAdapter[],
    readonly databases: readonly DatabaseAdapter<T>[],
    private readonly capacityThreshold = 0.9,
  ) {
    if (storages.length === 0 || databases.length === 0) {
      throw new Error("스토리지와 DB 프로바이더를 각각 한 개 이상 등록해야 합니다.");
    }
    this.storageById = new Map(storages.map((provider) => [provider.id, provider]));
    this.databaseById = new Map(databases.map((provider) => [provider.id, provider]));
    if (this.storageById.size !== storages.length || this.databaseById.size !== databases.length) {
      throw new Error("프로바이더 ID는 풀 안에서 중복될 수 없습니다.");
    }
  }

  private rotated<P>(providers: readonly P[], cursor: number) {
    return providers.map((_, index) => providers[(cursor + index) % providers.length]);
  }

  /** 90% 미만이면서 회로가 닫힌 스토리지를 라운드로빈으로 선택합니다. */
  async upload(input: StorageUploadInput): Promise<StoredObject> {
    const candidates = this.rotated(this.storages, this.storageCursor);
    const errors: unknown[] = [];
    for (const provider of candidates) {
      if (!this.storageCircuit.canRequest(provider.id)) continue;
      try {
        const usage = await provider.getUsageStats();
        const projected = usage.usedBytes + input.body.byteLength;
        if (usage.capacityBytes <= 0 || projected / usage.capacityBytes >= this.capacityThreshold) {
          continue;
        }
        const stored = await provider.upload(input);
        this.storageCircuit.success(provider.id);
        this.storageCursor = (this.storages.indexOf(provider) + 1) % this.storages.length;
        return stored;
      } catch (error) {
        errors.push(error);
        this.storageCircuit.failure(provider.id);
        if (!isQuotaError(error)) {
          // 네트워크/점검 장애도 다음 프로바이더로 즉시 우회합니다.
        }
      }
    }
    throw new AggregateError(errors, "사용 가능한 스토리지 프로바이더가 없습니다.");
  }

  /** 실제 선택된 DB ID를 레코드에 기록한 뒤 저장합니다. */
  async insert(buildRecord: (databaseProviderId: string) => UnifiedRecord<T>) {
    const candidates = this.rotated(this.databases, this.databaseCursor);
    const errors: unknown[] = [];
    for (const provider of candidates) {
      if (!this.databaseCircuit.canRequest(provider.id)) continue;
      try {
        const health = await provider.getHealth();
        if (health.state === "offline") {
          this.databaseCircuit.failure(provider.id);
          continue;
        }
        const record = buildRecord(provider.id);
        if (health.usage) {
          const estimatedBytes = new TextEncoder().encode(JSON.stringify(record.payload)).byteLength;
          const projected = health.usage.usedBytes + estimatedBytes;
          if (health.usage.capacityBytes <= 0
            || projected / health.usage.capacityBytes >= this.capacityThreshold) {
            continue;
          }
        }
        await provider.insert(record);
        this.databaseCircuit.success(provider.id);
        this.databaseCursor = (this.databases.indexOf(provider) + 1) % this.databases.length;
        return record;
      } catch (error) {
        errors.push(error);
        this.databaseCircuit.failure(provider.id);
      }
    }
    throw new AggregateError(errors, "사용 가능한 DB 프로바이더가 없습니다.");
  }

  /** 메타데이터에 기록된 정확한 위치로 읽기 요청을 분기합니다. */
  async read(record: UnifiedRecord<T>) {
    const storage = this.storageById.get(record.storageProviderId);
    const database = this.databaseById.get(record.dbProviderId);
    if (!storage || !database) {
      throw new ProviderUnavailableError("레코드의 프로바이더를 현재 풀에서 찾을 수 없습니다.", record.id);
    }
    const [freshRecord, body] = await Promise.all([
      database.select(record.id),
      storage.download(record.storageKey),
    ]);
    if (!freshRecord) throw new Error("데이터베이스 레코드가 없습니다.");
    return { body, record: freshRecord };
  }

  getStorage(id: string) { return this.storageById.get(id); }
  getDatabase(id: string) { return this.databaseById.get(id); }
}
