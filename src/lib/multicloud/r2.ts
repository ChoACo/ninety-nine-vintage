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
    private readonly analyticsApiToken?: string,
    private readonly capacityBytes = 0,
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
    if (!this.analyticsApiToken || this.capacityBytes <= 0) throw new Error("r2_usage_unknown");
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 86_400_000);
    const query = `query R2Storage($accountTag: string!, $startDate: Time, $endDate: Time, $bucketName: string) {
      viewer { accounts(filter: { accountTag: $accountTag }) { r2StorageAdaptiveGroups(limit: 1,
        filter: { datetime_geq: $startDate, datetime_leq: $endDate, bucketName: $bucketName },
        orderBy: [datetime_DESC]) { max { payloadSize metadataSize } dimensions { datetime } } } } }`;
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST", headers: { Authorization: `Bearer ${this.analyticsApiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { accountTag: this.accountId, startDate: startDate.toISOString(),
        endDate: endDate.toISOString(), bucketName: this.bucket } }), cache: "no-store",
    });
    if (!response.ok) throw new Error(`r2_usage_error:${response.status}`);
    const result = await response.json() as { data?: { viewer?: { accounts?: Array<{
      r2StorageAdaptiveGroups?: Array<{ max?: { payloadSize?: number; metadataSize?: number } }>
    }> } }; errors?: unknown[] };
    const metric = result.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups?.[0]?.max;
    const usedBytes = Number(metric?.payloadSize) + Number(metric?.metadataSize);
    if (result.errors?.length || !Number.isSafeInteger(usedBytes) || usedBytes < 0) throw new Error("r2_usage_unknown");
    return { capacityBytes: this.capacityBytes, usedBytes, measuredAt: endDate, verified: true };
  }
}
