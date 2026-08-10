export interface OwnerPlatformPayload {
  management?: {
    stores: unknown[];
    groups: unknown[];
  };
  error?: string;
}

const cache = new Map<string, { expiresAt: number; payload: OwnerPlatformPayload }>();

export async function loadOwnerPlatform(accessToken: string): Promise<OwnerPlatformPayload> {
  const cached = cache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const response = await fetch("/api/admin/owner/platform", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await response.json() as OwnerPlatformPayload;
  if (!response.ok) throw new Error(payload.error ?? "플랫폼 설정을 불러오지 못했습니다.");
  cache.set(accessToken, { expiresAt: Date.now() + 2_000, payload });
  return payload;
}

export function invalidateOwnerPlatform(accessToken: string) {
  cache.delete(accessToken);
}
