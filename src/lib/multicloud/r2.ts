import crypto from "node:crypto";
import type { StorageAdapter, StorageUploadInput, StoredObject, UsageStats } from "./contracts";

export class CloudflareR2Adapter implements StorageAdapter {
  constructor(
    readonly id: string,
    private readonly accountId: string,
    private readonly bucket: string,
    private readonly accessKeyId: string,
    private readonly secretAccessKey: string,
    private readonly publicUrlDomain?: string,
  ) {}

  private async signAndSend(method: string, key: string, body?: Uint8Array, contentType?: string) {
    const host = `${this.accountId}.r2.cloudflarestorage.com`;
    const url = `https://${host}/${this.bucket}/${key}`;
    const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = datetime.slice(0, 8);
    const region = "auto";
    const service = "s3";

    const hash = (data: string | Uint8Array) => crypto.createHash("sha256").update(data).digest("hex");
    const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac("sha256", key).update(data).digest();

    const payloadHash = body ? hash(body) : hash("");
    const canonicalUri = `/${this.bucket}/${key}`;
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${datetime}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const credentialScope = `${date}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${datetime}\n${credentialScope}\n${hash(canonicalRequest)}`;

    const kDate = hmac(`AWS4${this.secretAccessKey}`, date);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, "aws4_request");
    const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    const authHeader = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers: Record<string, string> = {
      "Authorization": authHeader,
      "x-amz-date": datetime,
      "x-amz-content-sha256": payloadHash,
    };
    if (contentType) headers["Content-Type"] = contentType;

    const response = await fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined, cache: "no-store" });
    if (!response.ok) throw new Error(`R2 Error: ${response.status} ${await response.text()}`);
    return response;
  }

  async upload(input: StorageUploadInput): Promise<StoredObject> {
    await this.signAndSend("PUT", input.key, input.body, input.contentType);
    return {
      key: input.key,
      providerId: this.id,
      publicUrl: this.publicUrlDomain ? `https://${this.publicUrlDomain}/${input.key}` : undefined,
      sizeBytes: input.body.byteLength,
    };
  }

  async delete(key: string) {
    await this.signAndSend("DELETE", key);
  }

  async download(key: string) {
    const res = await this.signAndSend("GET", key);
    return new Uint8Array(await res.arrayBuffer());
  }

  async getUsageStats(): Promise<UsageStats> {
    const capacityBytes = Number(process.env.MULTICLOUD_R2_CAPACITY_BYTES ?? "10737418240"); // Default 10GB
    return {
      capacityBytes,
      usedBytes: 0, // This would require querying Cloudflare Analytics API, but for routing, returning 0 or mock is acceptable if Supabase drives the usage, OR we track it via db.
      measuredAt: new Date(),
    };
  }
}
