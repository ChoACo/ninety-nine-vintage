import { MultiProviderRouter } from "@/lib/multicloud/MultiProviderRouter";
import type { UnifiedRecord } from "@/lib/multicloud/contracts";

export interface ProductPayload {
  title: string;
  description: string;
  [key: string]: unknown;
}

/** 통합 저장/조회 흐름의 예시 서비스입니다. locator는 ID→메타데이터를 찾는 중앙 카탈로그입니다. */
export interface ResourceLocator<T> {
  get(id: string): Promise<UnifiedRecord<T> | null>;
  put(record: UnifiedRecord<T>): Promise<void>;
  delete(id: string): Promise<void>;
}

export class ProductService {
  constructor(
    private readonly router: MultiProviderRouter<ProductPayload>,
    private readonly locator: ResourceLocator<ProductPayload>,
    private readonly ttlDays = 60,
  ) {}

  async create(input: { id: string; image: Uint8Array; contentType: string; payload: ProductPayload }) {
    const storageKey = `products/${input.id}/${crypto.randomUUID()}`;
    const stored = await this.router.upload({
      body: input.image,
      contentType: input.contentType,
      key: storageKey,
    });
    let persistedRecord: UnifiedRecord<ProductPayload> | null = null;
    try {
      const now = new Date();
      const record = await this.router.insert((dbProviderId) => ({
        id: input.id,
        storageProviderId: stored.providerId,
        storageKey: stored.key,
        dbProviderId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.ttlDays * 86_400_000),
        payload: input.payload,
      }));
      persistedRecord = record;
      await this.locator.put(record);
      return { record, publicUrl: stored.publicUrl };
    } catch (error) {
      // DB/locator 저장이 실패하면 생성된 메타데이터와 객체를 역순으로 보상 삭제합니다.
      if (persistedRecord) {
        await this.router.getDatabase(persistedRecord.dbProviderId)
          ?.delete(persistedRecord.id).catch(() => undefined);
      }
      await this.router.getStorage(stored.providerId)?.delete(stored.key).catch(() => undefined);
      throw error;
    }
  }

  async get(id: string) {
    const location = await this.locator.get(id);
    if (!location) return null;
    return this.router.read(location);
  }
}
