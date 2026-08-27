import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

export interface R2Config {
  accountId: string;
  bucketName: string;
  publicUrl: string;
}

let cachedClient: S3Client | null = null;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`r2_configuration_missing:${name}`);
  return value;
}

function normalizePublicUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("r2_configuration_invalid:NEXT_PUBLIC_R2_PUBLIC_URL");
  }
  return url.toString().replace(/\/$/u, "");
}

export function getR2Config(): R2Config {
  const accountId = requiredEnvironment("R2_ACCOUNT_ID");
  const bucketName = requiredEnvironment("R2_BUCKET_NAME");
  if (!/^[0-9a-f]{32}$/iu.test(accountId)) {
    throw new Error("r2_configuration_invalid:R2_ACCOUNT_ID");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(bucketName)) {
    throw new Error("r2_configuration_invalid:R2_BUCKET_NAME");
  }
  return {
    accountId,
    bucketName,
    publicUrl: normalizePublicUrl(
      requiredEnvironment("NEXT_PUBLIC_R2_PUBLIC_URL"),
    ),
  };
}

export function getR2Client(): S3Client {
  if (cachedClient) return cachedClient;
  const { accountId } = getR2Config();
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
    },
  });
  return cachedClient;
}

export function getR2PublicObjectUrl(key: string): string {
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${getR2Config().publicUrl}/${encodedKey}`;
}
