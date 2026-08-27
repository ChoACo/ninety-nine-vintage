import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (existsSync(resolve(".env.local"))) process.loadEnvFile(resolve(".env.local"));

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_environment:${name}`);
  return value;
}

function r2AccountId() {
  const value = required("R2_ACCOUNT_ID");
  if (!/^[0-9a-f]{32}$/iu.test(value)) {
    throw new Error("invalid_environment:R2_ACCOUNT_ID");
  }
  return value;
}

function r2BucketName() {
  const value = required("R2_BUCKET_NAME");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(value)) {
    throw new Error("invalid_environment:R2_BUCKET_NAME");
  }
  return value;
}

function allowedOrigins() {
  const origins = required("R2_ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => new URL(origin.trim()).origin)
    .filter((origin, index, values) => values.indexOf(origin) === index);
  if (origins.length === 0 || origins.some((origin) => !/^https?:\/\//u.test(origin))) {
    throw new Error("invalid_environment:R2_ALLOWED_ORIGINS");
  }
  return origins;
}

async function main() {
  const accountId = r2AccountId();
  const bucketName = r2BucketName();
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });
  const rule = {
    AllowedOrigins: allowedOrigins(),
    AllowedMethods: ["PUT", "HEAD"],
    AllowedHeaders: ["Content-Type", "Cache-Control"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3_600,
  };
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: { CORSRules: [rule] },
    }),
  );
  const verified = await client.send(
    new GetBucketCorsCommand({ Bucket: bucketName }),
  );
  const saved = verified.CORSRules?.[0];
  if (
    !saved ||
    !rule.AllowedOrigins.every((origin) => saved.AllowedOrigins?.includes(origin)) ||
    !rule.AllowedMethods.every((method) => saved.AllowedMethods?.includes(method))
  ) {
    throw new Error("r2_cors_verification_failed");
  }
  console.log(JSON.stringify({ bucketName, cors: saved, verified: true }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
