import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { resolve } from "node:path";

if (existsSync(resolve(".env.local"))) process.loadEnvFile(resolve(".env.local"));

const EXECUTE = process.argv.includes("--execute");
const BACKUP_PATH = resolve("migration-r2-backup.json");
const AUDIT_PATH = resolve("migration-r2-source-deletion.json");
const PAGE_SIZE = 1_000;
const DELETE_BATCH_SIZE = 250;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_environment:${name}`);
  return value;
}

async function listSupabaseObjects(supabase, bucket) {
  const objects = [];
  const prefixes = [""];
  while (prefixes.length > 0) {
    const prefix = prefixes.shift();
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`source_list_failed:${bucket}:${error.message}`);
      for (const item of data ?? []) {
        const key = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id) objects.push({ key, bytes: Number(item.metadata?.size ?? -1) });
        else prefixes.push(key);
      }
      if ((data?.length ?? 0) < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }
  return objects;
}

function compareObjects(expected, actual) {
  const actualByKey = new Map(actual.map((object) => [object.key, object.bytes]));
  const expectedByKey = new Map(expected.map((object) => [object.key, object.bytes]));
  return {
    missing: expected.filter((object) => !actualByKey.has(object.key)),
    extra: actual.filter((object) => !expectedByKey.has(object.key)),
    sizeMismatch: expected.filter((object) => actualByKey.has(object.key) && actualByKey.get(object.key) !== object.bytes),
  };
}

async function listR2Objects(client, bucketName) {
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents ?? []) {
      objects.push({ key: object.Key, bytes: Number(object.Size ?? -1) });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !continuationToken) throw new Error("r2_pagination_failed");
  } while (continuationToken);
  return objects;
}

function assertExact(label, comparison) {
  if (comparison.missing.length || comparison.extra.length || comparison.sizeMismatch.length) {
    throw new Error(`${label}_mismatch:missing=${comparison.missing.length}:extra=${comparison.extra.length}:size=${comparison.sizeMismatch.length}`);
  }
}

const backupBytes = await fs.readFile(BACKUP_PATH);
const backup = JSON.parse(backupBytes.toString("utf8"));
async function readStdinCredentials() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}
const stdinCredentials = process.env.SUPABASE_MIGRATION_DELETE_URL && process.env.SUPABASE_MIGRATION_DELETE_SECRET
  ? null
  : await readStdinCredentials();
const supabaseUrl = String(
  process.env.SUPABASE_MIGRATION_DELETE_URL ?? stdinCredentials?.supabaseUrl ?? "",
).trim().replace(/\/$/u, "");
const supabaseSecret = String(
  process.env.SUPABASE_MIGRATION_DELETE_SECRET ?? stdinCredentials?.supabaseSecret ?? "",
).trim();
if (!supabaseUrl || !supabaseSecret) throw new Error("missing_supabase_deletion_credentials");
if (new URL(supabaseUrl).origin !== backup.sourceSupabaseOrigin) {
  throw new Error("source_origin_does_not_match_backup");
}

const bucketName = required("R2_BUCKET_NAME");
if (bucketName !== backup.targetBucket) throw new Error("r2_bucket_does_not_match_backup");
const accountId = required("R2_ACCOUNT_ID");
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },
});
const supabase = createClient(supabaseUrl, supabaseSecret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const expectedR2 = backup.verifiedObjects.map((object) => ({
  key: object.key,
  bytes: Number(object.bytes),
}));
const currentR2 = await listR2Objects(r2, bucketName);
assertExact("r2", compareObjects(expectedR2, currentR2));

const sourceBefore = {};
for (const bucket of backup.sourceBuckets) {
  const expected = backup.verifiedObjects
    .filter((object) => object.bucket === bucket)
    .map((object) => ({ key: object.key, bytes: Number(object.bytes) }));
  const actual = await listSupabaseObjects(supabase, bucket);
  assertExact(`supabase_${bucket}`, compareObjects(expected, actual));
  sourceBefore[bucket] = {
    objectCount: actual.length,
    totalBytes: actual.reduce((sum, object) => sum + object.bytes, 0),
  };
}

console.log(JSON.stringify({
  mode: EXECUTE ? "execute" : "dry-run",
  r2: {
    objectCount: currentR2.length,
    totalBytes: currentR2.reduce((sum, object) => sum + object.bytes, 0),
  },
  sourceBefore,
}, null, 2));

if (!EXECUTE) process.exit(0);

const deletedByBucket = {};
for (const bucket of backup.sourceBuckets) {
  const keys = backup.verifiedObjects
    .filter((object) => object.bucket === bucket)
    .map((object) => object.key);
  let deleted = 0;
  for (let offset = 0; offset < keys.length; offset += DELETE_BATCH_SIZE) {
    const batch = keys.slice(offset, offset + DELETE_BATCH_SIZE);
    const { error } = await supabase.storage.from(bucket).remove(batch);
    if (error) throw new Error(`source_delete_failed:${bucket}:${offset}:${error.message}`);
    deleted += batch.length;
    console.log(JSON.stringify({ bucket, deleted, total: keys.length }));
  }
  deletedByBucket[bucket] = deleted;
}

const sourceAfter = {};
for (const bucket of backup.sourceBuckets) {
  const remaining = await listSupabaseObjects(supabase, bucket);
  sourceAfter[bucket] = remaining.length;
  if (remaining.length !== 0) throw new Error(`source_not_empty:${bucket}:${remaining.length}`);
}

await fs.writeFile(AUDIT_PATH, `${JSON.stringify({
  completedAt: new Date().toISOString(),
  backupSha256: createHash("sha256").update(backupBytes).digest("hex"),
  sourceSupabaseOrigin: backup.sourceSupabaseOrigin,
  targetR2PublicUrl: backup.targetR2PublicUrl,
  targetBucket: backup.targetBucket,
  r2ObjectCount: currentR2.length,
  r2TotalBytes: currentR2.reduce((sum, object) => sum + object.bytes, 0),
  sourceBefore,
  deletedByBucket,
  sourceAfter,
}, null, 2)}\n`, { flag: "wx" });

console.log(JSON.stringify({ status: "complete", deletedByBucket, sourceAfter }));
