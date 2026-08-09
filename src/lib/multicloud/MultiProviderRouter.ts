import {
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
  private databaseCursor = 0;
  private readonly databaseCircuit = new CircuitBreaker();
  private readonly storageById: Map<string, StorageAdapter>;
  private readonly databaseById: Map<string, DatabaseAdapter<T>>;

  constructor(
    readonly storages: readonly StorageAdapter[],
    readonly databases: readonly DatabaseAdapter<T>[],
    private readonly capacityThreshold = 0.9,
    private activeStorageProviderId = storages[0]?.id,
    private readonly restoreThreshold = 0.4,
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

  /** 정책 순서를 지키며 검증된 용량 경계에서만 신규 쓰기 대상을 변경합니다. */
  async upload(input: StorageUploadInput): Promise<StoredObject> {
    const activeIndex = this.storages.findIndex((provider) => provider.id === this.activeStorageProviderId);
    if (activeIndex < 0) throw new ProviderUnavailableError("활성 스토리지 공급자가 등록되지 않았습니다.", this.activeStorageProviderId);

    for (const preferred of this.storages.slice(0, activeIndex)) {
      const usage = await preferred.getUsageStats();
      if (usage.verified && usage.capacityBytes > 0
        && (usage.usedBytes + input.body.byteLength) / usage.capacityBytes <= this.restoreThreshold) {
        const stored = await preferred.upload(input);
        this.activeStorageProviderId = preferred.id;
        return stored;
      }
    }

    const active = this.storages[activeIndex];
    const activeUsage = await active.getUsageStats();
    if (!activeUsage.verified) return active.upload(input);
    const projectedRatio = activeUsage.capacityBytes > 0
      ? (activeUsage.usedBytes + input.body.byteLength) / activeUsage.capacityBytes : Number.POSITIVE_INFINITY;
    if (projectedRatio < this.capacityThreshold) return active.upload(input);

    const next = this.storages[activeIndex + 1];
    if (!next) throw new ProviderUnavailableError("스토리지 안전 임계치에 도달했고 다음 공급자가 없습니다.", active.id);
    const nextUsage = await next.getUsageStats();
    if (!nextUsage.verified || nextUsage.capacityBytes <= 0
      || (nextUsage.usedBytes + input.body.byteLength) / nextUsage.capacityBytes >= this.capacityThreshold) {
      throw new ProviderUnavailableError("다음 스토리지 공급자의 사용량 또는 canary가 검증되지 않았습니다.", next.id);
    }
    const stored = await next.upload(input);
    this.activeStorageProviderId = next.id;
    return stored;
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
