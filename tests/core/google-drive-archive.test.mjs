import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("Drive archive auth uses a service-account RS256 JWT with drive.file scope", async () => {
  const auth = await source("src/lib/drive/serviceAccountAuth.ts");
  assert.match(auth, /googleapis\.com\/token/);
  assert.match(auth, /grant_type:\s*"urn:ietf:params:oauth:grant-type:jwt-bearer"/);
  assert.match(auth, /RSASSA-PKCS1-v1_5/);
  assert.match(auth, /GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(auth, /GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.match(auth, /drive\.file/);
});

test("Drive upload builds a multipart request with name and parent folder", async () => {
  const upload = await source("src/lib/drive/upload.ts");
  assert.match(upload, /upload\/drive\/v3\/files/);
  assert.match(upload, /multipart\/related/);
  assert.match(upload, /parents:\s*\[folderId\]/);
  assert.match(upload, /GOOGLE_DRIVE_FOLDER_ID/);
});

test("archive module exports expired records to Drive before TTL cleanup", async () => {
  const [archive, route, envExample] = await Promise.all([
    source("src/lib/drive/archive.ts"),
    source("src/app/api/internal/archive/route.ts"),
    source(".env.example"),
  ]);
  assert.match(archive, /listExpired/);
  assert.match(archive, /multi-provider-records-/);
  assert.match(archive, /Asia\/Seoul/);
  assert.match(archive, /uploadToGoogleDrive/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /x-cron-secret/);
  assert.match(route, /archiveExpiredRecords/);
  assert.match(route, /archive_failed/);
  assert.match(envExample, /GOOGLE_DRIVE_FOLDER_ID/);
});
