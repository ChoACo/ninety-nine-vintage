import type { StorageAdapter, StorageUploadInput, StoredObject, UsageStats } from "./contracts";

export class GoogleDriveStorageAdapter implements StorageAdapter {
  constructor(
    readonly id: string,
    private readonly accessToken: string,
    private readonly accessTokenExpiresAt: Date,
    private readonly folderId: string,
    private readonly configuredCapacityBytes: number,
  ) {
    if (configuredCapacityBytes <= 0 || configuredCapacityBytes > 3 * 1024 ** 4) {
      throw new Error("google_drive_capacity_invalid");
    }
  }

  private async request(url: string, init?: RequestInit) {
    if (this.accessTokenExpiresAt.getTime() <= Date.now() + 300_000) {
      throw new Error("google_drive_credentials_expired");
    }
    const response = await fetch(url, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${this.accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`google_drive_error:${response.status}`);
    return response;
  }

  async upload(input: StorageUploadInput): Promise<StoredObject> {
    const boundary = `codex-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name: input.key, parents: [this.folderId] });
    const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${input.contentType}\r\n\r\n`);
    const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(prefix.length + input.body.length + suffix.length);
    body.set(prefix); body.set(input.body, prefix.length); body.set(suffix, prefix.length + input.body.length);
    const response = await this.request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
    const result = await response.json() as { id?: string };
    if (!result.id) throw new Error("google_drive_upload_missing_id");
    return { key: result.id, providerId: this.id, sizeBytes: input.body.byteLength };
  }

  async download(key: string) {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(key)}?alt=media`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async delete(key: string) {
    await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(key)}`, { method: "DELETE" });
  }

  async getUsageStats(): Promise<UsageStats> {
    const response = await this.request("https://www.googleapis.com/drive/v3/about?fields=storageQuota(limit,usage)");
    const result = await response.json() as { storageQuota?: { limit?: string; usage?: string } };
    const accountLimit = Number(result.storageQuota?.limit);
    const usedBytes = Number(result.storageQuota?.usage);
    const capacityBytes = Math.min(accountLimit, this.configuredCapacityBytes);
    if (!Number.isSafeInteger(capacityBytes) || !Number.isSafeInteger(usedBytes)) throw new Error("google_drive_usage_unknown");
    return { capacityBytes, usedBytes, measuredAt: new Date(), verified: true };
  }
}
